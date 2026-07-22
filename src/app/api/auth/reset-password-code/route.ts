import { z } from 'zod';
import { getRequestIp, getUserAgent, jsonError, jsonOk } from '@/lib/http';
import { appSchema, createSupabaseAdminClient } from '@/server/supabase/admin';
import { auditLog } from '@/server/audit/audit';
import { checkRateLimit, resetRateLimit } from '@/server/security/rate-limit';
import { hashRecoveryEmail, normalizeEmail, recoveryCodeMatches } from '@/server/auth/password-reset-code';

const bodySchema = z.object({
  mode: z.enum(['student', 'staff']),
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'O código deve ter 6 dígitos.'),
  password: z.string().min(8, 'A senha deve ter no mínimo 8 caracteres.').max(128)
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Dados inválidos.', 400, parsed.error.flatten());

  const email = normalizeEmail(parsed.data.email);
  const emailHash = hashRecoveryEmail(email);
  const ip = getRequestIp(request);
  const userAgent = getUserAgent(request);
  const rateKey = `password-reset-verify:${ip}:${emailHash}`;
  const limit = checkRateLimit({ key: rateKey, limit: 8, windowSeconds: 900, blockSeconds: 900 });
  if (!limit.allowed) return jsonError('RATE_LIMITED', 'Muitas tentativas. Solicite um novo código mais tarde.', 429, limit);

  const { data: resetRow, error } = await appSchema()
    .from('password_reset_codes')
    .select('id,organization_id,auth_uid,mode,email_hash,code_hash,attempts,max_attempts,expires_at,consumed_at')
    .eq('email_hash', emailHash)
    .eq('mode', parsed.data.mode)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return jsonError('INTERNAL_ERROR', `Não foi possível validar o código. Aplique a migration 012. ${error.message}`, 500);
  if (!resetRow || new Date(resetRow.expires_at).getTime() <= Date.now()) {
    return jsonError('INVALID_CODE', 'Código inválido ou expirado. Solicite um novo código.', 400);
  }

  if (Number(resetRow.attempts || 0) >= Number(resetRow.max_attempts || 5)) {
    await appSchema().from('password_reset_codes').update({ consumed_at: new Date().toISOString() }).eq('id', resetRow.id);
    return jsonError('INVALID_CODE', 'Este código foi bloqueado. Solicite um novo código.', 400);
  }

  const matches = recoveryCodeMatches(resetRow.code_hash, resetRow.auth_uid, email, parsed.data.code);
  if (!matches) {
    const attempts = Number(resetRow.attempts || 0) + 1;
    await appSchema().from('password_reset_codes').update({
      attempts,
      ...(attempts >= Number(resetRow.max_attempts || 5) ? { consumed_at: new Date().toISOString() } : {})
    }).eq('id', resetRow.id);
    return jsonError('INVALID_CODE', 'Código inválido ou expirado. Confira os 6 dígitos.', 400);
  }

  const admin = createSupabaseAdminClient();
  const { error: passwordError } = await admin.auth.admin.updateUserById(resetRow.auth_uid, {
    password: parsed.data.password
  });
  if (passwordError) return jsonError('INTERNAL_ERROR', `Não foi possível atualizar a senha: ${passwordError.message}`, 500);

  await appSchema().from('password_reset_codes').update({ consumed_at: new Date().toISOString() }).eq('id', resetRow.id);
  await appSchema().from('password_reset_codes').update({ consumed_at: new Date().toISOString() })
    .eq('auth_uid', resetRow.auth_uid)
    .is('consumed_at', null);

  await auditLog({
    organizationId: resetRow.organization_id,
    actorAuthUid: resetRow.auth_uid,
    action: 'password_reset_code_completed',
    entityName: 'auth_user',
    ipAddress: ip,
    userAgent,
    metadata: { mode: parsed.data.mode }
  });

  resetRateLimit(rateKey);
  return jsonOk({ updated: true, message: 'Senha alterada com sucesso. Você já pode entrar no sistema.' });
}
