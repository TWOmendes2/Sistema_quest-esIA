import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { authorizeManagement } from '@/server/auth/management';
import { appSchema } from '@/server/supabase/admin';
import { auditLog } from '@/server/audit/audit';
import { invalidatePlatformData } from '@/server/cache/data-cache';

const schema = z.object({
  name: z.string().trim().min(2).max(150),
  code: z.string().trim().min(2).max(30).optional(),
  description: z.string().trim().max(1000).optional(),
  status: z.literal('active').default('active')
});

function generatedCode(name: string, code?: string) {
  return (code || name.split(/\s+/).map((part) => part[0]).join('').slice(0, 8)).toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'TURMA';
}

export async function GET(request: Request) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;
  let classIds: string[] | null = null;
  if (auth.scope.role === 'teacher') {
    if (!auth.scope.allowedSubjectIds.length && !auth.scope.allowedClassIds.length) return jsonOk([]);
    const { data: links, error: linksError } = auth.scope.allowedSubjectIds.length
      ? await appSchema().from('enrollments')
          .select('class_id')
          .eq('organization_id', auth.membership.organizationId)
          .eq('status', 'active')
          .in('subject_id', auth.scope.allowedSubjectIds)
      : { data: [], error: null };
    if (linksError) return jsonError('INTERNAL_ERROR', linksError.message, 500);
    classIds = [...new Set([...(links ?? []).map((item) => item.class_id), ...auth.scope.allowedClassIds])];
    if (!classIds.length) return jsonOk([]);
  }
  let query = appSchema().from('classes').select('id,name,code,description,status,created_at,updated_at').eq('organization_id', auth.membership.organizationId).eq('status', 'active');
  if (classIds) query = query.in('id', classIds);
  const { data, error } = await query.order('name');
  if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  return jsonOk(data ?? []);
}

export async function POST(request: Request) {
  const auth = await authorizeManagement(request, ['admin', 'coordinator']);
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Dados da turma inválidos.', 400, parsed.error.flatten());
  const { data, error } = await appSchema().from('classes').insert({
    organization_id: auth.membership.organizationId,
    name: parsed.data.name,
    code: generatedCode(parsed.data.name, parsed.data.code),
    description: parsed.data.description || null,
    status: parsed.data.status
  }).select('id,name,code,description,status').single();
  if (error) return jsonError(error.code === '23505' ? 'CONFLICT' : 'INTERNAL_ERROR', error.code === '23505' ? 'Já existe uma turma com esse nome.' : error.message, error.code === '23505' ? 409 : 500);
  await auditLog({ organizationId: auth.membership.organizationId, actorAuthUid: auth.user.authUid, action: 'class_created', entityName: 'classes', entityId: data.id, metadata: { name: data.name } });
  invalidatePlatformData();
  return jsonOk(data, 201);
}
