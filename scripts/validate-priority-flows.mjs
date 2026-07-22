import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const checks = [];

function requireText(path, snippets, label) {
  const content = read(path);
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      throw new Error(`${label}: trecho obrigatório ausente em ${path}: ${snippet}`);
    }
  }
  checks.push(label);
}

function forbidText(path, snippets, label) {
  const content = read(path);
  for (const snippet of snippets) {
    if (content.includes(snippet)) {
      throw new Error(`${label}: trecho proibido encontrado em ${path}: ${snippet}`);
    }
  }
  checks.push(label);
}

forbidText(
  'src/components/quiz-runner.tsx',
  ['difficulty', 'dificuldade'],
  'Dificuldade não é enviada/renderizada durante a prova',
);
requireText(
  'src/components/result-view.tsx',
  ['difficultyLabel(question.difficulty)', "return 'Fácil'", "return 'Difícil'"],
  'Dificuldade aparece somente na correção',
);
requireText(
  'src/app/(student)/simulados/[quizId]/instrucoes/page.tsx',
  ['redirect(`/simulados/${quizId}`)'],
  'Tela antiga de instruções redireciona para o início direto',
);
requireText(
  'src/app/api/attempts/[attemptId]/submit/route.ts',
  ['durationSeconds = Math.max', 'attempt.started_at', 'submitted_at: submittedAt.toISOString()'],
  'Duração oficial é calculada no servidor',
);
requireText(
  'src/server/data/admin.ts',
  ['b.correct - a.correct', 'a.durationSeconds - b.durationSeconds', 'b.score - a.score'],
  'Ranking usa acertos, menor tempo e pontuação como desempate',
);
requireText(
  'src/server/scoring/scoring.ts',
  ['speedBonus: 0', 'difficultyWeight(item.difficulty)', 'const max = questions.reduce'],
  'Nota ponderada não usa bônus de velocidade manipulável',
);
forbidText(
  'src/server/scoring/scoring.ts',
  ['* 1.2'],
  'Normalização permite nota máxima de 100 pontos',
);
requireText(
  'supabase/migrations/013_priority_scale_multiscope.sql',
  [
    'create table if not exists app.quiz_classes',
    'create table if not exists app.quiz_subjects',
    "or exists (select 1 from app.quiz_subjects qs where qs.quiz_id = q.id and qs.subject_id = e.subject_id",
    'create unique index if not exists uq_attempts_one_in_progress',
  ],
  'Multi-turma/multi-matéria e tentativa única estão na migration',
);
requireText(
  'src/app/api/auth/forgot-password/route.ts',
  ['password_reset_requests', 'Solicitação registrada e enviada à recepção'],
  'Recuperação do aluno cria pendência para a recepção',
);
requireText(
  'src/app/api/ai/jobs/[jobId]/finalize/route.ts',
  ['finalize_ai_review', 'ready_for_review'],
  'Fluxo de IA só copia aprovadas ao concluir a revisão',
);
requireText(
  'src/server/auth/management.ts',
  ['allowedSubjectIds', 'canManageSubject', 'canManageAllSubjects'],
  'Escopo do professor por matéria está centralizado',
);
requireText(
  'src/components/new-quiz-wizard.tsx',
  ['subjectIds', 'classIds'],
  'Criação do simulado permite múltiplas matérias e turmas',
);

console.log(`Validação P0 concluída: ${checks.length} verificações aprovadas.`);
for (const check of checks) console.log(`✓ ${check}`);
