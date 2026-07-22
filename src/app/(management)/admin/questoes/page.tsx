import { PageHeader, StatCard } from '@/components/ui';
import { QuestionBankManager } from '@/components/question-bank-manager';
import { getQuestionBank, getQuizzes } from '@/server/data/admin';

export default async function QuestionsPage() {
  const [questions, quizzes] = await Promise.all([getQuestionBank(), getQuizzes()]);
  const approved = questions.filter((item) => item.reviewStatus === 'approved').length;
  const generated = questions.filter((item) => item.sourceAiJobId).length;
  return <><PageHeader eyebrow="Banco de conteúdo" title="Banco de questões" description="Exibe uma única questão canônica. Cópias usadas em simulados permanecem no histórico sem poluir o banco." /><div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Questões" value={questions.length} icon="book" tone="primary" /><StatCard label="Aprovadas" value={approved} icon="check-circle" tone="success" /><StatCard label="Em revisão" value={questions.filter((item) => item.reviewStatus === 'review').length} icon="alert" tone="warning" /><StatCard label="Geradas por IA" value={generated} icon="sparkles" tone="purple" /></div><QuestionBankManager initialQuestions={questions} quizzes={quizzes} /></>;
}
