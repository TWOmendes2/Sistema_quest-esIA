-- Nexo Avalia - sincronização de alunos, controle de acesso por turma e otimização.
-- Execute depois de 004_ai_jobs_metrics_hotfix.sql.

create extension if not exists unaccent with schema public;

-- Dados complementares presentes na exportação oficial de alunos.
alter table app.students_registry add column if not exists phone text;
alter table app.students_registry add column if not exists phone_e164 text;
alter table app.students_registry add column if not exists birth_date date;
alter table app.students_registry add column if not exists city text;
alter table app.students_registry add column if not exists guardian_name text;
alter table app.students_registry add column if not exists guardian_phone text;
alter table app.students_registry add column if not exists grade text;
alter table app.students_registry add column if not exists instagram text;
alter table app.students_registry add column if not exists import_metadata jsonb not null default '{}'::jsonb;
alter table app.students_registry add column if not exists source_snapshot_at timestamptz;

-- Identidade visual genérica por matéria. Nomes de professores são dados de negócio.
alter table app.subjects add column if not exists logo_path text;
alter table app.subjects add column if not exists teacher_names text[] not null default '{}'::text[];
update app.subjects set logo_path=case lower(public.unaccent(name)) when 'fisica' then '/subject-logos/fisica.svg' when 'redacao' then '/subject-logos/redacao.svg' when 'linguagens' then '/subject-logos/linguagens.svg' when 'biologia' then '/subject-logos/biologia.svg' when 'quimica' then '/subject-logos/quimica.svg' when 'humanas' then '/subject-logos/humanas.svg' when 'matematica' then '/subject-logos/matematica.svg' else coalesce(logo_path,'/subject-logos/geral.svg') end;

-- O status do vínculo pode ser active, delinquent, blocked ou inactive.
alter table app.registry_enrollments add column if not exists contract_status text not null default 'not_required';
alter table app.registry_enrollments add column if not exists source text not null default 'import';
alter table app.registry_enrollments add column if not exists manual_override boolean not null default false;
alter table app.registry_enrollments add column if not exists blocked_reason text;
alter table app.registry_enrollments add column if not exists updated_at timestamptz not null default now();

alter table app.enrollments add column if not exists contract_status text not null default 'not_required';
alter table app.enrollments add column if not exists source text not null default 'import';
alter table app.enrollments add column if not exists manual_override boolean not null default false;
alter table app.enrollments add column if not exists blocked_reason text;
alter table app.enrollments add column if not exists updated_at timestamptz not null default now();

-- Pendências contratuais independem do aluno já ter concluído o primeiro acesso.
create table if not exists app.student_contract_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  registry_id uuid not null references app.students_registry(id) on delete cascade,
  student_id uuid references app.student_profiles(id) on delete cascade,
  class_id uuid references app.classes(id) on delete set null,
  contract_name text not null,
  status text not null default 'pending' check (status in ('pending','signed','waived','resolved')),
  source text not null default 'import',
  external_url text,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, registry_id, contract_name)
);

-- Triggers de updated_at.
drop trigger if exists trg_registry_enrollments_updated_at on app.registry_enrollments;
create trigger trg_registry_enrollments_updated_at
before update on app.registry_enrollments
for each row execute function app.set_updated_at();

drop trigger if exists trg_enrollments_updated_at on app.enrollments;
create trigger trg_enrollments_updated_at
before update on app.enrollments
for each row execute function app.set_updated_at();

drop trigger if exists trg_student_contract_requirements_updated_at on app.student_contract_requirements;
create trigger trg_student_contract_requirements_updated_at
before update on app.student_contract_requirements
for each row execute function app.set_updated_at();

-- Índices usados pelas telas administrativas e do aluno.
create index if not exists idx_students_registry_org_status on app.students_registry(organization_id, status);
create index if not exists idx_registry_enrollments_org_registry_status on app.registry_enrollments(organization_id, registry_id, status);
create index if not exists idx_registry_enrollments_manual on app.registry_enrollments(registry_id, manual_override, source);
create index if not exists idx_enrollments_org_student_status on app.enrollments(organization_id, student_id, status);
create index if not exists idx_enrollments_access on app.enrollments(student_id, class_id, subject_id, status, contract_status);
create index if not exists idx_quiz_assignments_org_scope_status on app.quiz_assignments(organization_id, class_id, subject_id, status);
create index if not exists idx_quizzes_org_status_subject on app.quizzes(organization_id, status, subject_id);
create index if not exists idx_attempts_org_student_status on app.attempts(organization_id, student_id, status);
create index if not exists idx_contract_requirements_registry_status on app.student_contract_requirements(registry_id, status);
create index if not exists idx_contract_requirements_student_status on app.student_contract_requirements(student_id, status);

alter table app.student_contract_requirements enable row level security;

drop policy if exists "staff can manage contract requirements" on app.student_contract_requirements;
create policy "staff can manage contract requirements" on app.student_contract_requirements
for all using (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]))
with check (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]));

drop policy if exists "students can view own contract requirements" on app.student_contract_requirements;
create policy "students can view own contract requirements" on app.student_contract_requirements
for select using (
  exists (
    select 1
    from app.student_profiles sp
    where sp.auth_uid = auth.uid()
      and sp.organization_id = student_contract_requirements.organization_id
      and (sp.id = student_contract_requirements.student_id or sp.registry_id = student_contract_requirements.registry_id)
  )
);

grant select, insert, update, delete on app.student_contract_requirements to service_role;
