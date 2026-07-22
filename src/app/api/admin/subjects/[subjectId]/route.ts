import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { authorizeManagement } from '@/server/auth/management';
import { appSchema } from '@/server/supabase/admin';
import { auditLog } from '@/server/audit/audit';
import { subjectCode, subjectColor, subjectLogo, subjectTeachers } from '@/lib/subject';
import { invalidatePlatformData } from '@/server/cache/data-cache';

const paramsSchema = z.object({ subjectId: z.string().uuid() });
const bodySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  code: z.string().trim().min(2).max(20).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  status: z.literal('active').optional()
}).refine((value) => Object.keys(value).length > 0, 'Nenhum campo informado.');

export async function PATCH(request: Request, context: { params: Promise<{ subjectId: string }> }) {
  const auth = await authorizeManagement(request, ['admin', 'coordinator']);
  if (!auth.ok) return auth.response;
  const params = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) return jsonError('BAD_REQUEST', 'Dados inválidos.', 400, body.success ? undefined : body.error.flatten());
  const patch: Record<string, unknown> = { ...body.data };
  if (body.data.name || body.data.code) patch.code = subjectCode(body.data.name, body.data.code);
  if (body.data.color || body.data.name) patch.color = subjectColor(body.data.name, body.data.color);
  if (body.data.name) {
    patch.logo_path = subjectLogo(body.data.name);
    patch.teacher_names = subjectTeachers(body.data.name);
  }
  const { data, error } = await appSchema().from('subjects').update(patch)
    .eq('id', params.data.subjectId)
    .eq('organization_id', auth.membership.organizationId)
    .select('id,name,code,color,status,logo_path,teacher_names').maybeSingle();
  if (error) return jsonError(error.code === '23505' ? 'CONFLICT' : 'INTERNAL_ERROR', error.code === '23505' ? 'Nome ou código já utilizado.' : error.message, error.code === '23505' ? 409 : 500);
  if (!data) return jsonError('NOT_FOUND', 'Matéria não encontrada.', 404);
  await auditLog({ organizationId: auth.membership.organizationId, actorAuthUid: auth.user.authUid, action: 'subject_updated', entityName: 'subjects', entityId: data.id, metadata: body.data });
  invalidatePlatformData();
  return jsonOk(data);
}

export async function DELETE(request: Request, context: { params: Promise<{ subjectId: string }> }) {
  const auth = await authorizeManagement(request, ['admin', 'coordinator']);
  if (!auth.ok) return auth.response;
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return jsonError('BAD_REQUEST', 'ID inválido.', 400);
  const { data, error } = await appSchema().from('subjects').delete()
    .eq('id', params.data.subjectId)
    .eq('organization_id', auth.membership.organizationId)
    .select('id,name').maybeSingle();
  if (error) {
    const message = error.code === '23503'
      ? 'A matéria possui dados vinculados. Aplique a migration 012 para habilitar a exclusão em cascata.'
      : error.message;
    return jsonError(error.code === '23503' ? 'CONFLICT' : 'INTERNAL_ERROR', message, error.code === '23503' ? 409 : 500);
  }
  if (!data) return jsonError('NOT_FOUND', 'Matéria não encontrada.', 404);
  await auditLog({ organizationId: auth.membership.organizationId, actorAuthUid: auth.user.authUid, action: 'subject_deleted', entityName: 'subjects', entityId: data.id, metadata: { name: data.name } });
  invalidatePlatformData();
  return jsonOk({ deleted: true });
}
