import { PageHeader, StatCard } from '@/components/ui';
import { SubjectManager } from '@/components/subject-manager';
import { getSubjects } from '@/server/data/admin';
import { requireManagementRoles } from '@/server/data/context';

export default async function SubjectsPage() {
  await requireManagementRoles(['admin', 'coordinator']);
  const subjects = await getSubjects();
  const active = subjects.filter((item) => item.status === 'active');
  const average = active.length ? active.reduce((sum, item) => sum + item.average, 0) / active.length : 0;
  return <><PageHeader eyebrow="Catálogo acadêmico" title="Matérias" description="Crie, edite, colore e acompanhe as matérias da Nexo Avalia." /><div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Matérias ativas" value={active.length} icon="layers" tone="primary" /><StatCard label="Professores vinculados" value={active.reduce((sum, item) => sum + item.teachers, 0)} icon="users" tone="purple" /><StatCard label="Questões no banco" value={subjects.reduce((sum, item) => sum + item.questions, 0)} icon="book" tone="success" /><StatCard label="Média consolidada" value={average.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} icon="chart" tone="warning" /></div><SubjectManager initialSubjects={subjects} /></>;
}
