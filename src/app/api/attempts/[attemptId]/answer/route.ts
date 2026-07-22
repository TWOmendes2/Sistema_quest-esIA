import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { getActiveStudentProfile, getAuthenticatedUser } from '@/server/auth/session';
import { appSchema } from '@/server/supabase/admin';

const answerSchema = z.object({
  questionId: z.string().uuid(),
  selectedOptionId: z.string().uuid(),
  elapsedSeconds: z.number().int().min(0).max(7200)
});

const bodySchema = z.union([
  answerSchema.transform((answer) => ({ answers: [answer] })),
  z.object({ answers: z.array(answerSchema).min(1).max(200) })
]);

export async function POST(request: Request, context: { params: Promise<{ attemptId: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('UNAUTHORIZED', 'Sessão inválida.', 401);

  const profile = await getActiveStudentProfile(user.authUid);
  if (!profile) return jsonError('FORBIDDEN', 'Perfil de aluno não está ativo.', 403);

  const params = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Resposta inválida.', 400, parsed.error.flatten());

  const { data: attempt, error: attemptError } = await appSchema()
    .from('attempts')
    .select('id,student_id,quiz_id,status')
    .eq('id', params.attemptId)
    .eq('student_id', profile.id)
    .maybeSingle();

  if (attemptError) return jsonError('INTERNAL_ERROR', attemptError.message, 500);
  if (!attempt) return jsonError('NOT_FOUND', 'Tentativa não encontrada.', 404);
  if (attempt.status !== 'in_progress') return jsonError('FORBIDDEN', 'Tentativa já foi enviada.', 403);

  // Em caso de repetição da mesma questão no lote, a última seleção prevalece.
  const answers = [...new Map(parsed.data.answers.map((answer) => [answer.questionId, answer])).values()];
  const questionIds = answers.map((answer) => answer.questionId);
  const optionIds = answers.map((answer) => answer.selectedOptionId);

  const [{ data: questions, error: questionsError }, { data: options, error: optionsError }] = await Promise.all([
    appSchema().from('quiz_questions')
      .select('id')
      .eq('quiz_id', attempt.quiz_id)
      .eq('review_status', 'approved')
      .in('id', questionIds),
    appSchema().from('question_options')
      .select('id,quiz_question_id')
      .in('id', optionIds)
  ]);

  if (questionsError) return jsonError('INTERNAL_ERROR', questionsError.message, 500);
  if (optionsError) return jsonError('INTERNAL_ERROR', optionsError.message, 500);

  const allowedQuestions = new Set((questions ?? []).map((question) => question.id));
  const optionQuestion = new Map((options ?? []).map((option) => [option.id, option.quiz_question_id]));
  const invalid = answers.find((answer) => !allowedQuestions.has(answer.questionId)
    || optionQuestion.get(answer.selectedOptionId) !== answer.questionId);
  if (invalid) return jsonError('BAD_REQUEST', 'Uma resposta não pertence a este simulado ou a alternativa é inválida.', 400);

  const { data, error } = await appSchema()
    .from('attempt_answers')
    .upsert(answers.map((answer) => ({
      attempt_id: params.attemptId,
      quiz_question_id: answer.questionId,
      selected_option_id: answer.selectedOptionId,
      elapsed_seconds: answer.elapsedSeconds
    })), { onConflict: 'attempt_id,quiz_question_id' })
    .select('id');

  if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  return jsonOk({ saved: data?.length ?? answers.length });
}
