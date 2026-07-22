import { Card, PageHeader, StatCard } from '@/components/ui';
import { PendingApprovals } from '@/components/pending-approvals';
import { PasswordResetRequests } from '@/components/password-reset-requests';
import { getPasswordResetRequests, getPendingStudents } from '@/server/data/admin';
import { requireManagementRoles } from '@/server/data/context';
export default async function PendingRegistrationsPage() {
  await requireManagementRoles(['admin', 'coordinator']);
  const [students, passwordRequests] = await Promise.all([getPendingStudents(), getPasswordResetRequests()]);
  return <><PageHeader eyebrow="Validação de acesso" title="Pendências da recepção" description="Analise cadastros e solicitações assistidas de troca de senha." /><div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Cadastros pendentes" value={students.length} icon="alert" tone="warning" /><StatCard label="Trocas de senha" value={passwordRequests.length} icon="lock" tone="primary" /><StatCard label="Encontrados na base" value={students.filter((item) => item.registryMatch).length} icon="database" tone="success" /><StatCard label="Total para analisar" value={students.length + passwordRequests.length} icon="clock" tone="neutral" /></div><div className="space-y-6"><Card title="Solicitações de nova senha" description="Ao aprovar, uma senha temporária é exibida uma única vez."><PasswordResetRequests initialRequests={passwordRequests} /></Card><Card title="Novos cadastros"><PendingApprovals initialStudents={students} /></Card></div></>;
}
