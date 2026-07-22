import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { accessCookieName, getAuthenticatedUserFromToken, getMemberships } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

const roleLabels: Record<string, string> = {
  admin: 'Administrador',
  coordinator: 'Coordenador',
  teacher: 'Professor'
};

export default async function ManagementLayout({ children }: { children: ReactNode }) {
  const token = (await cookies()).get(accessCookieName)?.value;
  if (!token) redirect('/login');

  const user = await getAuthenticatedUserFromToken(token).catch(() => null);
  if (!user) redirect('/login');

  const memberships = await getMemberships(user.authUid).catch(() => []);
  const managementMembership = memberships.find((membership) => ['admin', 'coordinator', 'teacher'].includes(membership.role));
  if (!managementMembership) redirect('/dashboard');

  const userName = user.email?.split('@')[0] || 'Usuário';
  return <AppShell mode="management" managementRole={managementMembership.role as 'admin' | 'coordinator' | 'teacher'} userName={userName} userSubtitle={roleLabels[managementMembership.role] || 'Equipe'}>{children}</AppShell>;
}
