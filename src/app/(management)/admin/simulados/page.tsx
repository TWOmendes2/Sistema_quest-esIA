import Link from 'next/link';
import { PageHeader, StatCard } from '@/components/ui';
import { Icon } from '@/components/icon';
import { QuizListManager } from '@/components/quiz-list-manager';
import { getQuizzes } from '@/server/data/admin';

export default async function AdminQuizzesPage() {
  const quizzes = await getQuizzes();
  return <><PageHeader eyebrow="Avaliações" title="Simulados" description="Crie, revise, atribua e publique avaliações persistidas no banco." actions={<><Link href="/admin/ia" className="app-button-secondary"><Icon name="sparkles" className="h-4 w-4" /> Gerar com IA</Link><Link href="/admin/simulados/novo" className="app-button-primary"><Icon name="plus" className="h-4 w-4" /> Novo simulado</Link></>} /><div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Publicados" value={quizzes.filter((item) => item.status === 'published').length} icon="check-circle" tone="success" /><StatCard label="Em revisão" value={quizzes.filter((item) => item.status === 'review').length} icon="eye" tone="warning" /><StatCard label="Rascunhos" value={quizzes.filter((item) => item.status === 'draft').length} icon="edit" tone="neutral" /><StatCard label="Tentativas" value={quizzes.reduce((sum, item) => sum + item.attempts, 0)} icon="clipboard" tone="primary" /></div><QuizListManager initialQuizzes={quizzes} /></>;
}
