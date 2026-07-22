import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { authorizeManagement, canManageSubject } from '@/server/auth/management';
import { appSchema } from '@/server/supabase/admin';
import { auditLog } from '@/server/audit/audit';
import { invalidatePlatformData } from '@/server/cache/data-cache';
import { getOwnedQuestionContext, prepareQuizForQuestionMutation } from '@/server/data/question-access';

const paramsSchema = z.object({ questionId: z.string().uuid() });
const bodySchema = z.object({ status: z.enum(['review', 'approved', 'rejected']) });

export async function POST(request: Request, context: { params: Promise<{ questionId: string }> }) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;
  const params = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) return jsonError('BAD_REQUEST', 'Revisão inválida.', 400);

  const owner = await getOwnedQuestionContext(params.data.questionId, auth.membership.organizationId).catch(() => null);
  if (!owner) return jsonError('NOT_FOUND', 'Questão não encontrada.', 404);
  if (!canManageSubject(auth.scope, owner.subjectId)) return jsonError('FORBIDDEN', 'Você não pode revisar questões desta matéria.', 403);
  const editable = await prepareQuizForQuestionMutation(owner.quizId, owner.quiz.status, auth.membership.organizationId)
    .catch((error) => ({ ok: false as const, message: error instanceof Error ? error.message : 'Não foi possível validar o simulado.' }));
  if (!editable.ok) return jsonError('CONFLICT', editable.message, 409);

  // Questões rejeitadas permanecem no lote até a conclusão da revisão.

  const { data, error } = await appSchema().rpc('set_question_review_status', {
    p_question_id: params.data.questionId,
    p_actor_auth_uid: auth.user.authUid,
    p_status: body.data.status
  });
  if (error) return jsonError('INTERNAL_ERROR', `Não foi possível revisar: ${error.message}. Confirme se a migration 003 foi aplicada.`, 500);
  await auditLog({ organizationId: auth.membership.organizationId, actorAuthUid: auth.user.authUid, action: `question_${body.data.status}`, entityName: 'quiz_questions', entityId: params.data.questionId });
  invalidatePlatformData();
  return jsonOk({ status: data || body.data.status, deleted: false });
}
