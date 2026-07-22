import { z } from 'zod';
import { getRequestIp, getUserAgent, jsonError, jsonOk } from '@/lib/http';
import { authorizeManagement, canManageAllSubjects, canManageSubject } from '@/server/auth/management';
import { auditLog } from '@/server/audit/audit';
import { env } from '@/server/env';
import { checkRateLimit } from '@/server/security/rate-limit';
import { appSchema } from '@/server/supabase/admin';
import { generateQuizFromTranscript } from '@/server/ai/gemini';
import { persistGeneratedQuiz } from '@/server/ai/persist-generated-quiz';
import { estimateAiUsage, usdToBrl } from '@/server/ai/estimate';
import { invalidatePlatformData } from '@/server/cache/data-cache';
import { ENEM_PPL_PROMPT_VERSION } from '@/server/ai/enem-ppl-profile';
import { deduplicateGeneratedQuiz } from '@/server/questions/dedup';

const bodySchema = z.object({
  organizationId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  subjectName: z.string().trim().min(2).max(120).optional(),
  classId: z.string().uuid().optional(), // compatibilidade com clientes anteriores
  title: z.string().trim().min(3).max(200),
  transcript: z.string().trim().min(200).max(500_000).optional(),
  rawText: z.string().trim().min(200).max(500_000).optional(),
  questionCount: z.number().int().min(1).max(50).default(10),
  difficulty: z.enum(['Misto', 'Fácil', 'Médio', 'Difícil']).default('Misto'),
  autoPublish: z.boolean().default(false), // ignorado por segurança: IA sempre exige revisão
  quizId: z.string().uuid().optional(), // destino opcional após a revisão
  promptVersion: z.string().trim().min(1).max(80).default(ENEM_PPL_PROMPT_VERSION),
  language: z.string().trim().min(2).max(20).default('pt-BR')
}).superRefine((value, context) => {
  if (!value.subjectId && !value.subjectName) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe a matéria.', path: ['subjectId'] });
  if (!value.transcript && !value.rawText) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe a transcrição.', path: ['transcript'] });
});

export async function GET(request: Request) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;
  let query = appSchema().from('ai_jobs')
    .select('id,organization_id,content_source_id,quiz_id,target_quiz_id,subject_id,status,prompt_version,model_name,input_tokens,output_tokens,estimated_cost,pre_estimated_input_tokens,pre_estimated_output_tokens,pre_estimated_cost,duration_ms,error_message,created_at,updated_at')
    .eq('organization_id', auth.membership.organizationId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (auth.scope.role === 'teacher') {
    if (!auth.scope.allowedSubjectIds.length) return jsonOk([]);
    query = query.in('subject_id', auth.scope.allowedSubjectIds);
  }
  const { data, error } = await query;
  if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  return jsonOk(data ?? []);
}

export async function POST(request: Request) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Dados inválidos para IA.', 400, parsed.error.flatten());
  const organizationId = auth.membership.organizationId;
  if (parsed.data.organizationId && parsed.data.organizationId !== organizationId) return jsonError('FORBIDDEN', 'Organização inválida.', 403);
  if (!env.geminiApiKey) return jsonError('INTERNAL_ERROR', 'Integração com IA não configurada no servidor.', 503);

  const limit = checkRateLimit({ key: `ai:${auth.user.authUid}`, limit: env.aiRateLimitMax, windowSeconds: env.aiRateLimitWindowSeconds });
  if (!limit.allowed) return jsonError('RATE_LIMITED', 'Limite de geração com IA atingido.', 429, limit);

  const subjectQuery = appSchema().from('subjects').select('id,name').eq('organization_id', organizationId).eq('status', 'active');
  const { data: subject, error: subjectError } = parsed.data.subjectId
    ? await subjectQuery.eq('id', parsed.data.subjectId).maybeSingle()
    : await subjectQuery.ilike('name', parsed.data.subjectName as string).maybeSingle();
  if (subjectError) return jsonError('INTERNAL_ERROR', 'Erro ao consultar a matéria.', 500);
  if (!subject) return jsonError('BAD_REQUEST', 'Matéria não encontrada ou inativa nesta organização.', 400);
  if (!canManageSubject(auth.scope, subject.id)) return jsonError('FORBIDDEN', 'Professor sem acesso a esta matéria.', 403);

  let targetQuizId: string | null = null;
  if (parsed.data.quizId) {
    const { data: target, error: targetError } = await appSchema().from('quizzes')
      .select('id,subject_id,quiz_kind,status')
      .eq('id', parsed.data.quizId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (targetError) return jsonError('INTERNAL_ERROR', targetError.message, 500);
    if (!target || target.quiz_kind !== 'assessment' || !['draft', 'review'].includes(target.status)) {
      return jsonError('BAD_REQUEST', 'O simulado de destino não existe, já foi publicado ou não aceita novas questões.', 400);
    }

    const { data: targetSubjectLinks, error: targetSubjectsError } = await appSchema()
      .from('quiz_subjects')
      .select('subject_id')
      .eq('quiz_id', target.id)
      .eq('status', 'active');
    if (targetSubjectsError) return jsonError('INTERNAL_ERROR', targetSubjectsError.message, 500);

    const targetSubjectIds = [
      ...new Set([target.subject_id, ...(targetSubjectLinks ?? []).map((item) => item.subject_id)].filter(Boolean) as string[]),
    ];
    if (!canManageAllSubjects(auth.scope, targetSubjectIds)) {
      return jsonError('FORBIDDEN', 'Professor sem permissão para alterar todas as matérias deste simulado.', 403);
    }
    if (!targetSubjectIds.includes(subject.id)) {
      return jsonError('BAD_REQUEST', 'A matéria selecionada não está vinculada ao simulado de destino.', 400);
    }
    targetQuizId = target.id;
  }

  const transcript = (parsed.data.transcript ?? parsed.data.rawText) as string;
  const preEstimate = estimateAiUsage({ text: transcript, questionCount: parsed.data.questionCount, difficulty: parsed.data.difficulty });
  const { data: source, error: sourceError } = await appSchema().from('content_sources').insert({
    organization_id: organizationId,
    title: parsed.data.title,
    source_type: 'transcription',
    raw_text: transcript,
    character_count: transcript.length,
    created_by: auth.user.authUid
  }).select('id').single();
  if (sourceError) return jsonError('INTERNAL_ERROR', `Erro ao registrar a fonte de conteúdo: ${sourceError.message}`, 500);

  const { data: job, error: jobError } = await appSchema().from('ai_jobs').insert({
    organization_id: organizationId,
    content_source_id: source.id,
    quiz_id: null,
    target_quiz_id: targetQuizId,
    subject_id: subject.id,
    status: 'processing',
    prompt_version: parsed.data.promptVersion,
    model_name: env.geminiModel,
    pre_estimated_input_tokens: preEstimate.inputTokens,
    pre_estimated_output_tokens: preEstimate.outputTokens,
    pre_estimated_cost: preEstimate.costUsd,
    requested_by: auth.user.authUid
  }).select('id').single();
  if (jobError) return jsonError('INTERNAL_ERROR', `Erro ao criar o job de IA: ${jobError.message}. Confirme se a migration 013 foi aplicada.`, 500);

  await auditLog({
    organizationId,
    actorAuthUid: auth.user.authUid,
    action: 'ai_job_created',
    entityName: 'ai_jobs',
    entityId: job.id,
    ipAddress: getRequestIp(request),
    userAgent: getUserAgent(request),
    metadata: { model: env.geminiModel, question_count: parsed.data.questionCount, target_quiz_id: targetQuizId, pre_estimated_cost_usd: preEstimate.costUsd }
  });

  const startedAt = Date.now();
  try {
    const generation = await generateQuizFromTranscript({
      transcript,
      requestedTitle: parsed.data.title,
      questionCount: parsed.data.questionCount,
      language: parsed.data.language,
      difficulty: parsed.data.difficulty,
      subjectName: subject.name
    });

    let existingStatements: string[] = [];
    if (targetQuizId) {
      const { data: existingRows, error: existingError } = await appSchema()
        .from('quiz_questions')
        .select('statement')
        .eq('quiz_id', targetQuizId);
      if (existingError) throw new Error(`Falha ao validar duplicações: ${existingError.message}`);
      existingStatements = (existingRows ?? []).map((row) => String(row.statement || ''));
    }

    const deduplicated = deduplicateGeneratedQuiz(generation.quiz, existingStatements);
    if (!deduplicated.quiz.questions.length) {
      throw new Error('A IA retornou apenas questões já existentes no simulado de destino. Gere novamente com outra orientação.');
    }

    // Sempre persiste em um lote ai_review isolado. Nada entra no banco de
    // questões ou no simulado real antes de o usuário concluir a revisão.
    const persisted = await persistGeneratedQuiz({
      organizationId,
      subjectId: subject.id,
      actorAuthUid: auth.user.authUid,
      aiJobId: job.id,
      quizId: undefined,
      classId: undefined,
      autoPublish: false,
      quiz: deduplicated.quiz
    });

    const durationMs = Date.now() - startedAt;
    const { error: updateError } = await appSchema().from('ai_jobs').update({
      quiz_id: persisted.quizId,
      status: 'ready_for_review',
      model_name: env.geminiModel,
      input_tokens: generation.inputTokens,
      output_tokens: generation.outputTokens,
      estimated_cost: generation.estimatedCostUsd,
      duration_ms: durationMs,
      result_json: deduplicated.quiz,
      error_message: null,
      updated_at: new Date().toISOString()
    }).eq('id', job.id);
    if (updateError) throw new Error(`Falha ao concluir o job: ${updateError.message}`);

    await auditLog({
      organizationId,
      actorAuthUid: auth.user.authUid,
      action: 'ai_job_ready_for_review',
      entityName: 'ai_jobs',
      entityId: job.id,
      ipAddress: getRequestIp(request),
      userAgent: getUserAgent(request),
      metadata: { staging_quiz_id: persisted.quizId, target_quiz_id: targetQuizId, question_count: persisted.questionCount, duplicates_skipped: deduplicated.duplicatesSkipped, actual_cost_usd: generation.estimatedCostUsd, duration_ms: durationMs }
    });

    invalidatePlatformData();
    return jsonOk({
      jobId: job.id,
      quizId: persisted.quizId,
      targetQuizId,
      subjectId: subject.id,
      questionIds: persisted.questionIds,
      status: 'ready_for_review',
      quizStatus: persisted.status,
      questionCount: persisted.questionCount,
      preEstimate,
      inputTokens: generation.inputTokens,
      outputTokens: generation.outputTokens,
      actualCostUsd: generation.estimatedCostUsd,
      actualCostBrl: usdToBrl(generation.estimatedCostUsd),
      durationMs,
      quiz: deduplicated.quiz,
      duplicatesSkipped: deduplicated.duplicatesSkipped
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido na geração.';
    const durationMs = Date.now() - startedAt;
    console.error('ai_job_failed', { jobId: job.id, error: message });
    await appSchema().from('ai_jobs').update({ status: 'failed', error_message: message.slice(0, 2000), duration_ms: durationMs, updated_at: new Date().toISOString() }).eq('id', job.id);
    await auditLog({ organizationId, actorAuthUid: auth.user.authUid, action: 'ai_job_failed', entityName: 'ai_jobs', entityId: job.id, ipAddress: getRequestIp(request), userAgent: getUserAgent(request), metadata: { error: message.slice(0, 500), duration_ms: durationMs } });
    invalidatePlatformData();
    return jsonError('INTERNAL_ERROR', `Falha ao gerar questões: ${message}`, 502, { jobId: job.id });
  }
}
