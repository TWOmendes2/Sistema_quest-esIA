import { z } from 'zod';
import { getRequestIp, getUserAgent, jsonError, jsonOk } from '@/lib/http';
import { auditLog } from '@/server/audit/audit';
import { authorizeManagement } from '@/server/auth/management';
import { appSchema } from '@/server/supabase/admin';

const bodySchema = z.object({ action: z.enum(['approve', 'reject']) });

export async function POST(request: Request, context: { params: Promise<{ studentId: string }> }) {
  const auth = await authorizeManagement(request, ['admin', 'coordinator']);
  if (!auth.ok) return auth.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Ação inválida.', 400);
  const { studentId } = await context.params;
  const { data: profile, error: profileError } = await appSchema()
    .from('student_profiles')
    .select('id,organization_id,status,registry_id')
    .eq('id', studentId)
    .eq('organization_id', auth.membership.organizationId)
    .maybeSingle();
  if (profileError) return jsonError('INTERNAL_ERROR', profileError.message, 500);
  if (!profile) return jsonError('NOT_FOUND', 'Cadastro não encontrado.', 404);
  if (profile.status !== 'pending') return jsonError('CONFLICT', 'Este cadastro já foi analisado.', 409);

  const nextStatus = parsed.data.action === 'approve' ? 'active' : 'rejected';
  const { data, error } = await appSchema()
    .from('student_profiles')
    .update({
      status: nextStatus,
      approved_by: parsed.data.action === 'approve' ? auth.user.authUid : null,
      approved_at: parsed.data.action === 'approve' ? new Date().toISOString() : null
    })
    .eq('id', profile.id)
    .eq('organization_id', auth.membership.organizationId)
    .select('id,status')
    .single();
  if (error) return jsonError('INTERNAL_ERROR', error.message, 500);

  if (parsed.data.action === 'approve' && profile.registry_id) {
    const { data: pendingEnrollments } = await appSchema()
      .from('registry_enrollments')
      .select('class_id,subject_id,status')
      .eq('registry_id', profile.registry_id)
      .eq('organization_id', auth.membership.organizationId)
      .eq('status', 'active');
    if (pendingEnrollments?.length) {
      const { error: enrollmentError } = await appSchema().from('enrollments').upsert(
        pendingEnrollments.map((item) => ({
          organization_id: auth.membership.organizationId,
          student_id: profile.id,
          class_id: item.class_id,
          subject_id: item.subject_id,
          status: 'active'
        })),
        { onConflict: 'student_id,class_id,subject_id' }
      );
      if (enrollmentError) return jsonError('INTERNAL_ERROR', `Cadastro aprovado, mas houve erro no vínculo: ${enrollmentError.message}`, 500);
    }
  }

  await auditLog({
    organizationId: auth.membership.organizationId,
    actorAuthUid: auth.user.authUid,
    action: parsed.data.action === 'approve' ? 'student_approved' : 'student_rejected',
    entityName: 'student_profiles',
    entityId: profile.id,
    ipAddress: getRequestIp(request),
    userAgent: getUserAgent(request),
    metadata: { previous_status: profile.status, status: nextStatus }
  });
  return jsonOk(data);
}
