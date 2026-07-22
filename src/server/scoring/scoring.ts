export type Difficulty = 'easy' | 'medium' | 'hard';

export type QuestionForScore = {
  questionId: string;
  difficulty: Difficulty;
  expectedTimeSeconds: number;
  elapsedSeconds: number;
  isCorrect: boolean;
};

export type QuestionScore = {
  questionId: string;
  points: number;
  weight: number;
  speedBonus: number;
};

export type AttemptScore = {
  raw: number;
  normalized: number;
  correctCount: number;
  wrongCount: number;
  questions: QuestionScore[];
};

export function difficultyWeight(difficulty: Difficulty): number {
  if (difficulty === 'easy') return 1;
  if (difficulty === 'medium') return 1.5;
  return 2;
}

export function scoreQuestion(question: QuestionForScore): QuestionScore {
  const weight = difficultyWeight(question.difficulty);
  const points = question.isCorrect ? weight : 0;

  // O tempo informado pelo navegador não altera a nota. Ele é apenas um dado
  // pedagógico; o desempate do ranking usa a duração oficial calculada no servidor.
  return {
    questionId: question.questionId,
    points: round2(points),
    weight,
    speedBonus: 0,
  };
}

export function scoreAttempt(questions: QuestionForScore[]): AttemptScore {
  const scored = questions.map(scoreQuestion);
  const raw = scored.reduce((sum, item) => sum + item.points, 0);
  const max = questions.reduce(
    (sum, item) => sum + difficultyWeight(item.difficulty),
    0,
  );
  const normalized = max <= 0 ? 0 : (raw / max) * 100;

  return {
    raw: round2(raw),
    normalized: round2(normalized),
    correctCount: questions.filter((item) => item.isCorrect).length,
    wrongCount: questions.filter((item) => !item.isCorrect).length,
    questions: scored,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
