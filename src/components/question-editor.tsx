'use client';

import { QuestionBankManager } from '@/components/question-bank-manager';
import type { QuestionModel, QuizSummary } from '@/lib/domain-types';

export function QuestionEditor({ questions, quizzes }: { questions: QuestionModel[]; quizzes: QuizSummary[] }) {
  return <QuestionBankManager initialQuestions={questions} quizzes={quizzes} />;
}
