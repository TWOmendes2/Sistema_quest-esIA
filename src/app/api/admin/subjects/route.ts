import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { authorizeManagement } from '@/server/auth/management';
import { appSchema } from '@/server/supabase/admin';
import { auditLog } from '@/server/audit/audit';
import { subjectCode, subjectColor, subjectLogo, subjectTeachers } from '@/lib/subject';
import { invalidatePlatformData } from '@/server/cache/data-cache';

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(20).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  status: z.literal('active').default('active')
});

export async function GET(request: Request) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;
  if (auth.scope.role === 'teacher' && !auth.scope.allowedSubjectIds.length) return jsonOk([]);
  let query = appSchema().from('subjects')
    .select('id,name,code,color,status,created_at,updated_at')
    .eq('organization_id', auth.membership.organizationId)
    .eq('status', 'active');
  if (auth.scope.role === 'teacher') query = query.in('id', auth.scope.allowedSubjectIds);
  const { data, error } = await query.order('name');
  if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  return jsonOk(data ?? []);
}

export async function POST(request: Request) {
  const auth = await authorizeManagement(request, ['admin', 'coordinator']);
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Dados da matéria inválidos.', 400, parsed.error.flatten());
  const payload = {
    organization_id: auth.membership.organizationId,
    name: parsed.data.name,
    code: subjectCode(parsed.data.name, parsed.data.code),
    color: subjectColor(parsed.data.name, parsed.data.color),
    logo_path: subjectLogo(parsed.data.name),
    teacher_names: subjectTeachers(parsed.data.name),
    status: parsed.data.status
  };
  const { data, error } = await appSchema().from('subjects').insert(payload).select('id,name,code,color,status,logo_path,teacher_names').single();
  if (error) return jsonError(error.code === '23505' ? 'CONFLICT' : 'INTERNAL_ERROR', error.code === '23505' ? 'Já existe uma matéria com esse nome ou código.' : error.message, error.code === '23505' ? 409 : 500);
  await auditLog({ organizationId: auth.membership.organizationId, actorAuthUid: auth.user.authUid, action: 'subject_created', entityName: 'subjects', entityId: data.id, metadata: { name: data.name } });
  invalidatePlatformData();
  return jsonOk(data, 201);
}
