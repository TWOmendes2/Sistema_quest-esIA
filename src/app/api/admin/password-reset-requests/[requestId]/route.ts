import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { authorizeManagement } from '@/server/auth/management';
import { appSchema, createSupabaseAdminClient } from '@/server/supabase/admin';
import { jsonError, jsonOk } from '@/lib/http';
import { auditLog } from '@/server/audit/audit';
import { invalidatePlatformData } from '@/server/cache/data-cache';

const paramsSchema = z.object({ requestId: z.string().uuid() });
const bodySchema = z.object({ action: z.enum(['approve', 'reject']), reason: z.string().trim().max(500).optional() });

export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const auth = await authorizeManagement(request, ['admin', 'coordinator']);
  if (!auth.ok) return auth.response;
  const params = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) return jsonError('BAD_REQUEST', 'Dados inválidos.', 400);

  const organizationId = auth.membership.organizationId;
  const { data: reset, error } = await appSchema().from('password_reset_requests')
    .select('id,auth_uid,student_id,status')
    .eq('id', params.data.requestId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  if (!reset) return jsonError('NOT_FOUND', 'Solicitação não encontrada.', 404);
  if (reset.status !== 'pending') return jsonError('CONFLICT', 'Esta solicitação já foi analisada ou está em processamento.', 409);

  if (body.data.action === 'reject') {
    const { data: rejected, error: updateError } = await appSchema().from('password_reset_requests')
      .update({ status: 'rejected', reviewed_by: auth.user.authUid, reviewed_at: new Date().toISOString(), rejection_reason: body.data.reason || null })
      .eq('id', reset.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (updateError) return jsonError('INTERNAL_ERROR', updateError.message, 500);
    if (!rejected) return jsonError('CONFLICT', 'A solicitação já foi assumida por outro atendente.', 409);
    await auditLog({ organizationId, actorAuthUid: auth.user.authUid, action: 'password_reset_rejected', entityName: 'password_reset_requests', entityId: reset.id, metadata: { reason: body.data.reason || null } });
    invalidatePlatformData();
    return jsonOk({ status: 'rejected' });
  }

  // Reserva a solicitação antes de alterar a senha para impedir duas aprovações simultâneas.
  const { data: claimed, error: claimError } = await appSchema().from('password_reset_requests')
    .update({ status: 'processing', reviewed_by: auth.user.authUid, reviewed_at: new Date().toISOString() })
    .eq('id', reset.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (claimError) return jsonError('INTERNAL_ERROR', claimError.message, 500);
  if (!claimed) return jsonError('CONFLICT', 'A solicitação já foi assumida por outro atendente.', 409);

  const temporaryPassword = `Btg!${randomBytes(12).toString('base64url')}`;
  const client = createSupabaseAdminClient();
  const { data: userData, error: userReadError } = await client.auth.admin.getUserById(reset.auth_uid);
  if (userReadError || !userData.user) {
    await releaseRequest(reset.id);
    return jsonError('INTERNAL_ERROR', userReadError?.message || 'Usuário não encontrado.', 500);
  }

  const issuedAt = new Date().toISOString();
  const { error: passwordError } = await client.auth.admin.updateUserById(reset.auth_uid, {
    password: temporaryPassword,
    user_metadata: {
      ...(userData.user.user_metadata ?? {}),
      must_change_password: true,
      temporary_password_issued_at: issuedAt
    }
  });
  if (passwordError) {
    await releaseRequest(reset.id);
    return jsonError('INTERNAL_ERROR', passwordError.message, 500);
  }

  const { data: approved, error: updateError } = await appSchema().from('password_reset_requests')
    .update({ status: 'approved', temporary_password_issued_at: issuedAt })
    .eq('id', reset.id)
    .eq('status', 'processing')
    .eq('reviewed_by', auth.user.authUid)
    .select('id')
    .maybeSingle();
  if (updateError || !approved) {
    await auditLog({
      organizationId,
      actorAuthUid: auth.user.authUid,
      action: 'password_reset_queue_inconsistent',
      entityName: 'password_reset_requests',
      entityId: reset.id,
      metadata: {
        student_id: reset.student_id,
        password_changed: true,
        queue_error: updateError?.message || 'update_without_row'
      }
    });
    invalidatePlatformData();
    // A senha já foi alterada no provedor de autenticação. Ela precisa ser
    // mostrada agora para não deixar o aluno com uma senha desconhecida.
    return jsonOk({
      status: 'processing',
      temporaryPassword,
      warning: 'A senha foi alterada, mas a fila não confirmou a conclusão. Entregue esta senha ao aluno e encaminhe o protocolo ao suporte.'
    });
  }

  await auditLog({ organizationId, actorAuthUid: auth.user.authUid, action: 'password_reset_approved', entityName: 'password_reset_requests', entityId: reset.id, metadata: { student_id: reset.student_id } });
  invalidatePlatformData();
  // A senha não é persistida na aplicação e é retornada apenas nesta resposta.
  return jsonOk({ status: 'approved', temporaryPassword });
}

async function releaseRequest(id: string) {
  await appSchema().from('password_reset_requests')
    .update({ status: 'pending', reviewed_by: null, reviewed_at: null })
    .eq('id', id)
    .eq('status', 'processing');
}
