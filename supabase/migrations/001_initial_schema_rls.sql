-- MVP Simulados - Supabase/Postgres initial schema and RLS
-- Ordem segura: schema -> extensões -> tipos -> tabelas -> índices -> funções -> RLS -> policies -> storage.
-- Este arquivo é idempotente para schema/tabelas/funções/triggers/policies principais.

create schema if not exists app;

create extension if not exists pgcrypto with schema public;

-- Permissões básicas do schema. O service_role deve ser usado apenas no backend.
grant usage on schema app to anon;
grant usage on schema app to authenticated;
grant usage on schema app to service_role;
grant all on schema app to postgres;
grant all on schema app to service_role;

-- =========================
-- ENUMS
-- =========================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role' and typnamespace = 'app'::regnamespace) then
    create type app.user_role as enum ('student', 'teacher', 'coordinator', 'admin');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'profile_status' and typnamespace = 'app'::regnamespace) then
    create type app.profile_status as enum ('imported', 'pending', 'active', 'rejected', 'blocked');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'quiz_status' and typnamespace = 'app'::regnamespace) then
    create type app.quiz_status as enum ('draft', 'review', 'published', 'archived');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'attempt_status' and typnamespace = 'app'::regnamespace) then
    create type app.attempt_status as enum ('in_progress', 'submitted', 'reviewed', 'cancelled');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ai_job_status' and typnamespace = 'app'::regnamespace) then
    create type app.ai_job_status as enum ('queued', 'processing', 'ready_for_review', 'approved', 'failed', 'cancelled');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'difficulty_level' and typnamespace = 'app'::regnamespace) then
    create type app.difficulty_level as enum ('easy', 'medium', 'hard');
  end if;
end $$;

-- =========================
-- TABLES
-- =========================
create table if not exists app.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  auth_uid uuid not null references auth.users(id) on delete cascade,
  role app.user_role not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (organization_id, auth_uid, role)
);

create table if not exists app.students_registry (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  cpf_hash text not null,
  cpf_last4 text not null,
  full_name text not null,
  email text,
  status app.profile_status not null default 'imported',
  imported_by uuid references auth.users(id),
  imported_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, cpf_hash)
);

create table if not exists app.student_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  registry_id uuid references app.students_registry(id) on delete set null,
  auth_uid uuid unique references auth.users(id) on delete cascade,
  cpf_hash text not null,
  cpf_last4 text not null,
  nickname text not null,
  full_name text not null,
  email text not null,
  status app.profile_status not null default 'pending',
  first_access_completed boolean not null default false,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, cpf_hash),
  unique (organization_id, nickname)
);

create table if not exists app.classes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists app.subjects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

-- Vínculo temporário de aluno importado com turma/matéria antes do primeiro acesso.
create table if not exists app.registry_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  registry_id uuid not null references app.students_registry(id) on delete cascade,
  class_id uuid not null references app.classes(id) on delete cascade,
  subject_id uuid not null references app.subjects(id) on delete cascade,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (registry_id, class_id, subject_id)
);

create table if not exists app.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  teacher_auth_uid uuid not null references auth.users(id) on delete cascade,
  class_id uuid references app.classes(id) on delete cascade,
  subject_id uuid references app.subjects(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (teacher_auth_uid, class_id, subject_id)
);

create table if not exists app.enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  student_id uuid not null references app.student_profiles(id) on delete cascade,
  class_id uuid not null references app.classes(id) on delete cascade,
  subject_id uuid not null references app.subjects(id) on delete cascade,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (student_id, class_id, subject_id)
);

create table if not exists app.quizzes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  subject_id uuid not null references app.subjects(id),
  title text not null,
  description text,
  status app.quiz_status not null default 'draft',
  version integer not null default 1,
  created_by uuid not null references auth.users(id),
  published_by uuid references auth.users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references app.quizzes(id) on delete cascade,
  statement text not null,
  topic text,
  subtopic text,
  difficulty app.difficulty_level not null default 'medium',
  position integer not null,
  expected_time_seconds integer not null default 120 check (expected_time_seconds > 0),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (quiz_id, position)
);

create table if not exists app.question_options (
  id uuid primary key default gen_random_uuid(),
  quiz_question_id uuid not null references app.quiz_questions(id) on delete cascade,
  label text not null check (label in ('A', 'B', 'C', 'D', 'E')),
  option_text text not null,
  position integer not null check (position between 1 and 5),
  created_at timestamptz not null default now(),
  unique (quiz_question_id, label),
  unique (quiz_question_id, position)
);

create table if not exists app.question_answer_keys (
  id uuid primary key default gen_random_uuid(),
  quiz_question_id uuid not null unique references app.quiz_questions(id) on delete cascade,
  correct_option_id uuid not null references app.question_options(id) on delete restrict,
  explanation_correct text not null,
  explanation_wrong text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists app.quiz_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  quiz_id uuid not null references app.quizzes(id) on delete cascade,
  class_id uuid not null references app.classes(id) on delete cascade,
  subject_id uuid not null references app.subjects(id) on delete cascade,
  release_at timestamptz,
  due_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (quiz_id, class_id, subject_id)
);

create table if not exists app.attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  student_id uuid not null references app.student_profiles(id) on delete cascade,
  quiz_id uuid not null references app.quizzes(id) on delete cascade,
  status app.attempt_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  duration_seconds integer,
  score_raw numeric(10,2),
  score_normalized numeric(10,2),
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists app.attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references app.attempts(id) on delete cascade,
  quiz_question_id uuid not null references app.quiz_questions(id) on delete cascade,
  selected_option_id uuid references app.question_options(id) on delete set null,
  elapsed_seconds integer not null default 0 check (elapsed_seconds >= 0),
  is_correct boolean,
  points_awarded numeric(10,2),
  created_at timestamptz not null default now(),
  unique (attempt_id, quiz_question_id)
);

create table if not exists app.rank_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  quiz_id uuid references app.quizzes(id) on delete cascade,
  class_id uuid references app.classes(id) on delete cascade,
  subject_id uuid references app.subjects(id) on delete cascade,
  student_id uuid not null references app.student_profiles(id) on delete cascade,
  nickname text not null,
  score_normalized numeric(10,2) not null,
  correct_count integer not null,
  duration_seconds integer,
  position integer not null,
  computed_at timestamptz not null default now(),
  unique (quiz_id, class_id, subject_id, student_id)
);

create table if not exists app.content_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  title text not null,
  source_type text not null check (source_type in ('text', 'transcription', 'pdf', 'doc', 'other')),
  storage_path text,
  raw_text text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists app.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  content_source_id uuid references app.content_sources(id) on delete set null,
  quiz_id uuid references app.quizzes(id) on delete set null,
  status app.ai_job_status not null default 'queued',
  prompt_version text not null,
  model_name text,
  input_tokens integer,
  output_tokens integer,
  estimated_cost numeric(10,4),
  error_message text,
  result_json jsonb,
  requested_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references app.organizations(id) on delete set null,
  actor_auth_uid uuid references auth.users(id) on delete set null,
  action text not null,
  entity_name text not null,
  entity_id uuid,
  ip_address inet,
  user_agent text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- =========================
-- INDEXES
-- =========================
create index if not exists idx_memberships_auth_uid on app.memberships(auth_uid);
create index if not exists idx_memberships_org_role on app.memberships(organization_id, role, status);
create index if not exists idx_students_registry_cpf_hash on app.students_registry(organization_id, cpf_hash);
create index if not exists idx_student_profiles_auth_uid on app.student_profiles(auth_uid);
create index if not exists idx_student_profiles_cpf_hash on app.student_profiles(organization_id, cpf_hash);
create index if not exists idx_student_profiles_status on app.student_profiles(status);
create index if not exists idx_registry_enrollments_registry on app.registry_enrollments(registry_id);
create index if not exists idx_teacher_assignments_teacher on app.teacher_assignments(teacher_auth_uid);
create index if not exists idx_enrollments_student on app.enrollments(student_id);
create index if not exists idx_enrollments_class_subject on app.enrollments(class_id, subject_id);
create index if not exists idx_quizzes_subject_status on app.quizzes(subject_id, status);
create index if not exists idx_quiz_questions_quiz on app.quiz_questions(quiz_id);
create index if not exists idx_question_options_question on app.question_options(quiz_question_id);
create index if not exists idx_quiz_assignments_class_subject on app.quiz_assignments(class_id, subject_id);
create index if not exists idx_attempts_student_quiz on app.attempts(student_id, quiz_id);
create index if not exists idx_attempts_quiz_status on app.attempts(quiz_id, status);
create index if not exists idx_attempt_answers_attempt on app.attempt_answers(attempt_id);
create index if not exists idx_rank_snapshots_scope on app.rank_snapshots(quiz_id, class_id, subject_id);
create index if not exists idx_ai_jobs_status on app.ai_jobs(status);
create index if not exists idx_audit_logs_entity on app.audit_logs(entity_name, entity_id);
create index if not exists idx_audit_logs_created_at on app.audit_logs(created_at desc);

-- =========================
-- UPDATED_AT TRIGGERS
-- =========================
create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations', 'students_registry', 'student_profiles', 'classes', 'subjects', 'quizzes', 'ai_jobs'
  ] loop
    if not exists (
      select 1 from pg_trigger
      where tgname = 'trg_' || table_name || '_updated_at'
    ) then
      execute format(
        'create trigger %I before update on app.%I for each row execute function app.set_updated_at()',
        'trg_' || table_name || '_updated_at',
        table_name
      );
    end if;
  end loop;
end $$;

-- =========================
-- RLS HELPER FUNCTIONS
-- =========================
create or replace function app.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select exists (
    select 1
    from app.memberships m
    where m.organization_id = org_id
      and m.auth_uid = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function app.has_role(org_id uuid, allowed_roles app.user_role[])
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select exists (
    select 1
    from app.memberships m
    where m.organization_id = org_id
      and m.auth_uid = auth.uid()
      and m.role = any(allowed_roles)
      and m.status = 'active'
  );
$$;

create or replace function app.current_student_profile_id()
returns uuid
language sql
stable
security definer
set search_path = app, public
as $$
  select sp.id
  from app.student_profiles sp
  where sp.auth_uid = auth.uid()
    and sp.status = 'active'
  limit 1;
$$;

create or replace function app.is_student_owner(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select exists (
    select 1
    from app.student_profiles sp
    where sp.id = profile_id
      and sp.auth_uid = auth.uid()
      and sp.status = 'active'
  );
$$;

create or replace function app.is_teacher_for_scope(org_id uuid, scope_class_id uuid, scope_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select exists (
    select 1
    from app.teacher_assignments ta
    where ta.organization_id = org_id
      and ta.teacher_auth_uid = auth.uid()
      and (ta.class_id is null or ta.class_id = scope_class_id)
      and (ta.subject_id is null or ta.subject_id = scope_subject_id)
  );
$$;

create or replace function app.can_manage_quiz(target_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select exists (
    select 1
    from app.quizzes q
    where q.id = target_quiz_id
      and (
        app.has_role(q.organization_id, array['admin','coordinator']::app.user_role[])
        or exists (
          select 1 from app.teacher_assignments ta
          where ta.organization_id = q.organization_id
            and ta.teacher_auth_uid = auth.uid()
            and (ta.subject_id is null or ta.subject_id = q.subject_id)
        )
      )
  );
$$;

create or replace function app.can_read_quiz(target_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select exists (
    select 1
    from app.quizzes q
    where q.id = target_quiz_id
      and (
        app.can_manage_quiz(q.id)
        or (
          q.status = 'published'
          and exists (
            select 1
            from app.quiz_assignments qa
            join app.enrollments e on e.class_id = qa.class_id and e.subject_id = qa.subject_id
            join app.student_profiles sp on sp.id = e.student_id
            where qa.quiz_id = q.id
              and qa.status = 'active'
              and e.status = 'active'
              and sp.auth_uid = auth.uid()
              and sp.status = 'active'
              and (qa.release_at is null or qa.release_at <= now())
              and (qa.due_at is null or qa.due_at >= now())
          )
        )
      )
  );
$$;

create or replace function app.can_read_question(target_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select exists (
    select 1
    from app.quiz_questions qq
    where qq.id = target_question_id
      and app.can_read_quiz(qq.quiz_id)
  );
$$;

create or replace function app.can_read_attempt(target_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select exists (
    select 1
    from app.attempts a
    where a.id = target_attempt_id
      and (
        app.is_student_owner(a.student_id)
        or app.has_role(a.organization_id, array['admin','coordinator']::app.user_role[])
        or exists (
          select 1
          from app.quiz_assignments qa
          where qa.quiz_id = a.quiz_id
            and app.is_teacher_for_scope(a.organization_id, qa.class_id, qa.subject_id)
        )
      )
  );
$$;

-- =========================
-- ENABLE RLS
-- =========================
alter table app.organizations enable row level security;
alter table app.memberships enable row level security;
alter table app.students_registry enable row level security;
alter table app.student_profiles enable row level security;
alter table app.classes enable row level security;
alter table app.subjects enable row level security;
alter table app.registry_enrollments enable row level security;
alter table app.teacher_assignments enable row level security;
alter table app.enrollments enable row level security;
alter table app.quizzes enable row level security;
alter table app.quiz_questions enable row level security;
alter table app.question_options enable row level security;
alter table app.question_answer_keys enable row level security;
alter table app.quiz_assignments enable row level security;
alter table app.attempts enable row level security;
alter table app.attempt_answers enable row level security;
alter table app.rank_snapshots enable row level security;
alter table app.content_sources enable row level security;
alter table app.ai_jobs enable row level security;
alter table app.audit_logs enable row level security;

-- =========================
-- POLICIES
-- =========================
-- Organizations
drop policy if exists "members can view organizations" on app.organizations;
create policy "members can view organizations" on app.organizations
for select using (app.is_org_member(id));

drop policy if exists "admins can manage organizations" on app.organizations;
create policy "admins can manage organizations" on app.organizations
for all using (app.has_role(id, array['admin']::app.user_role[]))
with check (app.has_role(id, array['admin']::app.user_role[]));

-- Memberships
drop policy if exists "users can view own memberships" on app.memberships;
create policy "users can view own memberships" on app.memberships
for select using (auth_uid = auth.uid() or app.has_role(organization_id, array['admin','coordinator']::app.user_role[]));

drop policy if exists "admins can manage memberships" on app.memberships;
create policy "admins can manage memberships" on app.memberships
for all using (app.has_role(organization_id, array['admin']::app.user_role[]))
with check (app.has_role(organization_id, array['admin']::app.user_role[]));

-- Student registry
drop policy if exists "staff can view students registry" on app.students_registry;
create policy "staff can view students registry" on app.students_registry
for select using (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]));

drop policy if exists "staff can manage students registry" on app.students_registry;
create policy "staff can manage students registry" on app.students_registry
for all using (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]))
with check (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]));

-- Student profiles
drop policy if exists "student and staff can view profiles" on app.student_profiles;
create policy "student and staff can view profiles" on app.student_profiles
for select using (
  auth_uid = auth.uid()
  or app.has_role(organization_id, array['admin','coordinator','teacher']::app.user_role[])
);

drop policy if exists "staff can update profiles" on app.student_profiles;
create policy "staff can update profiles" on app.student_profiles
for update using (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]))
with check (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]));

-- Classes and subjects
drop policy if exists "members can view classes" on app.classes;
create policy "members can view classes" on app.classes
for select using (app.is_org_member(organization_id));

drop policy if exists "staff can manage classes" on app.classes;
create policy "staff can manage classes" on app.classes
for all using (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]))
with check (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]));

drop policy if exists "members can view subjects" on app.subjects;
create policy "members can view subjects" on app.subjects
for select using (app.is_org_member(organization_id));

drop policy if exists "staff can manage subjects" on app.subjects;
create policy "staff can manage subjects" on app.subjects
for all using (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]))
with check (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]));

-- Registry enrollments
drop policy if exists "staff can manage registry enrollments" on app.registry_enrollments;
create policy "staff can manage registry enrollments" on app.registry_enrollments
for all using (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]))
with check (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]));

-- Teacher assignments
drop policy if exists "staff and teacher can view assignments" on app.teacher_assignments;
create policy "staff and teacher can view assignments" on app.teacher_assignments
for select using (
  teacher_auth_uid = auth.uid()
  or app.has_role(organization_id, array['admin','coordinator']::app.user_role[])
);

drop policy if exists "staff can manage teacher assignments" on app.teacher_assignments;
create policy "staff can manage teacher assignments" on app.teacher_assignments
for all using (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]))
with check (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]));

-- Enrollments
drop policy if exists "students and staff can view enrollments" on app.enrollments;
create policy "students and staff can view enrollments" on app.enrollments
for select using (
  app.is_student_owner(student_id)
  or app.has_role(organization_id, array['admin','coordinator']::app.user_role[])
  or app.is_teacher_for_scope(organization_id, class_id, subject_id)
);

drop policy if exists "staff can manage enrollments" on app.enrollments;
create policy "staff can manage enrollments" on app.enrollments
for all using (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]))
with check (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]));

-- Quizzes
drop policy if exists "users can view allowed quizzes" on app.quizzes;
create policy "users can view allowed quizzes" on app.quizzes
for select using (app.can_read_quiz(id));

drop policy if exists "staff can manage quizzes" on app.quizzes;
create policy "staff can manage quizzes" on app.quizzes
for all using (app.can_manage_quiz(id))
with check (app.has_role(organization_id, array['admin','coordinator','teacher']::app.user_role[]));

-- Questions and options
drop policy if exists "users can view allowed questions" on app.quiz_questions;
create policy "users can view allowed questions" on app.quiz_questions
for select using (app.can_read_question(id));

drop policy if exists "staff can manage questions" on app.quiz_questions;
create policy "staff can manage questions" on app.quiz_questions
for all using (app.can_manage_quiz(quiz_id))
with check (app.can_manage_quiz(quiz_id));

drop policy if exists "users can view allowed options" on app.question_options;
create policy "users can view allowed options" on app.question_options
for select using (app.can_read_question(quiz_question_id));

drop policy if exists "staff can manage options" on app.question_options;
create policy "staff can manage options" on app.question_options
for all using (
  exists (select 1 from app.quiz_questions qq where qq.id = quiz_question_id and app.can_manage_quiz(qq.quiz_id))
)
with check (
  exists (select 1 from app.quiz_questions qq where qq.id = quiz_question_id and app.can_manage_quiz(qq.quiz_id))
);

-- Answer keys. Alunos nunca recebem gabarito direto por RLS.
drop policy if exists "staff can view answer keys" on app.question_answer_keys;
create policy "staff can view answer keys" on app.question_answer_keys
for select using (
  exists (select 1 from app.quiz_questions qq where qq.id = quiz_question_id and app.can_manage_quiz(qq.quiz_id))
);

drop policy if exists "staff can manage answer keys" on app.question_answer_keys;
create policy "staff can manage answer keys" on app.question_answer_keys
for all using (
  exists (select 1 from app.quiz_questions qq where qq.id = quiz_question_id and app.can_manage_quiz(qq.quiz_id))
)
with check (
  exists (select 1 from app.quiz_questions qq where qq.id = quiz_question_id and app.can_manage_quiz(qq.quiz_id))
);

-- Quiz assignments
drop policy if exists "users can view allowed quiz assignments" on app.quiz_assignments;
create policy "users can view allowed quiz assignments" on app.quiz_assignments
for select using (
  app.has_role(organization_id, array['admin','coordinator']::app.user_role[])
  or app.is_teacher_for_scope(organization_id, class_id, subject_id)
  or exists (
    select 1
    from app.enrollments e
    join app.student_profiles sp on sp.id = e.student_id
    where e.class_id = quiz_assignments.class_id
      and e.subject_id = quiz_assignments.subject_id
      and sp.auth_uid = auth.uid()
      and sp.status = 'active'
      and e.status = 'active'
  )
);

drop policy if exists "staff can manage quiz assignments" on app.quiz_assignments;
create policy "staff can manage quiz assignments" on app.quiz_assignments
for all using (
  app.has_role(organization_id, array['admin','coordinator']::app.user_role[])
  or app.is_teacher_for_scope(organization_id, class_id, subject_id)
)
with check (
  app.has_role(organization_id, array['admin','coordinator']::app.user_role[])
  or app.is_teacher_for_scope(organization_id, class_id, subject_id)
);

-- Attempts and answers. Escrita deve ocorrer pelo backend com service_role.
drop policy if exists "users can view allowed attempts" on app.attempts;
create policy "users can view allowed attempts" on app.attempts
for select using (app.can_read_attempt(id));

drop policy if exists "users can view allowed attempt answers" on app.attempt_answers;
create policy "users can view allowed attempt answers" on app.attempt_answers
for select using (app.can_read_attempt(attempt_id));

-- Ranking público por apelido dentro do escopo autorizado.
drop policy if exists "users can view allowed rankings" on app.rank_snapshots;
create policy "users can view allowed rankings" on app.rank_snapshots
for select using (
  app.has_role(organization_id, array['admin','coordinator']::app.user_role[])
  or app.is_teacher_for_scope(organization_id, class_id, subject_id)
  or exists (
    select 1
    from app.enrollments e
    join app.student_profiles sp on sp.id = e.student_id
    where e.class_id = rank_snapshots.class_id
      and e.subject_id = rank_snapshots.subject_id
      and sp.auth_uid = auth.uid()
      and sp.status = 'active'
      and e.status = 'active'
  )
);

-- Content sources and AI jobs
drop policy if exists "staff can manage content sources" on app.content_sources;
create policy "staff can manage content sources" on app.content_sources
for all using (app.has_role(organization_id, array['admin','coordinator','teacher']::app.user_role[]))
with check (app.has_role(organization_id, array['admin','coordinator','teacher']::app.user_role[]));

drop policy if exists "staff can manage ai jobs" on app.ai_jobs;
create policy "staff can manage ai jobs" on app.ai_jobs
for all using (app.has_role(organization_id, array['admin','coordinator','teacher']::app.user_role[]))
with check (app.has_role(organization_id, array['admin','coordinator','teacher']::app.user_role[]));

-- Audit logs: somente leitura por admin/coordenador. Escrita via backend/service_role.
drop policy if exists "admins can view audit logs" on app.audit_logs;
create policy "admins can view audit logs" on app.audit_logs
for select using (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]));

-- =========================
-- PRIVATE STORAGE BUCKETS
-- =========================
insert into storage.buckets (id, name, public)
values
  ('student-imports', 'student-imports', false),
  ('content-sources', 'content-sources', false),
  ('exports', 'exports', false)
on conflict (id) do update set public = excluded.public;

-- Storage policies for private files. O backend com service_role continua podendo operar sem expor arquivos.
drop policy if exists "staff can read private mvp files" on storage.objects;
create policy "staff can read private mvp files" on storage.objects
for select using (
  bucket_id in ('student-imports', 'content-sources', 'exports')
  and exists (
    select 1 from app.memberships m
    where m.auth_uid = auth.uid()
      and m.status = 'active'
      and m.role in ('admin','coordinator','teacher')
  )
);

-- =========================
-- OPTIONAL SEED ORGANIZATION
-- =========================
-- Descomente a linha abaixo para criar uma organização inicial manualmente.
-- insert into app.organizations (name) values ('Nexo Avalia') on conflict do nothing;
