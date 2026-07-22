export type SubjectSummary = {
  id: string;
  name: string;
  code: string;
  color: string;
  status: string;
  logoPath?: string | null;
  teacherNames?: string[];
  teachers: number;
  classes: number;
  students: number;
  quizzes: number;
  questions: number;
  average: number;
};

export type ClassSummary = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  status: string;
  students: number;
  subjects: number;
  quizzes: number;
  participation: number;
  average: number;
};

export type QuizSummary = {
  id: string;
  title: string;
  description: string | null;
  subjectId: string;
  subject: string;
  subjectColor: string;
  subjectIds: string[];
  subjectNames: string[];
  status: string;
  questionCount: number;
  durationMinutes: number;
  plannedQuestionCount: number;
  classId: string | null;
  className: string;
  classIds: string[];
  classNames: string[];
  releaseAt: string | null;
  dueAt: string | null;
  maxAttempts: number;
  showExplanation: boolean;
  showRanking: boolean;
  allowReview: boolean;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  attempts: number;
  participation: number;
  average: number;
  canEdit: boolean;
  canDelete: boolean;
  createdAt: string;
};

export type QuestionOptionModel = { id: string; label: 'A' | 'B' | 'C' | 'D' | 'E'; text: string };
export type QuestionModel = {
  id: string;
  quizId: string;
  quizTitle: string;
  subjectId: string;
  subject: string;
  subjectColor: string;
  statement: string;
  topic: string;
  subtopic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  expectedTimeSeconds: number;
  position: number;
  reviewStatus: string;
  sourceAiJobId: string | null;
  options: QuestionOptionModel[];
  correctOptionId: string;
  correctLabel: 'A' | 'B' | 'C' | 'D' | 'E';
  explanationCorrect: string;
  explanationWrong: string;
  updatedAt: string | null;
};


export type StudentQuizQuestion = {
  id: string;
  quizId: string;
  quizTitle: string;
  subjectId: string;
  subject: string;
  subjectColor: string;
  statement: string;
  topic: string;
  subtopic: string;
  expectedTimeSeconds: number;
  position: number;
  options: QuestionOptionModel[];
};

export type StudentSummary = {
  id: string;
  name: string;
  nickname: string;
  email: string;
  cpfLast4: string;
  classNames: string[];
  subjects: string[];
  status: string;
  lastAccess: string | null;
  createdAt: string;
  registryOnly?: boolean;
  firstAccessCompleted?: boolean;
};

export type AiJobSummary = {
  id: string;
  title: string;
  subject: string;
  status: string;
  model: string | null;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  preEstimatedCostUsd: number | null;
  actualCostUsd: number | null;
  durationMs: number | null;
  questionCount: number;
  requestedBy: string;
  createdAt: string;
  quizId: string | null;
};

export type AuditSummary = {
  id: string;
  date: string;
  actor: string;
  role: string;
  action: string;
  entity: string;
  detail: string;
  ip: string;
  severity: 'info' | 'success' | 'warning';
};


export type RankingEntry = {
  id: string;
  attemptId: string;
  studentId: string;
  quizId: string;
  quiz: string;
  classId: string | null;
  className: string;
  subjectId: string;
  subject: string;
  subjectColor: string;
  nickname: string;
  score: number;
  correct: number;
  wrong: number;
  answered: number;
  accuracy: number;
  durationSeconds: number;
  position: number;
  submittedAt: string | null;
};

export type RankingFilters = {
  classId?: string;
  quizId?: string;
  subjectId?: string;
  sort?: 'score' | 'correct' | 'accuracy' | 'time' | 'recent';
  mode?: 'best' | 'all';
};
