import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { authorizeManagement } from '@/server/auth/management';
import { auditLog } from '@/server/audit/audit';
import { invalidatePlatformData } from '@/server/cache/data-cache';
import { appSchema } from '@/server/supabase/admin';

const bodySchema = z.object({
  enrollmentId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  status: z.enum(['active', 'delinquent', 'blocked', 'inactive']),
  contractStatus: z.enum(['not_required', 'pending', 'signed', 'waived']).default('not_required'),
  reason: z.string().trim().max(500).nullable().optional()
}).refine((value) => value.enrollmentId || (value.classId && value.subjectId), {
  message: 'Informe o vínculo ou a turma e a matéria.'
});

export async function PATCH(request: Request, context: { params: Promise<{ studentId: string }> }) {
  const auth = await authorizeManagement(request, ['admin', 'coordinator']);
  if (!auth.ok) return auth.response;
  const { studentId } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Dados de acesso inválidos.', 400, parsed.error.flatten());

  const organizationId = auth.membership.organizationId;
  const { data: profile, error: profileError } = await appSchema().from('student_profiles')
    .select('id,registry_id,full_name')
    .eq('organization_id', organizationId)
    .eq('id', studentId)
    .maybeSingle();
  if (profileError) return jsonError('INTERNAL_ERROR', profileError.message, 500);

  let registryId = profile?.registry_id || null;
  const profileId = profile?.id || null;
  let displayName = profile?.full_name || null;

  if (!profile) {
    const { data: registry, error: registryError } = await appSchema().from('students_registry')
      .select('id,full_name')
      .eq('organization_id', organizationId)
      .eq('id', studentId)
      .maybeSingle();
    if (registryError) return jsonError('INTERNAL_ERROR', registryError.message, 500);
    if (!registry) return jsonError('NOT_FOUND', 'Aluno não encontrado.', 404);
    registryId = registry.id;
    displayName = registry.full_name;
  }

  let classId = parsed.data.classId;
  let subjectId = parsed.data.subjectId;
  const enrollmentId = parsed.data.enrollmentId;

  if (enrollmentId) {
    const table = profileId ? 'enrollments' : 'registry_enrollments';
    let query = appSchema().from(table)
      .select('id,class_id,subject_id')
      .eq('organization_id', organizationId)
      .eq('id', enrollmentId);
    query = profileId ? query.eq('student_id', profileId) : query.eq('registry_id', registryId!);
    const { data: enrollment, error } = await query.maybeSingle();
    if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
    if (!enrollment) return jsonError('NOT_FOUND', 'Vínculo não encontrado.', 404);
    classId = enrollment.class_id;
    subjectId = enrollment.subject_id;
  }

  if (!classId || !subjectId) return jsonError('BAD_REQUEST', 'Turma e matéria são obrigatórias.', 400);

  const sharedPayload = {
    organization_id: organizationId,
    class_id: classId,
    subject_id: subjectId,
    status: parsed.data.status,
    contract_status: parsed.data.contractStatus,
    source: 'manual',
    manual_override: true,
    blocked_reason: parsed.data.reason || null
  };

  let saved: Record<string, unknown> | null = null;
  if (profileId) {
    const { data, error: saveError } = await appSchema().from('enrollments')
      .upsert({ ...sharedPayload, student_id: profileId }, { onConflict: 'student_id,class_id,subject_id' })
      .select('id,class_id,subject_id,status,contract_status,manual_override,blocked_reason')
      .single();
    if (saveError) return jsonError('INTERNAL_ERROR', saveError.message, 500);
    saved = data;
  }

  if (registryId) {
    const { data, error: registryError } = await appSchema().from('registry_enrollments').upsert({
      ...sharedPayload,
      registry_id: registryId
    }, { onConflict: 'registry_id,class_id,subject_id' })
      .select('id,class_id,subject_id,status,contract_status,manual_override,blocked_reason')
      .single();
    if (registryError) return jsonError('INTERNAL_ERROR', registryError.message, 500);
    if (!saved) saved = data;
  }

  const { data: classRow, error: classError } = await appSchema().from('classes')
    .select('name')
    .eq('organization_id', organizationId)
    .eq('id', classId)
    .maybeSingle();
  if (classError) return jsonError('INTERNAL_ERROR', classError.message, 500);

  if (registryId && parsed.data.contractStatus === 'pending') {
    const { error } = await appSchema().from('student_contract_requirements').upsert({
      organization_id: organizationId,
      registry_id: registryId,
      student_id: profileId,
      class_id: classId,
      contract_name: classRow?.name || 'Contrato da turma',
      status: 'pending',
      source: 'manual',
      resolved_at: null,
      resolved_by: null
    }, { onConflict: 'organization_id,registry_id,contract_name' });
    if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  } else if (registryId) {
    const { error } = await appSchema().from('student_contract_requirements')
      .update({
        status: parsed.data.contractStatus === 'signed' ? 'signed' : parsed.data.contractStatus === 'waived' ? 'waived' : 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by: auth.user.authUid
      })
      .eq('organization_id', organizationId)
      .eq('registry_id', registryId)
      .eq('class_id', classId)
      .eq('status', 'pending');
    if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  }

  await auditLog({
    organizationId,
    actorAuthUid: auth.user.authUid,
    action: 'student_access_updated',
    entityName: profileId ? 'enrollments' : 'registry_enrollments',
    entityId: String(saved?.id || enrollmentId || studentId),
    metadata: {
      student_id: profileId,
      registry_id: registryId,
      student_name: displayName,
      class_id: classId,
      subject_id: subjectId,
      status: parsed.data.status,
      contract_status: parsed.data.contractStatus,
      reason: parsed.data.reason || null
    }
  });

  invalidatePlatformData();
  return jsonOk(saved || { class_id: classId, subject_id: subjectId });
}
