import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { authorizeManagement, canManageSubject } from '@/server/auth/management';
import { appSchema } from '@/server/supabase/admin';
import { generateQuizFromTranscript } from '@/server/ai/gemini';
import { auditLog } from '@/server/audit/audit';
import { getOwnedQuestionContext, prepareQuizForQuestionMutation } from '@/server/data/question-access';
import { invalidatePlatformData } from '@/server/cache/data-cache';

const paramsSchema = z.object({ questionId: z.string().uuid() });
const bodySchema = z.object({ instruction: z.string().trim().max(1000).optional() });

export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;
  const params = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!params.success || !body.success) return jsonError('BAD_REQUEST', 'Dados inválidos.', 400);
  const owner = await getOwnedQuestionContext(params.data.questionId, auth.membership.organizationId).catch(() => null);
  if (!owner) return jsonError('NOT_FOUND', 'Questão não encontrada.', 404);
  if (!canManageSubject(auth.scope, owner.subjectId)) return jsonError('FORBIDDEN', 'Você não pode regenerar questões desta matéria.', 403);
  const editable = await prepareQuizForQuestionMutation(owner.quizId, owner.quiz.status, auth.membership.organizationId).catch((error) => ({ ok: false as const, message: error instanceof Error ? error.message : 'Não foi possível validar o simulado.' }));
  if (!editable.ok) return jsonError('BAD_REQUEST', editable.message, 400);

  const { data: question, error } = await appSchema()
    .from('quiz_questions')
    .select('id,quiz_id,topic,subtopic,source_ai_job_id')
    .eq('id', owner.questionId)
    .eq('quiz_id', owner.quizId)
    .maybeSingle();
  if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  if (!question) return jsonError('NOT_FOUND', 'Questão não encontrada.', 404);
  if (!question.source_ai_job_id) return jsonError('BAD_REQUEST', 'Esta questão não possui uma fonte de IA vinculada.', 400);
  const { data: job, error: jobError } = await appSchema().from('ai_jobs').select('content_source_id').eq('id', question.source_ai_job_id).maybeSingle();
  if (jobError) return jsonError('INTERNAL_ERROR', jobError.message, 500);

  let source: { raw_text: string | null; title: string | null } | null = null;
  if (job?.content_source_id) {
    const sourceResult = await appSchema().from('content_sources').select('raw_text,title').eq('id', job.content_source_id).maybeSingle();
    if (sourceResult.error) return jsonError('INTERNAL_ERROR', sourceResult.error.message, 500);
    source = sourceResult.data;
  }
  if (!source?.raw_text) return jsonError('BAD_REQUEST', 'A fonte original não está disponível.', 400);

  const { data: subject } = await appSchema()
    .from('subjects')
    .select('name')
    .eq('id', owner.subjectId)
    .eq('organization_id', auth.membership.organizationId)
    .maybeSingle();

  try {
    const generated = await generateQuizFromTranscript({
      transcript: `${source.raw_text}\n\nINSTRUÇÃO DE REGENERAÇÃO: ${body.data.instruction || `Crie uma questão diferente sobre ${question.topic || question.subtopic || 'o conteúdo principal'}.`}`,
      requestedTitle: `${owner.quiz.title} — questão regenerada`,
      questionCount: 1,
      language: 'pt-BR',
      subjectName: subject?.name
    });
    const replacement = generated.quiz.questions[0];
    const { error: updateError } = await appSchema().rpc('update_quiz_question', {
      p_question_id: question.id,
      p_actor_auth_uid: auth.user.authUid,
      p_payload: replacement
    });
    if (updateError) throw new Error(updateError.message);
    await auditLog({ organizationId: auth.membership.organizationId, actorAuthUid: auth.user.authUid, action: 'question_regenerated', entityName: 'quiz_questions', entityId: question.id, metadata: { input_tokens: generated.inputTokens, output_tokens: generated.outputTokens, cost_usd: generated.estimatedCostUsd } });
    invalidatePlatformData();
    return jsonOk({ question: replacement, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens, actualCostUsd: generated.estimatedCostUsd });
  } catch (generationError) {
    return jsonError('INTERNAL_ERROR', generationError instanceof Error ? generationError.message : 'Falha ao regenerar.', 502);
  }
}
