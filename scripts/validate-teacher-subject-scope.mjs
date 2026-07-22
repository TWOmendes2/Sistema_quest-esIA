import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const passed = [];

function requireText(path, snippets, label) {
  const content = read(path);
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      throw new Error(`${label}: trecho obrigatório ausente em ${path}: ${snippet}`);
    }
  }
  passed.push(label);
}

function forbidText(path, snippets, label) {
  const content = read(path);
  for (const snippet of snippets) {
    if (content.includes(snippet)) {
      throw new Error(`${label}: trecho inseguro encontrado em ${path}: ${snippet}`);
    }
  }
  passed.push(label);
}

requireText(
  'supabase/migrations/014_teacher_subject_scope_hardening.sql',
  [
    'ta.subject_id = target_subject_id',
    'create or replace function app.can_manage_question_scope',
    'create policy "student and scoped staff can view profiles"',
    'create policy "staff can manage scoped ai jobs"',
  ],
  'RLS restringe professor à matéria atribuída',
);
forbidText(
  'supabase/migrations/014_teacher_subject_scope_hardening.sql',
  [
    'ta.subject_id is null or ta.subject_id = target_subject_id',
    'create policy "staff can manage quiz subjects"\ncreate policy "staff can manage quiz subjects"',
  ],
  'Migration não mantém vínculo amplo nem política duplicada',
);

const assignmentExample=read('supabase/examples/assign_teacher_subject_permissions.example.sql');
for(const email of ['prof.fisica@example.com','prof.redacao@example.com','prof.linguagens@example.com','prof.biologia@example.com','prof.quimica@example.com','prof.humanas@example.com']){if(!assignmentExample.includes(email))throw new Error(`Professor demonstrativo ausente: ${email}`)}
if(!assignmentExample.includes('null::uuid')||!assignmentExample.includes("'teacher'::app.user_role"))throw new Error('Exemplo de escopo de professor inválido.');
passed.push('Exemplo público de professores por matéria está sanitizado');

requireText(
  'src/server/auth/management.ts',
  ['canManageAllSubjects', 'canManageClassesForSubjects', "from('teacher_assignments')"],
  'Backend centraliza matéria e turma permitidas',
);
requireText(
  'src/app/api/quizzes/route.ts',
  ['canManageAllSubjects', 'canManageClassesForSubjects'],
  'Criação de simulado valida matéria e turma do professor',
);
requireText(
  'src/app/api/quizzes/[quizId]/route.ts',
  ['canManageAllSubjects', 'canManageClassesForSubjects'],
  'Edição de simulado valida matéria e turma do professor',
);
requireText(
  'src/app/api/ai/jobs/route.ts',
  ['canManageAllSubjects', 'targetSubjectIds.includes(subject.id)'],
  'Geração por IA valida todas as matérias do simulado de destino',
);
requireText(
  'src/app/api/ai/jobs/[jobId]/finalize/route.ts',
  ['canManageAllSubjects', 'targetSubjectIds.includes(job.subject_id)'],
  'Conclusão da IA não mistura matérias sem permissão',
);
requireText(
  'src/server/data/admin.ts',
  [
    "context.allowedSubjectIds.includes(item.subject_id)",
    'approvedQuestionSubject',
    'effectiveSubjectIds',
    'role: context.role',
  ],
  'Painéis, médias e rankings usam escopo da matéria',
);
requireText(
  'src/components/app-shell.tsx',
  ["managementRole === 'teacher'", "? '/admin/ia'", "roles: ['admin', 'coordinator']"],
  'Menu do professor não aponta para áreas administrativas',
);

console.log(`Validação de professores concluída: ${passed.length} verificações aprovadas.`);
for (const check of passed) console.log(`✓ ${check}`);
