import { Avatar, Badge, Card, EmptyState, PageHeader, StatCard, StatusBadge } from '@/components/ui';
import { Icon } from '@/components/icon';
import { getSystemUsers } from '@/server/data/admin';
import { formatDate } from '@/lib/format';
import { requireManagementRoles } from '@/server/data/context';

const roleLabel: Record<string, string> = { admin: 'Administrador', coordinator: 'Coordenador', teacher: 'Professor' };

export default async function UsersPage() {
  await requireManagementRoles(['admin', 'coordinator']);
  const users = await getSystemUsers();
  return <><PageHeader eyebrow="Controle de acesso" title="Usuários e permissões" description="Papéis e escopos consultados diretamente do Supabase Auth e da organização Nexo Avalia." />
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Usuários ativos" value={users.filter((item) => item.status === 'active').length} icon="users" tone="primary" /><StatCard label="Administradores" value={users.filter((item) => item.role === 'admin').length} icon="shield" tone="danger" /><StatCard label="Coordenadores" value={users.filter((item) => item.role === 'coordinator').length} icon="key" tone="purple" /><StatCard label="Professores" value={users.filter((item) => item.role === 'teacher').length} icon="graduation" tone="success" /></div>
    <div className="app-table-wrap overflow-x-auto"><table className="app-table min-w-[980px]"><thead><tr><th>Usuário</th><th>Papel</th><th>Escopo real</th><th>MFA</th><th>Último acesso</th><th>Status</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><div className="flex items-center gap-3"><Avatar name={user.name} size="sm" /><div><p className="font-bold text-white">{user.name}</p><p className="mt-1 text-xs text-[#777]">{user.email}</p></div></div></td><td><Badge tone={user.role === 'admin' ? 'danger' : user.role === 'coordinator' ? 'purple' : 'primary'}>{roleLabel[user.role] || user.role}</Badge></td><td>{user.scope}</td><td>{user.mfa ? <Badge tone="success"><Icon name="shield" className="h-3.5 w-3.5" /> Ativo</Badge> : <Badge tone="warning">Não configurado</Badge>}</td><td>{user.lastAccess ? formatDate(user.lastAccess, true) : 'Nunca'}</td><td><StatusBadge status={user.status} /></td></tr>)}{!users.length ? <tr><td colSpan={6}><EmptyState icon="users" title="Nenhum usuário de gestão" description="Crie usuários no Supabase Auth e associe-os à organização em app.memberships." /></td></tr> : null}</tbody></table></div>
    <div className="mt-6 grid gap-6 lg:grid-cols-3"><RoleCard icon="shield" title="Administrador" text="Governança ampla, usuários, auditoria, exportações e configurações." /><RoleCard icon="key" title="Coordenador" text="Importação, cadastros, turmas, matérias, simulados e relatórios acadêmicos." /><RoleCard icon="graduation" title="Professor" text="Acesso ao escopo de turmas e matérias definido nas atribuições do banco." /></div>
  </>;
}

function RoleCard({ icon, title, text }: { icon: 'shield' | 'key' | 'graduation'; title: string; text: string }) {
  return <Card><span className="flex h-10 w-10 items-center justify-center rounded-md border border-[#3a3a3a] bg-[#222]"><Icon name={icon} className="h-5 w-5" /></span><h3 className="mt-4 font-bold text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-[#888]">{text}</p></Card>;
}
