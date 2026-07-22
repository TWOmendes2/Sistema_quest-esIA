import { z } from 'zod';
import { getCpfLast4, isValidCpf, normalizeCpf } from '@/lib/cpf';
import { getRequestIp, getUserAgent, jsonError, jsonOk } from '@/lib/http';
import { env } from '@/server/env';
import { auditLog } from '@/server/audit/audit';
import { hashCpf } from '@/server/security/cpf-hash';
import { createSupabaseAdminClient, appSchema } from '@/server/supabase/admin';

const bodySchema = z.object({
  cpf: z.string().min(11),
  fullName: z.string().min(3),
  email: z.string().email(),
  nickname: z.string().min(2).max(40),
  password: z.string().min(6),
  organizationId: z.string().uuid().optional()
});

export async function POST(request: Request) {
  const ip = getRequestIp(request);
  const userAgent = getUserAgent(request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Dados de cadastro inválidos.', 400, parsed.error.flatten());

  const organizationId = parsed.data.organizationId || env.defaultOrganizationId;
  if (!organizationId) return jsonError('BAD_REQUEST', 'Organização não configurada.', 400);

  const cpf = normalizeCpf(parsed.data.cpf);
  if (!isValidCpf(cpf)) return jsonError('BAD_REQUEST', 'CPF inválido.', 400);

  const cpfHash = hashCpf(cpf);
  const { data: existingProfile } = await appSchema()
    .from('student_profiles')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('cpf_hash', cpfHash)
    .maybeSingle();

  if (existingProfile) return jsonError('CONFLICT', 'Já existe cadastro para este CPF.', 409);

  const { data: registry } = await appSchema()
    .from('students_registry')
    .select('id, status')
    .eq('organization_id', organizationId)
    .eq('cpf_hash', cpfHash)
    .maybeSingle();

  const profileStatus = registry ? 'active' : 'pending';
  const supabase = createSupabaseAdminClient();
  const { data: createdUser, error: authError } = await supabase.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.fullName,
      nickname: parsed.data.nickname
    }
  });

  if (authError || !createdUser.user) return jsonError('INTERNAL_ERROR', authError?.message || 'Erro ao criar usuário.', 500);

  const { data: profile, error: profileError } = await appSchema()
    .from('student_profiles')
    .insert({
      organization_id: organizationId,
      registry_id: registry?.id ?? null,
      auth_uid: createdUser.user.id,
      cpf_hash: cpfHash,
      cpf_last4: getCpfLast4(cpf),
      full_name: parsed.data.fullName,
      email: parsed.data.email,
      nickname: parsed.data.nickname,
      status: profileStatus,
      first_access_completed: true
    })
    .select('id, status')
    .single();

  if (profileError) {
    await supabase.auth.admin.deleteUser(createdUser.user.id);
    return jsonError('INTERNAL_ERROR', profileError.message, 500);
  }

  if (profileStatus === 'active') {
    await appSchema().from('memberships').insert({ organization_id: organizationId, auth_uid: createdUser.user.id, role: 'student', status: 'active' });
    await createEnrollmentsFromRegistry(organizationId, registry?.id, profile.id);
  }

  await auditLog({ organizationId, actorAuthUid: createdUser.user.id, action: 'student_register', entityName: 'student_profiles', entityId: profile.id, ipAddress: ip, userAgent, metadata: { status: profileStatus } });

  return jsonOk({ status: profileStatus, profileId: profile.id }, 201);
}

async function createEnrollmentsFromRegistry(organizationId: string, registryId: string | undefined, studentProfileId: string): Promise<void> {
  if (!registryId) return;

  const { data } = await appSchema()
    .from('registry_enrollments')
    .select('class_id, subject_id, status')
    .eq('organization_id', organizationId)
    .eq('registry_id', registryId)
    .eq('status', 'active');

  if (!data?.length) return;

  await appSchema().from('enrollments').upsert(
    data.map((item) => ({
      organization_id: organizationId,
      student_id: studentProfileId,
      class_id: item.class_id,
      subject_id: item.subject_id,
      status: 'active'
    })),
    { onConflict: 'student_id,class_id,subject_id' }
  );
}
