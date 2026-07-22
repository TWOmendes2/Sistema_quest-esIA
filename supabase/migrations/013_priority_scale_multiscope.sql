-- ============================================================
-- 013 — Prioridades P0: multi-turma/multi-matéria, banco de questões,
--       revisão de IA, recuperação assistida e índices de escala.
-- ============================================================
-- Idempotente. Execute depois da migration 012.

alter table app.ai_jobs
  add column if not exists target_quiz_id uuid references app.quizzes(id) on delete set null,
  add column if not exists subject_id uuid references app.subjects(id) on delete set null;

-- Mantém a matéria da geração mesmo depois que o lote temporário de revisão é excluído.
update app.ai_jobs job
set subject_id = q.subject_id
from app.quizzes q
where q.id = job.quiz_id and job.subject_id is null;

create index if not exists idx_ai_jobs_target_quiz
  on app.ai_jobs(organization_id, target_quiz_id, created_at desc);
create index if not exists idx_ai_jobs_subject
  on app.ai_jobs(organization_id, subject_id, created_at desc);

alter table app.quizzes
  add column if not exists quiz_kind text not null default 'assessment',
  add column if not exists release_at timestamptz,
  add column if not exists due_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quizzes_quiz_kind_check') then
    alter table app.quizzes add constraint quizzes_quiz_kind_check
      check (quiz_kind in ('assessment','question_bank','ai_review'));
  end if;
end $$;

alter table app.quiz_questions
  add column if not exists subject_id uuid;

update app.quiz_questions qq
set subject_id = q.subject_id
from app.quizzes q
where q.id = qq.quiz_id and qq.subject_id is null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quiz_questions_subject_id_fkey') then
    alter table app.quiz_questions add constraint quiz_questions_subject_id_fkey
      foreign key (subject_id) references app.subjects(id) on delete cascade;
  end if;
end $$;

alter table app.quiz_questions alter column subject_id set not null;

create table if not exists app.quiz_classes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  quiz_id uuid not null references app.quizzes(id) on delete cascade,
  class_id uuid not null references app.classes(id) on delete cascade,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (quiz_id, class_id)
);

create table if not exists app.quiz_subjects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  quiz_id uuid not null references app.quizzes(id) on delete cascade,
  subject_id uuid not null references app.subjects(id) on delete cascade,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (quiz_id, subject_id)
);

-- Compatibilidade com os vínculos antigos.
insert into app.quiz_classes (organization_id, quiz_id, class_id, status)
select distinct qa.organization_id, qa.quiz_id, qa.class_id, qa.status
from app.quiz_assignments qa
on conflict (quiz_id, class_id) do update set status = excluded.status;

insert into app.quiz_subjects (organization_id, quiz_id, subject_id, status)
select distinct qa.organization_id, qa.quiz_id, qa.subject_id, qa.status
from app.quiz_assignments qa
on conflict (quiz_id, subject_id) do update set status = excluded.status;

insert into app.quiz_subjects (organization_id, quiz_id, subject_id, status)
select q.organization_id, q.id, q.subject_id, 'active'
from app.quizzes q
where q.quiz_kind = 'assessment'
on conflict (quiz_id, subject_id) do nothing;

update app.quizzes q
set release_at = coalesce(q.release_at, x.release_at),
    due_at = coalesce(q.due_at, x.due_at)
from (
  select quiz_id, min(release_at) release_at, max(due_at) due_at
  from app.quiz_assignments
  group by quiz_id
) x
where x.quiz_id = q.id;

create table if not exists app.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  student_id uuid not null references app.student_profiles(id) on delete cascade,
  auth_uid uuid not null references auth.users(id) on delete cascade,
  cpf_last4 text not null,
  status text not null default 'pending' check (status in ('pending','processing','approved','rejected','cancelled')),
  requested_ip_hash text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  temporary_password_issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'password_reset_requests_status_check') then
    alter table app.password_reset_requests drop constraint password_reset_requests_status_check;
  end if;
  alter table app.password_reset_requests add constraint password_reset_requests_status_check
    check (status in ('pending','processing','approved','rejected','cancelled'));
exception when duplicate_object then null;
end $$;

drop index if exists app.uq_password_reset_requests_pending;
create unique index uq_password_reset_requests_pending
  on app.password_reset_requests(organization_id, student_id)
  where status in ('pending','processing');

create index if not exists idx_password_reset_requests_queue
  on app.password_reset_requests(organization_id, status, created_at);
create index if not exists idx_quiz_classes_access on app.quiz_classes(organization_id, class_id, quiz_id) where status = 'active';
create index if not exists idx_quiz_subjects_access on app.quiz_subjects(organization_id, subject_id, quiz_id) where status = 'active';
create index if not exists idx_quizzes_kind_status on app.quizzes(organization_id, quiz_kind, status, release_at, due_at);
create index if not exists idx_quiz_questions_subject on app.quiz_questions(subject_id, quiz_id, review_status);
create index if not exists idx_attempts_ranking_v2 on app.attempts(organization_id, quiz_id, status, correct_count desc, duration_seconds asc, score_normalized desc, submitted_at asc);
create index if not exists idx_attempt_answers_subject_calc on app.attempt_answers(attempt_id, quiz_question_id, is_correct);

-- Evita duas tentativas simultâneas do mesmo aluno no mesmo simulado. Antes de
-- criar o índice, cancela duplicatas antigas e preserva apenas a mais recente.
with ranked_attempts as (
  select id,
         row_number() over (
           partition by student_id, quiz_id
           order by started_at desc nulls last, created_at desc nulls last, id desc
         ) as rn
  from app.attempts
  where status = 'in_progress'
)
update app.attempts a
set status = 'cancelled'
from ranked_attempts r
where r.id = a.id and r.rn > 1;

create unique index if not exists uq_attempts_one_in_progress
  on app.attempts(student_id, quiz_id)
  where status = 'in_progress';

-- Padroniza notas antigas sem bônus de velocidade. O tempo continua sendo o
-- primeiro desempate após os acertos, mas não pode ser adulterado para aumentar nota.
with question_weights as (
  select id,
         quiz_id,
         case difficulty
           when 'easy' then 1.0
           when 'medium' then 1.5
           else 2.0
         end::numeric as weight
  from app.quiz_questions
  where review_status = 'approved'
),
attempt_scores as (
  select a.id as attempt_id,
         coalesce(sum(case when aa.is_correct is true then qw.weight else 0 end), 0)::numeric as raw_score,
         coalesce(sum(qw.weight), 0)::numeric as max_score,
         count(*) filter (where aa.is_correct is true)::integer as correct_count,
         (count(*) - count(*) filter (where aa.is_correct is true))::integer as wrong_count
  from app.attempts a
  join question_weights qw on qw.quiz_id = a.quiz_id
  left join app.attempt_answers aa
    on aa.attempt_id = a.id and aa.quiz_question_id = qw.id
  where a.status in ('submitted','reviewed')
  group by a.id
)
update app.attempts a
set score_raw = s.raw_score,
    score_normalized = case when s.max_score > 0 then round((s.raw_score / s.max_score) * 100, 2) else 0 end,
    correct_count = s.correct_count,
    wrong_count = s.wrong_count
from attempt_scores s
where s.attempt_id = a.id;

update app.attempt_answers aa
set points_awarded = case
  when aa.is_correct is true then case qq.difficulty
    when 'easy' then 1.0
    when 'medium' then 1.5
    else 2.0
  end
  else 0
end
from app.quiz_questions qq
where qq.id = aa.quiz_question_id;

drop trigger if exists trg_password_reset_requests_updated_at on app.password_reset_requests;
create trigger trg_password_reset_requests_updated_at
before update on app.password_reset_requests
for each row execute function app.set_updated_at();

alter table app.quiz_classes enable row level security;
alter table app.quiz_subjects enable row level security;
alter table app.password_reset_requests enable row level security;

drop policy if exists "members can view quiz classes" on app.quiz_classes;
create policy "members can view quiz classes" on app.quiz_classes
for select using (app.is_org_member(organization_id));

drop policy if exists "staff can manage quiz classes" on app.quiz_classes;
create policy "staff can manage quiz classes" on app.quiz_classes
for all using (app.has_role(organization_id, array['admin','coordinator','teacher']::app.user_role[]))
with check (app.has_role(organization_id, array['admin','coordinator','teacher']::app.user_role[]));

drop policy if exists "members can view quiz subjects" on app.quiz_subjects;
create policy "members can view quiz subjects" on app.quiz_subjects
for select using (app.is_org_member(organization_id));

drop policy if exists "staff can manage quiz subjects" on app.quiz_subjects;
create policy "staff can manage quiz subjects" on app.quiz_subjects
for all using (app.has_role(organization_id, array['admin','coordinator','teacher']::app.user_role[]))
with check (app.has_role(organization_id, array['admin','coordinator','teacher']::app.user_role[]));

drop policy if exists "staff can view password reset requests" on app.password_reset_requests;
create policy "staff can view password reset requests" on app.password_reset_requests
for select using (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]));

drop policy if exists "staff can manage password reset requests" on app.password_reset_requests;
create policy "staff can manage password reset requests" on app.password_reset_requests
for update using (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]))
with check (app.has_role(organization_id, array['admin','coordinator']::app.user_role[]));

grant select, insert, update, delete on app.quiz_classes to service_role;
grant select, insert, update, delete on app.quiz_subjects to service_role;
grant select, insert, update, delete on app.password_reset_requests to service_role;

-- A leitura do aluno passa a aceitar turma OU matéria.
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
      and q.quiz_kind = 'assessment'
      and (
        app.can_manage_quiz(q.id)
        or (
          q.status = 'published'
          and (q.release_at is null or q.release_at <= now())
          and (q.due_at is null or q.due_at >= now())
          and exists (
            select 1
            from app.student_profiles sp
            where sp.auth_uid = auth.uid()
              and sp.organization_id = q.organization_id
              and sp.status = 'active'
              and exists (
                select 1 from app.enrollments e
                where e.student_id = sp.id
                  and e.status = 'active'
                  and coalesce(e.contract_status, 'not_required') <> 'pending'
                  and (
                    exists (select 1 from app.quiz_classes qc where qc.quiz_id = q.id and qc.class_id = e.class_id and qc.status = 'active')
                    or exists (select 1 from app.quiz_subjects qs where qs.quiz_id = q.id and qs.subject_id = e.subject_id and qs.status = 'active')
                  )
              )
          )
        )
      )
  );
$$;

-- Persistência da IA em lote isolado de revisão. O simulado real só recebe
-- questões aprovadas quando a revisão é concluída explicitamente.
create or replace function app.create_quiz_from_ai_v2(
  p_organization_id uuid,
  p_subject_id uuid,
  p_actor_auth_uid uuid,
  p_ai_job_id uuid,
  p_quiz_id uuid,
  p_class_id uuid,
  p_auto_publish boolean,
  p_payload jsonb
)
returns table (quiz_id uuid, question_count integer, quiz_status text, question_ids uuid[])
language plpgsql
security definer
set search_path = app, public, auth
as $$
declare
  v_quiz_id uuid;
  v_question jsonb;
  v_option jsonb;
  v_question_id uuid;
  v_question_ids uuid[] := '{}';
  v_option_id uuid;
  v_correct_option_id uuid;
  v_position integer := 0;
  v_option_position integer;
  v_labels text[];
  v_role app.user_role;
begin
  select m.role into v_role
  from app.memberships m
  where m.organization_id = p_organization_id
    and m.auth_uid = p_actor_auth_uid
    and m.status = 'active'
    and m.role in ('admin', 'coordinator', 'teacher')
  limit 1;

  if v_role is null then
    raise exception 'Usuário sem permissão para gerar questões nesta organização.';
  end if;

  if not exists (
    select 1 from app.subjects s
    where s.id = p_subject_id and s.organization_id = p_organization_id and s.status = 'active'
  ) then
    raise exception 'Matéria inválida ou inativa.';
  end if;

  if v_role = 'teacher' and not exists (
    select 1 from app.teacher_assignments ta
    where ta.organization_id = p_organization_id
      and ta.teacher_auth_uid = p_actor_auth_uid
      and (ta.subject_id is null or ta.subject_id = p_subject_id)
  ) then
    raise exception 'Professor sem permissão para gerar questões desta matéria.';
  end if;

  if jsonb_typeof(p_payload->'questions') <> 'array'
     or jsonb_array_length(p_payload->'questions') < 1 then
    raise exception 'Payload não contém questões.';
  end if;

  -- Na versão 0.4 a API sempre cria um lote separado. O parâmetro permanece
  -- no contrato para compatibilidade com clientes antigos, mas só aceita um
  -- lote ai_review já existente quando informado.
  if p_quiz_id is null then
    insert into app.quizzes (
      organization_id, subject_id, title, description, status, quiz_kind,
      created_by, planned_question_count
    ) values (
      p_organization_id,
      p_subject_id,
      left(coalesce(nullif(p_payload->>'title', ''), 'Lote de revisão gerado por IA'), 200),
      left(coalesce(p_payload->>'description', 'Questões geradas por IA para revisão.'), 2000),
      'draft'::app.quiz_status,
      'ai_review',
      p_actor_auth_uid,
      jsonb_array_length(p_payload->'questions')
    ) returning id into v_quiz_id;
  else
    select q.id into v_quiz_id
    from app.quizzes q
    where q.id = p_quiz_id
      and q.organization_id = p_organization_id
      and q.quiz_kind = 'ai_review'
      and q.status in ('draft', 'review');

    if v_quiz_id is null then
      raise exception 'Lote de revisão informado não existe ou não pode ser editado.';
    end if;

    select coalesce(max(position), 0) into v_position
    from app.quiz_questions qq where qq.quiz_id = v_quiz_id;
  end if;

  insert into app.quiz_subjects (organization_id, quiz_id, subject_id, status, created_by)
  values (p_organization_id, v_quiz_id, p_subject_id, 'active', p_actor_auth_uid)
  on conflict (quiz_id, subject_id) do update set status = 'active';

  for v_question in select value from jsonb_array_elements(p_payload->'questions')
  loop
    v_position := v_position + 1;

    if jsonb_array_length(v_question->'options') <> 5 then
      raise exception 'A questão % não possui exatamente cinco alternativas.', v_position;
    end if;

    select array_agg(value->>'label' order by value->>'label') into v_labels
    from jsonb_array_elements(v_question->'options');

    if v_labels <> array['A','B','C','D','E']::text[] then
      raise exception 'A questão % deve conter exatamente as alternativas A, B, C, D e E.', v_position;
    end if;

    insert into app.quiz_questions (
      quiz_id, subject_id, statement, topic, subtopic, difficulty, position,
      expected_time_seconds, review_status, source_ai_job_id,
      approved_by, approved_at
    ) values (
      v_quiz_id,
      p_subject_id,
      left(v_question->>'statement', 6000),
      left(v_question->>'topic', 180),
      left(v_question->>'subtopic', 180),
      (v_question->>'difficulty')::app.difficulty_level,
      v_position,
      greatest(30, least(900, coalesce((v_question->>'expected_time_seconds')::integer, 120))),
      'review',
      p_ai_job_id,
      null,
      null
    ) returning id into v_question_id;

    v_question_ids := array_append(v_question_ids, v_question_id);
    v_option_position := 0;
    v_correct_option_id := null;

    for v_option in
      select value from jsonb_array_elements(v_question->'options') order by value->>'label'
    loop
      v_option_position := v_option_position + 1;
      insert into app.question_options (quiz_question_id, label, option_text, position)
      values (v_question_id, v_option->>'label', left(v_option->>'text', 1200), v_option_position)
      returning id into v_option_id;

      if v_option->>'label' = v_question->>'correct_label' then
        v_correct_option_id := v_option_id;
      end if;
    end loop;

    if v_correct_option_id is null then
      raise exception 'A alternativa correta da questão % não existe.', v_position;
    end if;

    insert into app.question_answer_keys (
      quiz_question_id, correct_option_id, explanation_correct, explanation_wrong, created_by
    ) values (
      v_question_id,
      v_correct_option_id,
      left(v_question->>'explanation_correct', 5000),
      left(v_question->>'explanation_wrong', 5000),
      p_actor_auth_uid
    );
  end loop;

  return query select v_quiz_id, jsonb_array_length(p_payload->'questions'), 'draft', v_question_ids;
end;
$$;

revoke all on function app.create_quiz_from_ai_v2(uuid, uuid, uuid, uuid, uuid, uuid, boolean, jsonb) from public;
grant execute on function app.create_quiz_from_ai_v2(uuid, uuid, uuid, uuid, uuid, uuid, boolean, jsonb) to service_role;

-- Clonagem compatível com matéria por questão e escopo do professor.
create or replace function app.clone_approved_questions(
  p_target_quiz_id uuid,
  p_question_ids uuid[],
  p_actor_auth_uid uuid
)
returns integer
language plpgsql
security definer
set search_path = app, public, auth
as $$
declare
  v_target_org uuid;
  v_actor_role app.user_role;
  v_source_id uuid;
  v_source_subject uuid;
  v_root_id uuid;
  v_source_fingerprint text;
  v_new_id uuid;
  v_key record;
  v_option record;
  v_new_option_id uuid;
  v_correct_new_option_id uuid;
  v_position integer;
  v_count integer := 0;
begin
  select q.organization_id into v_target_org
  from app.quizzes q
  where q.id = p_target_quiz_id and q.status in ('draft','review');
  if v_target_org is null then raise exception 'Simulado de destino inválido ou já publicado.'; end if;

  select m.role into v_actor_role from app.memberships m
  where m.organization_id = v_target_org and m.auth_uid = p_actor_auth_uid and m.status = 'active'
    and m.role in ('admin','coordinator','teacher') limit 1;
  if v_actor_role is null then raise exception 'Sem permissão para alterar o simulado de destino.'; end if;

  select coalesce(max(position),0) into v_position from app.quiz_questions where quiz_id = p_target_quiz_id;

  foreach v_source_id in array p_question_ids loop
    v_root_id := null; v_source_subject := null; v_source_fingerprint := null;
    select coalesce(qq.source_question_id, qq.id), qq.subject_id, qq.content_fingerprint
      into v_root_id, v_source_subject, v_source_fingerprint
    from app.quiz_questions qq join app.quizzes q on q.id = qq.quiz_id
    where qq.id = v_source_id and qq.review_status = 'approved' and q.organization_id = v_target_org;

    if v_root_id is null then continue; end if;
    if v_actor_role = 'teacher' and not exists (
      select 1 from app.teacher_assignments ta
      where ta.organization_id = v_target_org and ta.teacher_auth_uid = p_actor_auth_uid
        and (ta.subject_id is null or ta.subject_id = v_source_subject)
    ) then continue; end if;

    if exists (
      select 1 from app.quiz_questions target
      where target.quiz_id = p_target_quiz_id and (
        target.id = v_root_id or target.source_question_id = v_root_id
        or (v_source_fingerprint is not null and target.content_fingerprint = v_source_fingerprint)
      )
    ) then continue; end if;

    v_position := v_position + 1;
    insert into app.quiz_questions (
      quiz_id, subject_id, statement, topic, subtopic, difficulty, position,
      expected_time_seconds, review_status, source_question_id, content_fingerprint,
      approved_by, approved_at
    )
    select p_target_quiz_id, qq.subject_id, qq.statement, qq.topic, qq.subtopic,
      qq.difficulty, v_position, qq.expected_time_seconds, 'approved', v_root_id,
      qq.content_fingerprint, p_actor_auth_uid, now()
    from app.quiz_questions qq where qq.id = v_source_id
    returning id into v_new_id;

    select qak.correct_option_id, qak.explanation_correct, qak.explanation_wrong
      into v_key from app.question_answer_keys qak where qak.quiz_question_id = v_source_id;
    v_correct_new_option_id := null;
    for v_option in select * from app.question_options where quiz_question_id = v_source_id order by position loop
      insert into app.question_options (quiz_question_id,label,option_text,position)
      values (v_new_id,v_option.label,v_option.option_text,v_option.position)
      returning id into v_new_option_id;
      if v_option.id = v_key.correct_option_id then v_correct_new_option_id := v_new_option_id; end if;
    end loop;
    if v_correct_new_option_id is null then raise exception 'Gabarito inválido na questão %', v_source_id; end if;
    insert into app.question_answer_keys (quiz_question_id,correct_option_id,explanation_correct,explanation_wrong,created_by)
    values (v_new_id,v_correct_new_option_id,v_key.explanation_correct,v_key.explanation_wrong,p_actor_auth_uid);
    v_count := v_count + 1;
  end loop;

  update app.quizzes q set planned_question_count = greatest(q.planned_question_count,
    (select count(*) from app.quiz_questions qq where qq.quiz_id = p_target_quiz_id)),
    updated_at = now(), version = version + 1 where q.id = p_target_quiz_id;
  return v_count;
end;
$$;

revoke all on function app.clone_approved_questions(uuid,uuid[],uuid) from public;
grant execute on function app.clone_approved_questions(uuid,uuid[],uuid) to service_role;

-- Conclui um lote de IA: aprovadas vão para o banco e, opcionalmente, para um simulado.
create or replace function app.finalize_ai_review(
  p_staging_quiz_id uuid,
  p_target_quiz_id uuid,
  p_actor_auth_uid uuid
)
returns jsonb
language plpgsql
security definer
set search_path = app, public, auth
as $$
declare
  v_org uuid;
  v_subject uuid;
  v_kind text;
  v_bank_id uuid;
  v_approved_ids uuid[];
  v_approved integer := 0;
  v_removed integer := 0;
  v_bank_copied integer := 0;
  v_target_copied integer := 0;
begin
  select organization_id, subject_id, quiz_kind into v_org, v_subject, v_kind
  from app.quizzes where id = p_staging_quiz_id;
  if v_org is null or v_kind <> 'ai_review' then raise exception 'Lote de revisão de IA inválido.'; end if;
  if not exists (select 1 from app.memberships where organization_id=v_org and auth_uid=p_actor_auth_uid and status='active' and role in ('admin','coordinator','teacher')) then
    raise exception 'Sem permissão para concluir esta revisão.';
  end if;
  if exists (select 1 from app.memberships where organization_id=v_org and auth_uid=p_actor_auth_uid and status='active' and role='teacher')
     and not exists (select 1 from app.teacher_assignments where organization_id=v_org and teacher_auth_uid=p_actor_auth_uid and subject_id=v_subject) then
    raise exception 'Professor sem acesso à matéria do lote.';
  end if;

  select coalesce(array_agg(id), array[]::uuid[]) into v_approved_ids
  from app.quiz_questions where quiz_id=p_staging_quiz_id and review_status='approved';
  v_approved := coalesce(array_length(v_approved_ids,1),0);
  select count(*) into v_removed from app.quiz_questions where quiz_id=p_staging_quiz_id and review_status <> 'approved';

  if v_approved > 0 then
    select id into v_bank_id from app.quizzes
    where organization_id=v_org and subject_id=v_subject and quiz_kind='question_bank'
    order by created_at limit 1;
    if v_bank_id is null then
      insert into app.quizzes (organization_id,subject_id,title,description,status,quiz_kind,created_by,duration_minutes,planned_question_count,settings)
      values (v_org,v_subject,'Banco de questões','Contêiner interno de questões aprovadas.','draft','question_bank',p_actor_auth_uid,60,1,'{}'::jsonb)
      returning id into v_bank_id;
    end if;
    v_bank_copied := app.clone_approved_questions(v_bank_id,v_approved_ids,p_actor_auth_uid);
    if p_target_quiz_id is not null then
      if not exists (select 1 from app.quizzes where id=p_target_quiz_id and organization_id=v_org and quiz_kind='assessment' and status in ('draft','review')) then
        raise exception 'Simulado de destino inválido.';
      end if;
      insert into app.quiz_subjects (organization_id,quiz_id,subject_id,status,created_by)
      values (v_org,p_target_quiz_id,v_subject,'active',p_actor_auth_uid)
      on conflict (quiz_id,subject_id) do update set status='active';
      v_target_copied := app.clone_approved_questions(p_target_quiz_id,v_approved_ids,p_actor_auth_uid);
    end if;
  end if;

  delete from app.quizzes where id=p_staging_quiz_id;
  return jsonb_build_object('approved',v_approved,'removed',v_removed,'bankQuizId',v_bank_id,'bankCopied',v_bank_copied,'targetCopied',v_target_copied);
end;
$$;

revoke all on function app.finalize_ai_review(uuid,uuid,uuid) from public;
grant execute on function app.finalize_ai_review(uuid,uuid,uuid) to service_role;

-- Atualização atômica do público (várias turmas e matérias).
create or replace function app.set_quiz_scope(
  p_quiz_id uuid,
  p_subject_ids uuid[],
  p_class_ids uuid[],
  p_release_at timestamptz,
  p_due_at timestamptz,
  p_actor_auth_uid uuid
)
returns void
language plpgsql
security definer
set search_path = app, public, auth
as $$
declare
  v_org uuid;
  v_role app.user_role;
  v_subject uuid;
  v_class uuid;
begin
  select organization_id into v_org from app.quizzes where id = p_quiz_id for update;
  if v_org is null then raise exception 'Simulado não encontrado.'; end if;
  if coalesce(array_length(p_subject_ids, 1), 0) = 0 then raise exception 'Selecione ao menos uma matéria.'; end if;
  if p_release_at is not null and p_due_at is not null and p_due_at <= p_release_at then
    raise exception 'O prazo deve ser posterior à liberação.';
  end if;

  select role into v_role from app.memberships
  where organization_id = v_org and auth_uid = p_actor_auth_uid and status = 'active'
    and role in ('admin','coordinator','teacher')
  limit 1;
  if v_role is null then raise exception 'Sem permissão para alterar este simulado.'; end if;

  foreach v_subject in array p_subject_ids loop
    if not exists (select 1 from app.subjects where id = v_subject and organization_id = v_org and status = 'active') then
      raise exception 'Matéria inválida ou inativa.';
    end if;
    if v_role = 'teacher' and not exists (
      select 1 from app.teacher_assignments
      where organization_id = v_org and teacher_auth_uid = p_actor_auth_uid and subject_id = v_subject
    ) then raise exception 'Professor sem permissão para uma das matérias selecionadas.'; end if;
  end loop;

  foreach v_class in array coalesce(p_class_ids, array[]::uuid[]) loop
    if not exists (select 1 from app.classes where id = v_class and organization_id = v_org and status = 'active') then
      raise exception 'Turma inválida ou inativa.';
    end if;
  end loop;

  update app.quizzes set subject_id = p_subject_ids[1], release_at = p_release_at, due_at = p_due_at where id = p_quiz_id;
  delete from app.quiz_subjects where quiz_id = p_quiz_id;
  insert into app.quiz_subjects (organization_id, quiz_id, subject_id, created_by)
  select v_org, p_quiz_id, x, p_actor_auth_uid from unnest(p_subject_ids) x;
  delete from app.quiz_classes where quiz_id = p_quiz_id;
  insert into app.quiz_classes (organization_id, quiz_id, class_id, created_by)
  select v_org, p_quiz_id, x, p_actor_auth_uid from unnest(coalesce(p_class_ids, array[]::uuid[])) x;

  -- Mantém a tabela legada sincronizada enquanto versões antigas ainda existirem.
  delete from app.quiz_assignments where quiz_id = p_quiz_id;
  if coalesce(array_length(p_class_ids, 1), 0) > 0 then
    insert into app.quiz_assignments (organization_id, quiz_id, class_id, subject_id, release_at, due_at, status)
    select v_org, p_quiz_id, c, s, p_release_at, p_due_at, 'active'
    from unnest(p_class_ids) c cross join unnest(p_subject_ids) s;
  end if;
end;
$$;

grant execute on function app.set_quiz_scope(uuid, uuid[], uuid[], timestamptz, timestamptz, uuid) to service_role;
