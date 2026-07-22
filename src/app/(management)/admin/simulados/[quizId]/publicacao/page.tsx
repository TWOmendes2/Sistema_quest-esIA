import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { QuizPublicationPanel } from '@/components/quiz-publication-panel';
import { getClasses, getQuestions, getQuizzes, getSubjects } from '@/server/data/admin';

export default async function QuizPublicationPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const [quizzes, questions, classes, subjects] = await Promise.all([getQuizzes(), getQuestions(), getClasses(), getSubjects()]);
  const quiz = quizzes.find((item) => item.id === quizId);
  if (!quiz || !quiz.canEdit) notFound();
  return <><PageHeader backHref={`/admin/simulados/${quizId}`} eyebrow="Revisão final" title="Publicação do simulado" description="Valide conteúdo, público e período antes de liberar aos alunos." /><QuizPublicationPanel quiz={quiz} questions={questions.filter((item) => item.quizId === quizId)} classes={classes} subjects={subjects} /></>;
}
