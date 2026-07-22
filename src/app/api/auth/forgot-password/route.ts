import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getRequestIp, getUserAgent, jsonError, jsonOk } from '@/lib/http';
import { isValidCpf, normalizeCpf } from '@/lib/cpf';
import { env } from '@/server/env';
import { auditLog } from '@/server/audit/audit';
import { hashCpf } from '@/server/security/cpf-hash';
import { checkRateLimit } from '@/server/security/rate-limit';
import { appSchema, createSupabaseAdminClient } from '@/server/supabase/admin';
import { generateRecoveryCode, hashRecoveryCode, hashRecoveryEmail, normalizeEmail, sendPasswordResetCode } from '@/server/auth/password-reset-code';

const bodySchema = z.object({
  mode: z.enum(['student', 'staff']),
  email: z.string().email().optional(),
  cpf: z.string().optional(),
  organizationId: z.string().uuid().optional()
}).superRefine((value, context) => {
  if (value.mode === 'student' && !value.cpf) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe o CPF.', path: ['cpf'] });
  if (value.mode === 'staff' && !value.email) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe o e-mail.', path: ['email'] });
});

export async function POST(request: Request) {
  const requestId = randomUUID();
  const ip = getRequestIp(request); const userAgent = getUserAgent(request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Dados inválidos para recuperação de senha.', 400, parsed.error.flatten());
  const organizationId = parsed.data.organizationId || env.defaultOrganizationId || null;
  if (!organizationId) return jsonError('BAD_REQUEST', 'Organização não configurada.', 400);
  const ipLimit = checkRateLimit({ key: `password-reset:ip:${ip}`, limit: 5, windowSeconds: 900, blockSeconds: 900 });
  if (!ipLimit.allowed) return jsonError('RATE_LIMITED', 'Muitas solicitações. Aguarde alguns minutos e tente novamente.', 429, ipLimit);

  if (parsed.data.mode === 'student') {
    const cpf = normalizeCpf(parsed.data.cpf || '');
    if (!isValidCpf(cpf)) return jsonError('BAD_REQUEST', 'CPF inválido.', 400);
    const cpfHash = hashCpf(cpf);
    const accountLimit = checkRateLimit({ key: `password-reset:student:${cpfHash}`, limit: 3, windowSeconds: 900, blockSeconds: 900 });
    if (!accountLimit.allowed) return jsonError('RATE_LIMITED', 'Já existem solicitações recentes para este CPF. Aguarde alguns minutos.', 429, accountLimit);
    const { data: profile, error } = await appSchema().from('student_profiles')
      .select('id,auth_uid,status,organization_id').eq('organization_id', organizationId).eq('cpf_hash', cpfHash).maybeSingle();
    if (error) return jsonError('INTERNAL_ERROR', 'Não foi possível registrar a solicitação agora.', 500);
    if (profile?.status === 'active' && profile.auth_uid) {
      const ipHash = createHash('sha256').update(ip).digest('hex');
      const { data: pending, error: pendingError } = await appSchema().from('password_reset_requests')
        .select('id,status').eq('organization_id', organizationId).eq('student_id', profile.id).in('status', ['pending', 'processing']).limit(1).maybeSingle();
      if (pendingError) return jsonError('INTERNAL_ERROR', 'Não foi possível consultar a fila de solicitações.', 500);
      if (!pending) {
        const { error: insertError } = await appSchema().from('password_reset_requests').insert({
          organization_id: organizationId, student_id: profile.id, auth_uid: profile.auth_uid,
          cpf_last4: cpf.slice(-4), status: 'pending', requested_ip_hash: ipHash
        });
        // A restrição parcial impede duas solicitações pendentes em chamadas concorrentes.
        if (insertError && !insertError.message.toLowerCase().includes('duplicate')) {
          return jsonError('INTERNAL_ERROR', `Não foi possível registrar a solicitação. Confirme a migration 013. ${insertError.message}`, 500);
        }
      }
      await auditLog({ organizationId, actorAuthUid: profile.auth_uid, action: 'password_reset_requested_for_review', entityName: 'password_reset_requests', ipAddress: ip, userAgent, metadata: { request_id: requestId, cpf_last4: cpf.slice(-4), already_pending: Boolean(pending) } });
    }
    return jsonOk({ requestId, pending: true, message: 'Solicitação registrada e enviada à recepção. A alteração não é imediata. A equipe validará seus dados e informará uma senha temporária. Depois do acesso, você deverá criar uma senha pessoal.' });
  }

  const email = normalizeEmail(parsed.data.email || '');
  const accountHash = createHash('sha256').update(`staff:${email}`).digest('hex');
  const accountLimit = checkRateLimit({ key: `password-reset:account:${accountHash}`, limit: 3, windowSeconds: 900, blockSeconds: 900 });
  if (!accountLimit.allowed) return jsonError('RATE_LIMITED', 'Muitas solicitações para este acesso. Aguarde alguns minutos.', 429, accountLimit);
  const authUser = await findAuthUserByEmail(email);
  let actorAuthUid: string | null = null; let matchedOrganizationId: string | null = organizationId;
  if (authUser) {
    const { data: membership } = await appSchema().from('memberships').select('organization_id').eq('auth_uid', authUser.id).eq('status', 'active').eq('organization_id', organizationId).in('role', ['admin', 'coordinator', 'teacher']).limit(1).maybeSingle();
    if (membership) { actorAuthUid = authUser.id; matchedOrganizationId = membership.organization_id; }
  }
  if (actorAuthUid) {
    const code = generateRecoveryCode(); const expiresAt = new Date(Date.now() + Math.max(5, Math.min(30, env.passwordResetCodeMinutes)) * 60_000).toISOString();
    await appSchema().from('password_reset_codes').update({ consumed_at: new Date().toISOString() }).eq('auth_uid', actorAuthUid).eq('mode', 'staff').is('consumed_at', null);
    const { data: resetRow, error: insertError } = await appSchema().from('password_reset_codes').insert({ organization_id: matchedOrganizationId, auth_uid: actorAuthUid, mode: 'staff', email_hash: hashRecoveryEmail(email), code_hash: hashRecoveryCode(actorAuthUid, email, code), expires_at: expiresAt, requested_ip_hash: createHash('sha256').update(ip).digest('hex') }).select('id').single();
    if (insertError) return jsonError('INTERNAL_ERROR', `Não foi possível gerar o código. ${insertError.message}`, 500);
    try { await sendPasswordResetCode(email, code); } catch (error) { await appSchema().from('password_reset_codes').delete().eq('id', resetRow.id); console.error('[PASSWORD RESET CODE][EMAIL]', { requestId, error }); return jsonError('EMAIL_DELIVERY_FAILED', 'Não foi possível enviar o código agora.', 503); }
  }
  await auditLog({ organizationId: matchedOrganizationId, actorAuthUid, action: 'password_reset_code_requested', entityName: 'auth_user', ipAddress: ip, userAgent, metadata: { mode: 'staff', email_hash: hashRecoveryEmail(email), matched: Boolean(actorAuthUid), request_id: requestId } });
  return jsonOk({ message: 'Se o e-mail estiver correto, enviaremos um código de 6 dígitos.', requestId, expiresInMinutes: env.passwordResetCodeMinutes });
}

async function findAuthUserByEmail(email: string): Promise<{ id: string } | null> {
  const client = createSupabaseAdminClient();
  for (let page = 1; page <= 20; page += 1) { const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 }); if (error) throw new Error(error.message); const user = data.users.find((item) => normalizeEmail(item.email || '') === email); if (user) return { id: user.id }; if (data.users.length < 1000) break; }
  return null;
}
