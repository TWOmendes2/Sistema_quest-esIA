import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { authorizeManagement, canManageSubject } from '@/server/auth/management';
import { appSchema } from '@/server/supabase/admin';
import { auditLog } from '@/server/audit/audit';
import { generatedQuestionSchema } from '@/server/ai/question-schema';
import { invalidatePlatformData } from '@/server/cache/data-cache';
import { normalizeQuestionText } from '@/server/questions/dedup';
import { prepareQuizForQuestionMutation } from '@/server/data/question-access';

const createSchema = z.object({ quizId: z.string().uuid(), subjectId: z.string().uuid().optional() }).and(generatedQuestionSchema);

export async function POST(request: Request) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Questão inválida.', 400, parsed.error.flatten());
  const { data: quiz, error: quizError } = await appSchema().from('quizzes')
    .select('id,organization_id,status,subject_id')
    .eq('id', parsed.data.quizId)
    .eq('organization_id', auth.membership.organizationId)
    .maybeSingle();
  if (quizError) return jsonError('INTERNAL_ERROR', quizError.message, 500);
  if (!quiz) return jsonError('BAD_REQUEST', 'Simulado de destino não encontrado.', 400);
  const subjectId = parsed.data.subjectId || quiz.subject_id;
  const { data: subjectLink } = await appSchema().from('quiz_subjects').select('subject_id').eq('quiz_id', quiz.id).eq('subject_id', subjectId).eq('status', 'active').maybeSingle();
  if (!subjectLink) return jsonError('BAD_REQUEST', 'A matéria selecionada não pertence a este simulado.', 400);
  if (!canManageSubject(auth.scope, subjectId)) return jsonError('FORBIDDEN', 'Você não pode cadastrar questões desta matéria.', 403);
  const editable = await prepareQuizForQuestionMutation(quiz.id, quiz.status, auth.membership.organizationId).catch((error) => ({ ok: false as const, message: error instanceof Error ? error.message : 'Não foi possível validar o simulado.' }));
  if (!editable.ok) return jsonError('BAD_REQUEST', editable.message, 400);

  const { data: existingRows, error: duplicateError } = await appSchema()
    .from('quiz_questions')
    .select('id,statement')
    .eq('quiz_id', quiz.id);
  if (duplicateError) return jsonError('INTERNAL_ERROR', duplicateError.message, 500);
  const fingerprint = normalizeQuestionText(parsed.data.statement);
  const duplicate = (existingRows ?? []).find((row) => normalizeQuestionText(String(row.statement || '')) === fingerprint);
  if (duplicate) return jsonError('CONFLICT', 'Esta questão já existe no simulado de destino.', 409, { duplicateQuestionId: duplicate.id });

  const { data: maxRow } = await appSchema().from('quiz_questions').select('position').eq('quiz_id', quiz.id).order('position', { ascending: false }).limit(1).maybeSingle();
  const { data: question, error } = await appSchema().from('quiz_questions').insert({
    quiz_id: quiz.id,
    subject_id: subjectId,
    statement: parsed.data.statement,
    topic: parsed.data.topic,
    subtopic: parsed.data.subtopic,
    difficulty: parsed.data.difficulty,
    expected_time_seconds: parsed.data.expected_time_seconds,
    position: Number(maxRow?.position || 0) + 1,
    review_status: 'review'
  }).select('id').single();
  if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  try {
    const optionRows = parsed.data.options.map((option, index) => ({
      quiz_question_id: question.id,
      label: option.label,
      option_text: option.text,
      position: index + 1
    }));
    const { data: options, error: optionsError } = await appSchema().from('question_options').insert(optionRows).select('id,label');
    if (optionsError) throw optionsError;
    const correct = options?.find((option) => option.label === parsed.data.correct_label);
    if (!correct) throw new Error('Gabarito não encontrado.');
    const { error: keyError } = await appSchema().from('question_answer_keys').insert({
      quiz_question_id: question.id,
      correct_option_id: correct.id,
      explanation_correct: parsed.data.explanation_correct,
      explanation_wrong: parsed.data.explanation_wrong,
      created_by: auth.user.authUid
    });
    if (keyError) throw keyError;
  } catch (creationError) {
    await appSchema().from('quiz_questions').delete().eq('id', question.id);
    return jsonError('INTERNAL_ERROR', creationError instanceof Error ? creationError.message : 'Erro ao salvar a questão.', 500);
  }
  await auditLog({ organizationId: auth.membership.organizationId, actorAuthUid: auth.user.authUid, action: 'question_created', entityName: 'quiz_questions', entityId: question.id, metadata: { quiz_id: quiz.id, subject_id: subjectId } });
  invalidatePlatformData();
  return jsonOk({ id: question.id }, 201);
}
