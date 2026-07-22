import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { authorizeManagement } from '@/server/auth/management';
import { appSchema } from '@/server/supabase/admin';
import { auditLog } from '@/server/audit/audit';
import { invalidatePlatformData } from '@/server/cache/data-cache';

const paramsSchema = z.object({ classId: z.string().uuid() });
const bodySchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  code: z.string().trim().min(2).max(30).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  status: z.literal('active').optional()
}).refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: Request, context: { params: Promise<{ classId: string }> }) {
  const auth = await authorizeManagement(request, ['admin', 'coordinator']);
  if (!auth.ok) return auth.response;
  const params = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) return jsonError('BAD_REQUEST', 'Dados inválidos.', 400, body.success ? undefined : body.error.flatten());
  const { data, error } = await appSchema().from('classes').update(body.data)
    .eq('id', params.data.classId).eq('organization_id', auth.membership.organizationId)
    .select('id,name,code,description,status').maybeSingle();
  if (error) return jsonError(error.code === '23505' ? 'CONFLICT' : 'INTERNAL_ERROR', error.code === '23505' ? 'Já existe uma turma com esse nome.' : error.message, error.code === '23505' ? 409 : 500);
  if (!data) return jsonError('NOT_FOUND', 'Turma não encontrada.', 404);
  await auditLog({ organizationId: auth.membership.organizationId, actorAuthUid: auth.user.authUid, action: 'class_updated', entityName: 'classes', entityId: data.id, metadata: body.data });
  invalidatePlatformData();
  return jsonOk(data);
}

export async function DELETE(request: Request, context: { params: Promise<{ classId: string }> }) {
  const auth = await authorizeManagement(request, ['admin', 'coordinator']);
  if (!auth.ok) return auth.response;
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return jsonError('BAD_REQUEST', 'ID inválido.', 400);
  const { data, error } = await appSchema().from('classes').delete()
    .eq('id', params.data.classId).eq('organization_id', auth.membership.organizationId).select('id,name').maybeSingle();
  if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  if (!data) return jsonError('NOT_FOUND', 'Turma não encontrada.', 404);
  await auditLog({ organizationId: auth.membership.organizationId, actorAuthUid: auth.user.authUid, action: 'class_deleted', entityName: 'classes', entityId: data.id, metadata: { name: data.name } });
  invalidatePlatformData();
  return jsonOk({ deleted: true });
}
