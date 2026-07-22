import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { QuestionBankManager } from '@/components/question-bank-manager';
import { getQuestions, getQuizzes } from '@/server/data/admin';

export default async function QuizQuestionsPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const [quizzes, questions] = await Promise.all([getQuizzes(), getQuestions()]);
  const quiz = quizzes.find((item) => item.id === quizId);
  if (!quiz) notFound();
  return <><PageHeader backHref={`/admin/simulados/${quizId}`} eyebrow={quiz.subject} title={`Questões — ${quiz.title}`} description="Edite, regenere, aprove e reutilize questões salvas no banco." /><QuestionBankManager initialQuestions={questions.filter((item) => item.quizId === quizId)} quizzes={[quiz]} /></>;
}
