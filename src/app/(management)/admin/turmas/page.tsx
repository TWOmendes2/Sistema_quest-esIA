import { PageHeader, StatCard } from '@/components/ui';
import { ClassManager } from '@/components/class-manager';
import { getClasses } from '@/server/data/admin';
import { requireManagementRoles } from '@/server/data/context';

export default async function ClassesPage() {
  await requireManagementRoles(['admin', 'coordinator']);
  const classes = await getClasses();
  const active = classes.filter((item) => item.status === 'active');
  const avgParticipation = active.length ? active.reduce((sum, item) => sum + item.participation, 0) / active.length : 0;
  return <><PageHeader eyebrow="Organização acadêmica" title="Turmas" description="Crie e edite turmas, preservando vínculos, participações e histórico." /><div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Turmas ativas" value={active.length} icon="graduation" tone="primary" /><StatCard label="Alunos vinculados" value={active.reduce((sum, item) => sum + item.students, 0)} icon="users" tone="success" /><StatCard label="Simulados atribuídos" value={active.reduce((sum, item) => sum + item.quizzes, 0)} icon="clipboard" tone="purple" /><StatCard label="Participação média" value={`${avgParticipation.toFixed(1)}%`} icon="chart" tone="warning" /></div><ClassManager initialClasses={classes} /></>;
}
