import { redirect } from 'next/navigation';

export default async function LegacyQuizInstructionsPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  redirect(`/simulados/${quizId}`);
}
