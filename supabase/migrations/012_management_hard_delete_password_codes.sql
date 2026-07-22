-- ============================================================
-- 012 — Gestão destrutiva, recuperação por código e hotfix de fingerprint
-- ============================================================
-- Esta migration é idempotente e pode ser aplicada mesmo quando a 011
-- ainda não foi executada no ambiente remoto.

create or replace function app.normalize_question_text(p_text text)
returns text
language sql
immutable
as $$
  select trim(
    regexp_replace(
      translate(
        lower(coalesce(p_text, '')),
        'áàãâäéèêëíìîïóòõôöúùûüçñ',
        'aaaaaeeeeiiiiooooouuuucn'
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function app.question_fingerprint(p_text text)
returns text
language sql
immutable
as $$
  select md5(app.normalize_question_text(p_text));
$$;

alter table app.quiz_questions
  add column if not exists content_fingerprint text;

update app.quiz_questions
set content_fingerprint = app.question_fingerprint(statement)
where content_fingerprint is distinct from app.question_fingerprint(statement);

create index if not exists idx_quiz_questions_fingerprint
  on app.quiz_questions(content_fingerprint);

create or replace function app.prepare_question_fingerprint_only()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
begin
  new.content_fingerprint := app.question_fingerprint(new.statement);
  return new;
end;
$$;

drop trigger if exists trg_prepare_question_fingerprint_only on app.quiz_questions;
create trigger trg_prepare_question_fingerprint_only
before insert or update of statement
on app.quiz_questions
for each row
execute function app.prepare_question_fingerprint_only();

-- Códigos de recuperação são acessados somente pelo backend com service role.
create table if not exists app.password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references app.organizations(id) on delete cascade,
  auth_uid uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('student', 'staff')),
  email_hash text not null,
  code_hash text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  requested_ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_codes_lookup
  on app.password_reset_codes(email_hash, mode, created_at desc)
  where consumed_at is null;

create index if not exists idx_password_reset_codes_expiration
  on app.password_reset_codes(expires_at)
  where consumed_at is null;

alter table app.password_reset_codes enable row level security;

-- Ao apagar uma matéria, seus simulados e todo o histórico dependente
-- são removidos em cascata, conforme a ação destrutiva solicitada no painel.
alter table app.quizzes
  drop constraint if exists quizzes_subject_id_fkey;

alter table app.quizzes
  add constraint quizzes_subject_id_fkey
  foreign key (subject_id)
  references app.subjects(id)
  on delete cascade;

-- Remove definitivamente dados que já haviam sido apenas arquivados/rejeitados
-- em versões anteriores. As dependências usam ON DELETE CASCADE.
delete from app.quiz_questions
where review_status = 'rejected';

delete from app.quizzes
where status::text = 'archived';

delete from app.classes
where status = 'archived';

delete from app.subjects
where status = 'archived';
