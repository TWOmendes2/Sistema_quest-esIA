import { notFound, redirect } from 'next/navigation';
import { ResultView } from '@/components/result-view';
import { getStudentAttemptResult } from '@/server/data/student';

export default async function AttemptResultPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const data = await getStudentAttemptResult(attemptId);
  if (!data) notFound();
  if (data.attempt.status !== 'submitted') redirect(`/simulados/${data.quiz.id}/realizar`);
  return <ResultView data={data} backHref="/dashboard" />;
}
