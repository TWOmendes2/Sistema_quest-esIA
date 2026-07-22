import { z } from 'zod';
import { getRequestIp, getUserAgent, jsonError, jsonOk } from '@/lib/http';
import { authorizeManagement, canManageAllSubjects, canManageSubject } from '@/server/auth/management';
import { auditLog } from '@/server/audit/audit';
import { invalidatePlatformData } from '@/server/cache/data-cache';
import { appSchema } from '@/server/supabase/admin';

const paramsSchema = z.object({ jobId: z.string().uuid() });
const bodySchema = z.object({ targetQuizId: z.string().uuid().nullable().optional() });

type FinalizeResult = {
  approved: number;
  removed: number;
  bankQuizId: string;
  bankCopied: number;
  targetCopied: number;
};

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;

  const params = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!params.success || !body.success) return jsonError('BAD_REQUEST', 'Dados inválidos para concluir a revisão.', 400);

  const organizationId = auth.membership.organizationId;
  const { data: job, error: jobError } = await appSchema().from('ai_jobs')
    .select('id,quiz_id,target_quiz_id,subject_id,status')
    .eq('id', params.data.jobId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (jobError) return jsonError('INTERNAL_ERROR', jobError.message, 500);
  if (!job) return jsonError('NOT_FOUND', 'Geração não encontrada.', 404);
  if (!canManageSubject(auth.scope, job.subject_id)) return jsonError('FORBIDDEN', 'Professor sem acesso à matéria desta geração.', 403);
  if (job.status !== 'ready_for_review' || !job.quiz_id) {
    return jsonError('CONFLICT', 'Esta geração não está disponível para conclusão.', 409);
  }

  const { data: staging, error: stagingError } = await appSchema().from('quizzes')
    .select('id,subject_id,quiz_kind')
    .eq('id', job.quiz_id)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (stagingError) return jsonError('INTERNAL_ERROR', stagingError.message, 500);
  if (!staging || staging.quiz_kind !== 'ai_review') return jsonError('CONFLICT', 'O lote de revisão não existe mais.', 409);
  if (!canManageSubject(auth.scope, staging.subject_id)) return jsonError('FORBIDDEN', 'Professor sem acesso à matéria deste lote.', 403);

  const targetQuizId = body.data.targetQuizId === undefined ? job.target_quiz_id : body.data.targetQuizId;
  if (targetQuizId) {
    const { data: target, error: targetError } = await appSchema().from('quizzes')
      .select('id,subject_id,quiz_kind,status')
      .eq('id', targetQuizId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (targetError) return jsonError('INTERNAL_ERROR', targetError.message, 500);
    if (!target || target.quiz_kind !== 'assessment' || !['draft', 'review'].includes(target.status)) {
      return jsonError('BAD_REQUEST', 'O simulado de destino não aceita novas questões.', 400);
    }
    const { data: targetLinks, error: targetLinksError } = await appSchema().from('quiz_subjects')
      .select('subject_id')
      .eq('quiz_id', target.id)
      .eq('status', 'active');
    if (targetLinksError) return jsonError('INTERNAL_ERROR', targetLinksError.message, 500);
    const targetSubjectIds = [...new Set([...(targetLinks ?? []).map((item) => item.subject_id), target.subject_id].filter(Boolean))];
    if (!canManageAllSubjects(auth.scope, targetSubjectIds)) return jsonError('FORBIDDEN', 'Você só pode concluir a geração em simulados inteiramente vinculados às suas matérias.', 403);
    if (!targetSubjectIds.includes(job.subject_id)) return jsonError('BAD_REQUEST', 'A matéria da geração não está vinculada ao simulado de destino.', 400);
  }

  const { data, error } = await appSchema().rpc('finalize_ai_review', {
    p_staging_quiz_id: staging.id,
    p_target_quiz_id: targetQuizId,
    p_actor_auth_uid: auth.user.authUid
  });
  if (error) return jsonError('INTERNAL_ERROR', `Não foi possível concluir a revisão: ${error.message}`, 500);

  const result = data as FinalizeResult;
  const { error: updateError } = await appSchema().from('ai_jobs').update({
    status: 'approved',
    target_quiz_id: targetQuizId,
    updated_at: new Date().toISOString()
  }).eq('id', job.id);
  if (updateError) return jsonError('INTERNAL_ERROR', `A revisão foi concluída, mas o histórico não pôde ser atualizado: ${updateError.message}`, 500);

  await auditLog({
    organizationId,
    actorAuthUid: auth.user.authUid,
    action: 'ai_review_finalized',
    entityName: 'ai_jobs',
    entityId: job.id,
    ipAddress: getRequestIp(request),
    userAgent: getUserAgent(request),
    metadata: { target_quiz_id: targetQuizId, ...result }
  });
  invalidatePlatformData();
  return jsonOk(result);
}
