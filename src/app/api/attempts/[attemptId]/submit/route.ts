import { jsonError, jsonOk } from '@/lib/http';
import { getActiveStudentProfile, getAuthenticatedUser } from '@/server/auth/session';
import { appSchema } from '@/server/supabase/admin';
import { scoreAttempt, type Difficulty } from '@/server/scoring/scoring';
import { invalidatePlatformData } from '@/server/cache/data-cache';

export async function POST(request: Request, context: { params: Promise<{ attemptId: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('UNAUTHORIZED', 'Sessão inválida.', 401);

  const profile = await getActiveStudentProfile(user.authUid);
  if (!profile) return jsonError('FORBIDDEN', 'Perfil de aluno não está ativo.', 403);

  const params = await context.params;
  const { data: attempt, error: attemptError } = await appSchema()
    .from('attempts')
    .select('id,organization_id,student_id,quiz_id,status,started_at')
    .eq('id', params.attemptId)
    .eq('student_id', profile.id)
    .maybeSingle();

  if (attemptError) return jsonError('INTERNAL_ERROR', attemptError.message, 500);
  if (!attempt) return jsonError('NOT_FOUND', 'Tentativa não encontrada.', 404);
  if (attempt.status !== 'in_progress') return jsonError('FORBIDDEN', 'Tentativa já foi enviada.', 403);

  const [{ data: answers, error: answersError }, { data: questions, error: questionsError }] = await Promise.all([
    appSchema().from('attempt_answers')
      .select('id,quiz_question_id,selected_option_id,elapsed_seconds')
      .eq('attempt_id', attempt.id),
    appSchema().from('quiz_questions')
      .select('id,difficulty,expected_time_seconds,question_answer_keys(correct_option_id)')
      .eq('quiz_id', attempt.quiz_id)
      .eq('review_status', 'approved')
  ]);

  if (answersError) return jsonError('INTERNAL_ERROR', answersError.message, 500);
  if (questionsError) return jsonError('INTERNAL_ERROR', questionsError.message, 500);
  if (!questions?.length) return jsonError('CONFLICT', 'Este simulado não possui questões aprovadas.', 409);

  const answerMap = new Map((answers ?? []).map((answer) => [answer.quiz_question_id, answer]));
  const scoringInput = questions.map((question) => {
    const answer = answerMap.get(question.id);
    const answerKey = Array.isArray(question.question_answer_keys) ? question.question_answer_keys[0] : question.question_answer_keys;
    const isCorrect = Boolean(answer?.selected_option_id && answerKey?.correct_option_id === answer.selected_option_id);
    return {
      questionId: question.id,
      difficulty: question.difficulty as Difficulty,
      expectedTimeSeconds: question.expected_time_seconds,
      // O tempo por questão enviado pelo navegador é mantido para análise, mas
      // não influencia a pontuação. O desempate usa o tempo oficial do servidor.
      elapsedSeconds: question.expected_time_seconds,
      isCorrect
    };
  });

  const score = scoreAttempt(scoringInput);
  const scoredAnswers = score.questions.flatMap((item) => {
    const answer = answerMap.get(item.questionId);
    if (!answer) return [];
    return [{
      attempt_id: attempt.id,
      quiz_question_id: item.questionId,
      selected_option_id: answer.selected_option_id,
      elapsed_seconds: answer.elapsed_seconds,
      is_correct: scoringInput.find((input) => input.questionId === item.questionId)?.isCorrect ?? false,
      points_awarded: item.points
    }];
  });

  if (scoredAnswers.length) {
    const { error: scoringError } = await appSchema().from('attempt_answers')
      .upsert(scoredAnswers, { onConflict: 'attempt_id,quiz_question_id' });
    if (scoringError) return jsonError('INTERNAL_ERROR', `Falha ao corrigir respostas: ${scoringError.message}`, 500);
  }

  const submittedAt = new Date();
  const durationSeconds = Math.max(0, Math.floor((submittedAt.getTime() - new Date(attempt.started_at).getTime()) / 1000));
  const { data: updatedAttempt, error: updateError } = await appSchema()
    .from('attempts')
    .update({
      status: 'submitted',
      submitted_at: submittedAt.toISOString(),
      duration_seconds: durationSeconds,
      score_raw: score.raw,
      score_normalized: score.normalized,
      correct_count: score.correctCount,
      wrong_count: score.wrongCount
    })
    .eq('id', attempt.id)
    .eq('status', 'in_progress')
    .select('id,score_normalized,correct_count,wrong_count,duration_seconds')
    .maybeSingle();

  if (updateError) return jsonError('INTERNAL_ERROR', updateError.message, 500);
  if (!updatedAttempt) return jsonError('CONFLICT', 'A tentativa já foi entregue em outra sessão.', 409);

  // Rankings são calculados diretamente com a ordem oficial e índices próprios.
  // Isso evita apagar e reconstruir toda a classificação a cada entrega.
  invalidatePlatformData();
  return jsonOk(updatedAttempt);
}
