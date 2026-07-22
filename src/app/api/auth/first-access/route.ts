import { z } from 'zod';
import { getCpfLast4, isValidCpf, normalizeCpf } from '@/lib/cpf';
import { getRequestIp, getUserAgent, jsonError, jsonOk } from '@/lib/http';
import { env } from '@/server/env';
import { auditLog } from '@/server/audit/audit';
import { hashCpf } from '@/server/security/cpf-hash';
import { createSupabaseAdminClient, appSchema } from '@/server/supabase/admin';

const bodySchema = z.object({
  cpf: z.string().min(11),
  email: z.string().email(),
  fullName: z.string().min(3),
  nickname: z.string().min(2).max(40),
  password: z.string().min(6),
  organizationId: z.string().uuid().optional()
});

export async function POST(request: Request) {
  const ip = getRequestIp(request);
  const userAgent = getUserAgent(request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Dados inválidos para primeiro acesso.', 400, parsed.error.flatten());

  const organizationId = parsed.data.organizationId || env.defaultOrganizationId;
  if (!organizationId) return jsonError('BAD_REQUEST', 'Organização não configurada.', 400);

  const cpf = normalizeCpf(parsed.data.cpf);
  if (!isValidCpf(cpf)) return jsonError('BAD_REQUEST', 'CPF inválido.', 400);

  const cpfHash = hashCpf(cpf);
  const { data: registry, error: registryError } = await appSchema()
    .from('students_registry')
    .select('id, full_name, email, status')
    .eq('organization_id', organizationId)
    .eq('cpf_hash', cpfHash)
    .maybeSingle();

  if (registryError) {
    console.error('[FIRST ACCESS][STUDENTS REGISTRY]', {
      code: registryError.code,
      message: registryError.message,
      details: registryError.details,
      hint: registryError.hint
    });

    return jsonError('INTERNAL_ERROR', 'Erro ao consultar base oficial.', 500);
  }
  if (!registry) return jsonError('NOT_FOUND', 'CPF não encontrado na base oficial.', 404);

  const { data: existingProfile } = await appSchema()
    .from('student_profiles')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('cpf_hash', cpfHash)
    .maybeSingle();

  if (existingProfile) return jsonError('CONFLICT', 'Primeiro acesso já foi realizado.', 409);

  const supabase = createSupabaseAdminClient();
  const { data: createdUser, error: authError } = await supabase.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.fullName, nickname: parsed.data.nickname }
  });

  if (authError || !createdUser.user) return jsonError('INTERNAL_ERROR', authError?.message || 'Erro ao criar acesso.', 500);

  const { data: profile, error: profileError } = await appSchema()
    .from('student_profiles')
    .insert({
      organization_id: organizationId,
      registry_id: registry.id,
      auth_uid: createdUser.user.id,
      cpf_hash: cpfHash,
      cpf_last4: getCpfLast4(cpf),
      full_name: parsed.data.fullName,
      email: parsed.data.email,
      nickname: parsed.data.nickname,
      status: 'active',
      first_access_completed: true
    })
    .select('id')
    .single();

  if (profileError) {
    await supabase.auth.admin.deleteUser(createdUser.user.id);
    return jsonError('INTERNAL_ERROR', profileError.message, 500);
  }

  await appSchema().from('memberships').insert({ organization_id: organizationId, auth_uid: createdUser.user.id, role: 'student', status: 'active' });
  await createEnrollmentsFromRegistry(organizationId, registry.id, profile.id);
  await appSchema().from('student_contract_requirements')
    .update({ student_id: profile.id })
    .eq('organization_id', organizationId)
    .eq('registry_id', registry.id);
  const { count: pendingContracts } = await appSchema().from('student_contract_requirements')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('registry_id', registry.id)
    .eq('status', 'pending');
  await auditLog({ organizationId, actorAuthUid: createdUser.user.id, action: 'first_access_completed', entityName: 'student_profiles', entityId: profile.id, ipAddress: ip, userAgent });

  return jsonOk({ profileId: profile.id, status: 'active', pendingContracts: pendingContracts ?? 0 }, 201);
}

async function createEnrollmentsFromRegistry(organizationId: string, registryId: string, studentProfileId: string): Promise<void> {
  const { data, error } = await appSchema()
    .from('registry_enrollments')
    .select('class_id,subject_id,status,contract_status,source,manual_override,blocked_reason')
    .eq('organization_id', organizationId)
    .eq('registry_id', registryId);

  if (error) throw error;
  if (!data?.length) return;

  const { error: enrollmentError } = await appSchema().from('enrollments').upsert(
    data.map((item) => ({
      organization_id: organizationId,
      student_id: studentProfileId,
      class_id: item.class_id,
      subject_id: item.subject_id,
      status: item.status,
      contract_status: item.contract_status || 'not_required',
      source: item.source || 'import',
      manual_override: Boolean(item.manual_override),
      blocked_reason: item.blocked_reason || null
    })),
    { onConflict: 'student_id,class_id,subject_id' }
  );
  if (enrollmentError) throw enrollmentError;
}
