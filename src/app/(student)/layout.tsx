import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { accessCookieName, getActiveStudentProfile, getAuthenticatedUserFromToken, getMemberships } from '@/server/auth/session';
import { appSchema } from '@/server/supabase/admin';
import { env } from '@/server/env';
import { ContractNotice } from '@/components/contract-notice';

export const dynamic = 'force-dynamic';

export default async function StudentLayout({ children }: { children: ReactNode }) {
  const token = (await cookies()).get(accessCookieName)?.value;
  if (!token) redirect('/login');

  const user = await getAuthenticatedUserFromToken(token).catch(() => null);
  if (!user) redirect('/login');

  const [profile, memberships] = await Promise.all([
    getActiveStudentProfile(user.authUid).catch(() => null),
    getMemberships(user.authUid).catch(() => [])
  ]);
  if (!profile) {
    const isManagement = memberships.some((membership) => ['admin', 'coordinator', 'teacher'].includes(membership.role));
    redirect(isManagement ? '/admin' : '/login');
  }

  const { data: pendingContracts } = await appSchema().from('student_contract_requirements')
    .select('id,contract_name')
    .eq('organization_id', profile.organization_id)
    .eq('student_id', profile.id)
    .eq('status', 'pending');

  return <AppShell mode="student" userName={profile.full_name} userSubtitle={`@${profile.nickname}`}><ContractNotice contracts={pendingContracts ?? []} signatureUrl={env.contractSignatureUrl} />{children}</AppShell>;
}
