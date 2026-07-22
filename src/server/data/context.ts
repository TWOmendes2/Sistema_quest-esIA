import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { accessCookieName, getActiveStudentProfile, getAuthenticatedUserFromToken, getMemberships } from '@/server/auth/session';
import { appSchema } from '@/server/supabase/admin';
import { env } from '@/server/env';
import { getManagementScope } from '@/server/auth/management';

export type ManagementContext = {
  authUid: string;
  email: string | null;
  organizationId: string;
  organizationName: string;
  role: 'admin' | 'coordinator' | 'teacher';
  allowedSubjectIds: string[];
  allowedClassIds: string[];
};

export const getManagementContext = cache(async (): Promise<ManagementContext> => {
  const token = (await cookies()).get(accessCookieName)?.value;
  if (!token) redirect('/login');
  const user = await getAuthenticatedUserFromToken(token);
  if (!user) redirect('/login');
  const memberships = await getMemberships(user.authUid);
  const membership = memberships.find((item) => ['admin', 'coordinator', 'teacher'].includes(item.role));
  if (!membership) redirect('/dashboard');
  const organizationId = membership.organization_id || env.defaultOrganizationId;
  const role = membership.role as ManagementContext['role'];
  const [{ data: organization }, scope] = await Promise.all([
    appSchema().from('organizations').select('name').eq('id', organizationId).maybeSingle(),
    getManagementScope(user.authUid, organizationId, role)
  ]);
  return {
    authUid: user.authUid,
    email: user.email,
    organizationId,
    organizationName: organization?.name || env.appName,
    role,
    allowedSubjectIds: scope.allowedSubjectIds,
    allowedClassIds: scope.allowedClassIds
  };
});


export async function requireManagementRoles(
  allowedRoles: ManagementContext['role'][],
): Promise<ManagementContext> {
  const context = await getManagementContext();
  if (!allowedRoles.includes(context.role)) redirect('/admin');
  return context;
}

export const getStudentContext = cache(async () => {
  const token = (await cookies()).get(accessCookieName)?.value;
  if (!token) redirect('/login');
  const user = await getAuthenticatedUserFromToken(token);
  if (!user) redirect('/login');
  if (user.userMetadata.must_change_password === true) redirect('/trocar-senha-temporaria');
  const profile = await getActiveStudentProfile(user.authUid);
  if (!profile) redirect('/login');
  return { user, profile };
});
