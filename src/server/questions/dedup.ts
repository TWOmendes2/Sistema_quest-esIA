import type { GeneratedQuestion, GeneratedQuiz } from '@/server/ai/question-schema';

export function normalizeQuestionText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function deduplicateGeneratedQuiz(
  quiz: GeneratedQuiz,
  existingStatements: string[] = []
): { quiz: GeneratedQuiz; duplicatesSkipped: number } {
  const fingerprints = new Set(
    existingStatements
      .map(normalizeQuestionText)
      .filter(Boolean)
  );
  const questions: GeneratedQuestion[] = [];
  let duplicatesSkipped = 0;

  for (const question of quiz.questions) {
    const fingerprint = normalizeQuestionText(question.statement);
    if (!fingerprint || fingerprints.has(fingerprint)) {
      duplicatesSkipped += 1;
      continue;
    }

    fingerprints.add(fingerprint);
    questions.push(question);
  }

  return {
    quiz: { ...quiz, questions },
    duplicatesSkipped
  };
}
