import { z } from 'zod';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCpfLast4, isValidCpf, normalizeCpf } from '@/lib/cpf';
import { getRequestIp, getUserAgent, jsonError } from '@/lib/http';
import { env } from '@/server/env';
import { auditLog } from '@/server/audit/audit';
import { hashCpf } from '@/server/security/cpf-hash';
import { checkRateLimit, resetRateLimit } from '@/server/security/rate-limit';
import { createSupabaseAnonServerClient, appSchema } from '@/server/supabase/admin';
import { getMemberships, setSessionCookies } from '@/server/auth/session';

const bodySchema = z.object({
  cpf: z.string().min(11).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6),
  organizationId: z.string().uuid().optional()
}).superRefine((value, context) => {
  if (Boolean(value.cpf) === Boolean(value.email)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe CPF ou e-mail.', path: ['cpf'] });
  }
});

export async function POST(request: Request) {
  const ip = getRequestIp(request);
  const userAgent = getUserAgent(request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Dados de login inválidos.', 400, parsed.error.flatten());

  if (parsed.data.email) {
    return loginStaff({
      email: parsed.data.email,
      password: parsed.data.password,
      organizationId: parsed.data.organizationId || env.defaultOrganizationId,
      ip,
      userAgent
    });
  }

  const organizationId = parsed.data.organizationId || env.defaultOrganizationId;
  if (!organizationId) return jsonError('BAD_REQUEST', 'Organização não configurada.', 400);

  const cpf = normalizeCpf(parsed.data.cpf as string);
  if (!isValidCpf(cpf)) return jsonError('BAD_REQUEST', 'CPF inválido.', 400);

  const ipLimit = checkRateLimit({ key: `login:ip:${ip}`, limit: env.loginRateLimitMax, windowSeconds: env.loginRateLimitWindowSeconds });
  if (!ipLimit.allowed) return jsonError('RATE_LIMITED', 'Muitas tentativas de login. Tente novamente depois.', 429, ipLimit);

  const cpfHash = hashCpf(cpf);
  const cpfLimit = checkRateLimit({ key: `login:cpf:${cpfHash}`, limit: env.loginRateLimitMax, windowSeconds: env.loginRateLimitWindowSeconds });
  if (!cpfLimit.allowed) return jsonError('RATE_LIMITED', 'Muitas tentativas para este CPF. Tente novamente depois.', 429, cpfLimit);

  const { data: profile, error: profileError } = await appSchema()
    .from('student_profiles')
    .select('id, auth_uid, email, status, organization_id')
    .eq('organization_id', organizationId)
    .eq('cpf_hash', cpfHash)
    .maybeSingle();

  if (profileError) return jsonError('INTERNAL_ERROR', 'Erro ao buscar perfil.', 500);

  if (!profile) {
    const { data: registry } = await appSchema()
      .from('students_registry')
      .select('id, status')
      .eq('organization_id', organizationId)
      .eq('cpf_hash', cpfHash)
      .maybeSingle();

    await auditLog({ organizationId, action: 'login_profile_not_found', entityName: 'student_profiles', ipAddress: ip, userAgent, metadata: { cpf_last4: getCpfLast4(cpf), registry_exists: Boolean(registry) } });
    return jsonError(registry ? 'UNAUTHORIZED' : 'NOT_FOUND', registry ? 'Primeiro acesso necessário para criar sua senha.' : 'CPF não encontrado.', registry ? 401 : 404);
  }

  if (profile.status !== 'active') {
    await auditLog({ organizationId, actorAuthUid: profile.auth_uid, action: 'login_denied_status', entityName: 'student_profiles', entityId: profile.id, ipAddress: ip, userAgent, metadata: { status: profile.status } });
    return jsonError('FORBIDDEN', 'Cadastro ainda não está ativo.', 403);
  }

  const supabase = createSupabaseAnonServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password: parsed.data.password
  });

  if (error || !data.session) {
    await auditLog({ organizationId, actorAuthUid: profile.auth_uid, action: 'login_failed', entityName: 'student_profiles', entityId: profile.id, ipAddress: ip, userAgent });
    return jsonError('UNAUTHORIZED', 'CPF ou senha inválidos.', 401);
  }

  resetRateLimit(`login:cpf:${cpfHash}`);
  await auditLog({ organizationId, actorAuthUid: data.user.id, action: 'login_success', entityName: 'student_profiles', entityId: profile.id, ipAddress: ip, userAgent });

  const { data: memberships } = await appSchema()
    .from('memberships')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('auth_uid', data.user.id)
    .eq('status', 'active');

  const managementRoles = new Set(['teacher', 'coordinator', 'admin']);
  const redirectTo = data.user.user_metadata?.must_change_password === true
    ? '/trocar-senha-temporaria'
    : memberships?.some((membership) => managementRoles.has(membership.role))
      ? '/admin'
      : '/dashboard';

  const response = NextResponse.json({ ok: true, data: { userId: data.user.id, redirectTo } });
  setSessionCookies(response, data.session.access_token, data.session.refresh_token, data.session.expires_in);
  return response;
}

async function loginStaff(input: {
  email: string;
  password: string;
  organizationId?: string;
  ip: string;
  userAgent: string;
}) {
  const email = input.email.trim().toLowerCase();
  const accountHash = createHash('sha256').update(email).digest('hex');
  const ipLimit = checkRateLimit({ key: `login:ip:${input.ip}`, limit: env.loginRateLimitMax, windowSeconds: env.loginRateLimitWindowSeconds });
  if (!ipLimit.allowed) return jsonError('RATE_LIMITED', 'Muitas tentativas de login. Tente novamente depois.', 429, ipLimit);

  const accountLimit = checkRateLimit({ key: `login:staff:${accountHash}`, limit: env.loginRateLimitMax, windowSeconds: env.loginRateLimitWindowSeconds });
  if (!accountLimit.allowed) return jsonError('RATE_LIMITED', 'Muitas tentativas para este acesso. Tente novamente depois.', 429, accountLimit);

  const supabase = createSupabaseAnonServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: input.password });
  if (error || !data.session) {
    await auditLog({ organizationId: input.organizationId, action: 'staff_login_failed', entityName: 'auth_session', ipAddress: input.ip, userAgent: input.userAgent });
    return jsonError('UNAUTHORIZED', 'E-mail ou senha inválidos.', 401);
  }

  let memberships;
  try {
    memberships = await getMemberships(data.user.id);
  } catch {
    return jsonError('INTERNAL_ERROR', 'Erro ao consultar permissões do usuário.', 500);
  }

  const managementRoles = new Set(['teacher', 'coordinator', 'admin']);
  const activeManagementMemberships = memberships.filter((membership) =>
    managementRoles.has(membership.role)
  );
  const expectedOrganizationId = input.organizationId?.trim();

  // Prefer the configured organization. In a single-organization installation,
  // safely fall back to the user's only active management membership. This also
  // protects deployments where a value was pasted into Vercel with wrapping quotes.
  const managementMembership = (expectedOrganizationId
    ? activeManagementMemberships.find(
        (membership) => membership.organization_id === expectedOrganizationId
      )
    : undefined)
    ?? (activeManagementMemberships.length === 1
      ? activeManagementMemberships[0]
      : undefined);

  if (!managementMembership) {
    await auditLog({
      organizationId: expectedOrganizationId,
      actorAuthUid: data.user.id,
      action: 'staff_login_denied_role',
      entityName: 'memberships',
      ipAddress: input.ip,
      userAgent: input.userAgent,
      metadata: {
        expected_organization_id: expectedOrganizationId ?? null,
        active_management_memberships: activeManagementMemberships.map((membership) => ({
          organization_id: membership.organization_id,
          role: membership.role
        }))
      }
    });

    const message = activeManagementMemberships.length > 0
      ? 'O usuário possui vínculo de equipe, mas a organização configurada no ambiente não corresponde ao vínculo ativo.'
      : 'Usuário sem vínculo ativo de professor, coordenador ou administrador.';

    return jsonError('FORBIDDEN', message, 403);
  }

  resetRateLimit(`login:staff:${accountHash}`);
  await auditLog({ organizationId: managementMembership.organization_id, actorAuthUid: data.user.id, action: 'staff_login_success', entityName: 'memberships', ipAddress: input.ip, userAgent: input.userAgent, metadata: { role: managementMembership.role } });

  const response = NextResponse.json({ ok: true, data: { userId: data.user.id, redirectTo: '/admin' } });
  setSessionCookies(response, data.session.access_token, data.session.refresh_token, data.session.expires_in);
  return response;
}
