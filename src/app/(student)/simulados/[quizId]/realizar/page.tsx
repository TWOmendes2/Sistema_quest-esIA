import { notFound, redirect } from 'next/navigation';
import { QuizRunner } from '@/components/quiz-runner';
import { getStudentQuiz } from '@/server/data/student';

export default async function QuizRunnerPage({
  params,
  searchParams
}: {
  params: Promise<{ quizId: string }>;
  searchParams: Promise<{ attemptId?: string }>;
}) {
  const [{ quizId }, query] = await Promise.all([params, searchParams]);
  if (!query.attemptId) redirect(`/simulados/${quizId}`);
  const data = await getStudentQuiz(quizId);
  if (!data) notFound();
  return <QuizRunner quiz={data.quiz} questions={data.questions} attemptId={query.attemptId} />;
}
