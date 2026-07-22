import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { authorizeManagement, canManageSubject } from '@/server/auth/management';
import { appSchema } from '@/server/supabase/admin';
import { auditLog } from '@/server/audit/audit';
import { generatedQuestionSchema } from '@/server/ai/question-schema';
import { getOwnedQuestionContext, prepareQuizForQuestionMutation } from '@/server/data/question-access';
import { invalidatePlatformData } from '@/server/cache/data-cache';
import { normalizeQuestionText } from '@/server/questions/dedup';

const paramsSchema = z.object({ questionId: z.string().uuid() });

export async function GET(request: Request, context: { params: Promise<{ questionId: string }> }) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return jsonError('BAD_REQUEST', 'ID inválido.', 400);
  const owner = await getOwnedQuestionContext(params.data.questionId, auth.membership.organizationId).catch(() => null);
  if (!owner) return jsonError('NOT_FOUND', 'Questão não encontrada.', 404);
  if (!canManageSubject(auth.scope, owner.subjectId)) return jsonError('FORBIDDEN', 'Você não pode acessar questões desta matéria.', 403);
  const [{ data: question }, { data: options }, { data: key }] = await Promise.all([
    appSchema().from('quiz_questions').select('*').eq('id', params.data.questionId).single(),
    appSchema().from('question_options').select('id,label,option_text,position').eq('quiz_question_id', params.data.questionId).order('position'),
    appSchema().from('question_answer_keys').select('correct_option_id,explanation_correct,explanation_wrong').eq('quiz_question_id', params.data.questionId).maybeSingle()
  ]);
  return jsonOk({ question, options, key });
}

export async function PATCH(request: Request, context: { params: Promise<{ questionId: string }> }) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;
  const params = paramsSchema.safeParse(await context.params);
  const body = generatedQuestionSchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) return jsonError('BAD_REQUEST', 'Questão inválida.', 400, body.success ? undefined : body.error.flatten());
  const owner = await getOwnedQuestionContext(params.data.questionId, auth.membership.organizationId).catch(() => null);
  if (!owner) return jsonError('NOT_FOUND', 'Questão não encontrada.', 404);
  if (!canManageSubject(auth.scope, owner.subjectId)) return jsonError('FORBIDDEN', 'Você não pode acessar questões desta matéria.', 403);
  const editable = await prepareQuizForQuestionMutation(owner.quizId, owner.quiz.status, auth.membership.organizationId).catch((error) => ({ ok: false as const, message: error instanceof Error ? error.message : 'Não foi possível validar o simulado.' }));
  if (!editable.ok) return jsonError('BAD_REQUEST', editable.message, 400);

  const { data: siblingRows, error: duplicateError } = await appSchema()
    .from('quiz_questions')
    .select('id,statement')
    .eq('quiz_id', owner.quizId)
    .neq('id', params.data.questionId);
  if (duplicateError) return jsonError('INTERNAL_ERROR', duplicateError.message, 500);
  const fingerprint = normalizeQuestionText(body.data.statement);
  const duplicate = (siblingRows ?? []).find((row) => normalizeQuestionText(String(row.statement || '')) === fingerprint);
  if (duplicate) return jsonError('CONFLICT', 'Já existe outra questão igual neste simulado.', 409, { duplicateQuestionId: duplicate.id });

  const { data, error } = await appSchema().rpc('update_quiz_question', {
    p_question_id: params.data.questionId,
    p_actor_auth_uid: auth.user.authUid,
    p_payload: body.data
  });
  if (error) return jsonError('INTERNAL_ERROR', `Não foi possível salvar: ${error.message}. Confirme se a migration 003 foi aplicada.`, 500);
  await auditLog({ organizationId: auth.membership.organizationId, actorAuthUid: auth.user.authUid, action: 'question_updated', entityName: 'quiz_questions', entityId: params.data.questionId });
  invalidatePlatformData();
  return jsonOk({ id: data || params.data.questionId, reviewStatus: 'review' });
}

export async function DELETE(request: Request, context: { params: Promise<{ questionId: string }> }) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return jsonError('BAD_REQUEST', 'ID inválido.', 400);
  const owner = await getOwnedQuestionContext(params.data.questionId, auth.membership.organizationId).catch(() => null);
  if (!owner) return jsonError('NOT_FOUND', 'Questão não encontrada.', 404);
  if (!canManageSubject(auth.scope, owner.subjectId)) return jsonError('FORBIDDEN', 'Você não pode acessar questões desta matéria.', 403);
  const editable = await prepareQuizForQuestionMutation(owner.quizId, owner.quiz.status, auth.membership.organizationId).catch((error) => ({ ok: false as const, message: error instanceof Error ? error.message : 'Não foi possível validar o simulado.' }));
  if (!editable.ok) return jsonError('BAD_REQUEST', editable.message, 400);
  const { error } = await appSchema().from('quiz_questions').delete().eq('id', params.data.questionId);
  if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  await auditLog({ organizationId: auth.membership.organizationId, actorAuthUid: auth.user.authUid, action: 'question_deleted', entityName: 'quiz_questions', entityId: params.data.questionId });
  invalidatePlatformData();
  return jsonOk({ deleted: true });
}
