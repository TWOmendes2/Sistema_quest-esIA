import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { authorizeManagement, canManageSubject } from '@/server/auth/management';
import { appSchema } from '@/server/supabase/admin';
import { usdToBrl } from '@/server/ai/estimate';

const paramsSchema = z.object({ jobId: z.string().uuid() });

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return jsonError('BAD_REQUEST', 'ID do job inválido.', 400);

  const { data: job, error } = await appSchema().from('ai_jobs')
    .select('id,organization_id,content_source_id,quiz_id,target_quiz_id,subject_id,status,model_name,prompt_version,input_tokens,output_tokens,estimated_cost,pre_estimated_input_tokens,pre_estimated_output_tokens,pre_estimated_cost,duration_ms,error_message,result_json,created_at,updated_at')
    .eq('id', parsedParams.data.jobId)
    .eq('organization_id', auth.membership.organizationId)
    .maybeSingle();
  if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  if (!job) return jsonError('NOT_FOUND', 'Job não encontrado.', 404);
  if (!canManageSubject(auth.scope, job.subject_id)) return jsonError('FORBIDDEN', 'Professor sem acesso à matéria desta geração.', 403);
  if (!job.quiz_id) return jsonOk(job);

  const { data: staging, error: stagingError } = await appSchema().from('quizzes')
    .select('id,title,description,subject_id,quiz_kind')
    .eq('id', job.quiz_id)
    .eq('organization_id', auth.membership.organizationId)
    .maybeSingle();
  if (stagingError) return jsonError('INTERNAL_ERROR', stagingError.message, 500);
  if (!staging || staging.quiz_kind !== 'ai_review') return jsonOk(job);
  if (!canManageSubject(auth.scope, staging.subject_id)) return jsonError('FORBIDDEN', 'Professor sem acesso à matéria desta geração.', 403);

  const { data: questionRows, error: questionsError } = await appSchema().from('quiz_questions')
    .select('id,statement,topic,subtopic,difficulty,expected_time_seconds,position,review_status')
    .eq('quiz_id', staging.id)
    .order('position');
  if (questionsError) return jsonError('INTERNAL_ERROR', questionsError.message, 500);
  const questionIds = (questionRows ?? []).map((question) => question.id);

  const [{ data: options, error: optionsError }, { data: keys, error: keysError }] = questionIds.length
    ? await Promise.all([
      appSchema().from('question_options').select('id,quiz_question_id,label,option_text,position').in('quiz_question_id', questionIds).order('position'),
      appSchema().from('question_answer_keys').select('quiz_question_id,correct_option_id,explanation_correct,explanation_wrong').in('quiz_question_id', questionIds)
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (optionsError || keysError) return jsonError('INTERNAL_ERROR', optionsError?.message || keysError?.message || 'Falha ao carregar a revisão.', 500);

  const keyMap = new Map((keys ?? []).map((key) => [key.quiz_question_id, key]));
  const reviewQuestions = (questionRows ?? []).map((question) => {
    const questionOptions = (options ?? []).filter((option) => option.quiz_question_id === question.id);
    const key = keyMap.get(question.id);
    const correct = questionOptions.find((option) => option.id === key?.correct_option_id);
    return {
      id: question.id,
      statement: question.statement,
      topic: question.topic || '',
      subtopic: question.subtopic || '',
      difficulty: question.difficulty,
      expected_time_seconds: Number(question.expected_time_seconds || 120),
      options: questionOptions.map((option) => ({ label: option.label, text: option.option_text })),
      correct_label: correct?.label || 'A',
      explanation_correct: key?.explanation_correct || '',
      explanation_wrong: key?.explanation_wrong || '',
      reviewStatus: question.review_status || 'review'
    };
  });

  const preCost = Number(job.pre_estimated_cost || 0);
  const actualCost = Number(job.estimated_cost || 0);
  return jsonOk({
    jobId: job.id,
    quizId: staging.id,
    targetQuizId: job.target_quiz_id,
    subjectId: staging.subject_id,
    questionIds,
    questionCount: reviewQuestions.length,
    preEstimate: {
      inputTokens: Number(job.pre_estimated_input_tokens || 0),
      outputTokens: Number(job.pre_estimated_output_tokens || 0),
      costUsd: preCost,
      costBrl: usdToBrl(preCost),
      estimatedSeconds: 0
    },
    inputTokens: Number(job.input_tokens || 0),
    outputTokens: Number(job.output_tokens || 0),
    actualCostUsd: actualCost,
    actualCostBrl: usdToBrl(actualCost),
    durationMs: Number(job.duration_ms || 0),
    duplicatesSkipped: 0,
    quiz: { title: staging.title, description: staging.description || '', questions: [] },
    reviewQuestions,
    status: job.status
  });
}
