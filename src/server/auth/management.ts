import 'server-only';
import { jsonError } from '@/lib/http';
import { getAuthenticatedUser, getMemberships } from '@/server/auth/session';
import { appSchema } from '@/server/supabase/admin';

export type ManagementRole = 'admin' | 'coordinator' | 'teacher';

export type ManagementScope = {
  organizationId: string;
  role: ManagementRole;
  allowedSubjectIds: string[];
  allowedClassIds: string[];
};

export async function getManagementScope(authUid: string, organizationId: string, role: ManagementRole): Promise<ManagementScope> {
  if (role !== 'teacher') {
    return { organizationId, role, allowedSubjectIds: [], allowedClassIds: [] };
  }
  const { data, error } = await appSchema()
    .from('teacher_assignments')
    .select('subject_id,class_id')
    .eq('organization_id', organizationId)
    .eq('teacher_auth_uid', authUid);
  if (error) throw new Error(`teacher_assignments: ${error.message}`);
  return {
    organizationId,
    role,
    allowedSubjectIds: [...new Set((data ?? []).map((item) => item.subject_id).filter(Boolean) as string[])],
    allowedClassIds: [...new Set((data ?? []).map((item) => item.class_id).filter(Boolean) as string[])]
  };
}

export function canManageSubject(scope: ManagementScope, subjectId: string | null | undefined): boolean {
  if (scope.role !== 'teacher') return true;
  if (!subjectId) return false;
  return scope.allowedSubjectIds.includes(subjectId);
}

export function canManageAnySubject(scope: ManagementScope, subjectIds: Array<string | null | undefined>): boolean {
  if (scope.role !== 'teacher') return true;
  return subjectIds.some((subjectId) => Boolean(subjectId && scope.allowedSubjectIds.includes(subjectId)));
}

export function canManageAllSubjects(scope: ManagementScope, subjectIds: Array<string | null | undefined>): boolean {
  if (scope.role !== 'teacher') return true;
  const ids = [...new Set(subjectIds.filter(Boolean) as string[])];
  return ids.length > 0 && ids.every((subjectId) => scope.allowedSubjectIds.includes(subjectId));
}


export async function canManageClassesForSubjects(
  scope: ManagementScope,
  classIds: string[],
  subjectIds: string[],
): Promise<boolean> {
  if (scope.role !== 'teacher' || classIds.length === 0) return true;
  if (!canManageAllSubjects(scope, subjectIds)) return false;

  const { data, error } = await appSchema()
    .from('enrollments')
    .select('class_id')
    .eq('organization_id', scope.organizationId)
    .eq('status', 'active')
    .neq('contract_status', 'pending')
    .in('class_id', classIds)
    .in('subject_id', subjectIds);
  if (error) throw new Error(`enrollments: ${error.message}`);

  const allowedClassIds = new Set([
    ...scope.allowedClassIds,
    ...(data ?? []).map((item) => item.class_id),
  ]);
  return classIds.every((classId) => allowedClassIds.has(classId));
}

export async function authorizeManagement(request: Request, allowedRoles: ManagementRole[] = ['admin', 'coordinator', 'teacher']) {
  const user = await getAuthenticatedUser(request);
  if (!user) return { ok: false as const, response: jsonError('UNAUTHORIZED', 'Sessão inválida.', 401) };
  const memberships = await getMemberships(user.authUid);
  const membership = memberships.find((item) => allowedRoles.includes(item.role as ManagementRole));
  if (!membership) return { ok: false as const, response: jsonError('FORBIDDEN', 'Sem permissão para esta operação.', 403) };
  const role = membership.role as ManagementRole;
  let scope: ManagementScope;
  try {
    scope = await getManagementScope(user.authUid, membership.organization_id, role);
  } catch (error) {
    return { ok: false as const, response: jsonError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Falha ao carregar permissões.', 500) };
  }
  return {
    ok: true as const,
    user,
    membership: {
      organizationId: membership.organization_id,
      role
    },
    scope
  };
}
