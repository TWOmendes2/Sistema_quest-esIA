-- Nexo Avalia - dados reais, revisão de questões, CRUD e exportações
-- Execute depois de 001_initial_schema_rls.sql e 002_ai_quiz_backend.sql.

create extension if not exists pgcrypto with schema public;
create extension if not exists unaccent with schema public;

-- Bucket privado usado para arquivar os arquivos processados na importação.
insert into storage.buckets (id, name, public, file_size_limit)
values ('student-imports', 'student-imports', false, 10485760)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit;

-- Identidade visual e metadados acadêmicos.
alter table app.subjects add column if not exists code text;
alter table app.subjects add column if not exists color text not null default '#FFFFFF';
alter table app.classes add column if not exists code text;
alter table app.classes add column if not exists description text;
alter table app.quizzes add column if not exists duration_minutes integer not null default 60;
alter table app.quizzes add column if not exists planned_question_count integer;
alter table app.quizzes add column if not exists settings jsonb not null default '{}'::jsonb;

-- Fluxo de revisão e reaproveitamento de questões.
alter table app.quiz_questions add column if not exists review_status text;
alter table app.quiz_questions add column if not exists source_ai_job_id uuid references app.ai_jobs(id) on delete set null;
alter table app.quiz_questions add column if not exists source_question_id uuid references app.quiz_questions(id) on delete set null;
alter table app.quiz_questions add column if not exists approved_by uuid references auth.users(id) on delete set null;
alter table app.quiz_questions add column if not exists approved_at timestamptz;
alter table app.quiz_questions add column if not exists updated_at timestamptz not null default now();

update app.quiz_questions qq
set review_status = case
  when exists (select 1 from app.quizzes q where q.id = qq.quiz_id and q.status = 'published') then 'approved'
  else 'review'
end
where review_status is null;

alter table app.quiz_questions alter column review_status set default 'review';
alter table app.quiz_questions alter column review_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'quiz_questions_review_status_check'
  ) then
    alter table app.quiz_questions add constraint quiz_questions_review_status_check
      check (review_status in ('draft','review','approved','rejected'));
  end if;
end $$;

-- Métricas reais de IA.
alter table app.ai_jobs add column if not exists pre_estimated_input_tokens integer;
alter table app.ai_jobs add column if not exists pre_estimated_output_tokens integer;
alter table app.ai_jobs add column if not exists pre_estimated_cost numeric(12,6);
alter table app.ai_jobs add column if not exists duration_ms integer;
alter table app.content_sources add column if not exists character_count integer;

create index if not exists idx_quiz_questions_review_status on app.quiz_questions(review_status);
create index if not exists idx_quiz_questions_source_ai_job on app.quiz_questions(source_ai_job_id);
create index if not exists idx_subjects_org_code on app.subjects(organization_id, code);
create index if not exists idx_classes_org_code on app.classes(organization_id, code);

-- Atualização automática de questão.
drop trigger if exists trg_quiz_questions_updated_at on app.quiz_questions;
create trigger trg_quiz_questions_updated_at
before update on app.quiz_questions
for each row execute function app.set_updated_at();

-- Nome oficial e cores padrão por matéria.
update app.organizations set name = 'Nexo Avalia', updated_at = now()
where id = nullif(current_setting('app.default_organization_id', true), '')::uuid
   or lower(name)='mvp simulados';

update app.subjects set
  code = coalesce(nullif(code, ''), upper(left(regexp_replace(name, '[^A-Za-zÀ-ÿ0-9]', '', 'g'), 4))),
  color = case lower(unaccent(name))
    when 'fisica' then '#6366F1'
    when 'quimica' then '#10B981'
    when 'biologia' then '#14B8A6'
    when 'linguagens' then '#F59E0B'
    when 'redacao' then '#EC4899'
    when 'humanas' then '#F97316'
    when 'matematica' then '#3B82F6'
    else case when color is null or color = '#FFFFFF' then '#64748B' else color end
  end;

-- Cria simulado e questões de IA já vinculadas ao job para edição/revisão.
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
begin
  if not exists (
    select 1 from app.memberships m
    where m.organization_id = p_organization_id
      and m.auth_uid = p_actor_auth_uid
      and m.status = 'active'
      and m.role in ('admin', 'coordinator', 'teacher')
  ) then
    raise exception 'Usuário sem permissão para criar simulado nesta organização.';
  end if;

  if not exists (
    select 1 from app.subjects s
    where s.id = p_subject_id and s.organization_id = p_organization_id and s.status = 'active'
  ) then
    raise exception 'Matéria inválida ou inativa.';
  end if;

  if p_class_id is not null and not exists (
    select 1 from app.classes c
    where c.id = p_class_id and c.organization_id = p_organization_id and c.status = 'active'
  ) then
    raise exception 'Turma inválida ou inativa.';
  end if;

  if jsonb_typeof(p_payload->'questions') <> 'array' or jsonb_array_length(p_payload->'questions') < 1 then
    raise exception 'Payload não contém questões.';
  end if;

  if p_quiz_id is null then
    insert into app.quizzes (
      organization_id, subject_id, title, description, status,
      created_by, published_by, published_at, planned_question_count
    ) values (
      p_organization_id,
      p_subject_id,
      left(coalesce(nullif(p_payload->>'title', ''), 'Lote de revisão gerado por IA'), 200),
      left(coalesce(p_payload->>'description', 'Questões geradas por IA para revisão.'), 2000),
      case when p_auto_publish then 'published'::app.quiz_status else 'draft'::app.quiz_status end,
      p_actor_auth_uid,
      case when p_auto_publish then p_actor_auth_uid else null end,
      case when p_auto_publish then now() else null end,
      jsonb_array_length(p_payload->'questions')
    ) returning id into v_quiz_id;
  else
    select q.id into v_quiz_id
    from app.quizzes q
    where q.id = p_quiz_id
      and q.organization_id = p_organization_id
      and q.status in ('draft', 'review');

    if v_quiz_id is null then
      raise exception 'Simulado informado não existe ou não pode ser editado.';
    end if;

    update app.quizzes
    set title = left(coalesce(nullif(p_payload->>'title', ''), title), 200),
        description = left(coalesce(p_payload->>'description', description), 2000),
        status = case when p_auto_publish then 'published'::app.quiz_status else status end,
        published_by = case when p_auto_publish then p_actor_auth_uid else published_by end,
        published_at = case when p_auto_publish then now() else published_at end,
        updated_at = now(),
        version = version + 1
    where id = v_quiz_id;

    select coalesce(max(position), 0) into v_position
    from app.quiz_questions as qq where qq.quiz_id = v_quiz_id;
  end if;

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
      quiz_id, statement, topic, subtopic, difficulty, position,
      expected_time_seconds, review_status, source_ai_job_id,
      approved_by, approved_at
    ) values (
      v_quiz_id,
      left(v_question->>'statement', 6000),
      left(v_question->>'topic', 180),
      left(v_question->>'subtopic', 180),
      (v_question->>'difficulty')::app.difficulty_level,
      v_position,
      greatest(30, least(900, coalesce((v_question->>'expected_time_seconds')::integer, 120))),
      case when p_auto_publish then 'approved' else 'review' end,
      p_ai_job_id,
      case when p_auto_publish then p_actor_auth_uid else null end,
      case when p_auto_publish then now() else null end
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

  if p_auto_publish and p_class_id is not null then
    update app.quiz_assignments as qa
    set release_at = now(), status = 'active'
    where qa.quiz_id = v_quiz_id
      and qa.class_id = p_class_id
      and qa.subject_id = p_subject_id;

    if not found then
      begin
        insert into app.quiz_assignments (
          organization_id, quiz_id, class_id, subject_id, release_at, status
        ) values (
          p_organization_id, v_quiz_id, p_class_id, p_subject_id, now(), 'active'
        );
      exception when unique_violation then
        update app.quiz_assignments as qa
        set release_at = now(), status = 'active'
        where qa.quiz_id = v_quiz_id
          and qa.class_id = p_class_id
          and qa.subject_id = p_subject_id;
      end;
    end if;
  end if;

  return query select v_quiz_id, jsonb_array_length(p_payload->'questions'),
    case when p_auto_publish then 'published' else 'draft' end, v_question_ids;
end;
$$;

revoke all on function app.create_quiz_from_ai_v2(uuid, uuid, uuid, uuid, uuid, uuid, boolean, jsonb) from public;
grant execute on function app.create_quiz_from_ai_v2(uuid, uuid, uuid, uuid, uuid, uuid, boolean, jsonb) to service_role;

-- Atualiza conteúdo, alternativas e gabarito de forma atômica.
create or replace function app.update_quiz_question(
  p_question_id uuid,
  p_actor_auth_uid uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = app, public, auth
as $$
declare
  v_quiz_id uuid;
  v_option jsonb;
  v_option_id uuid;
  v_correct_option_id uuid;
  v_position integer := 0;
begin
  select qq.quiz_id into v_quiz_id
  from app.quiz_questions qq
  join app.quizzes q on q.id = qq.quiz_id
  where qq.id = p_question_id and q.status in ('draft','review');
  if v_quiz_id is null then
    raise exception 'Questão não encontrada ou simulado não editável.';
  end if;
  if not app.can_manage_quiz(v_quiz_id) then
    -- service_role não possui auth.uid(); confira também o ator explicitamente.
    if not exists (
      select 1 from app.quizzes q
      join app.memberships m on m.organization_id = q.organization_id
      where q.id = v_quiz_id and m.auth_uid = p_actor_auth_uid
        and m.status = 'active' and m.role in ('admin','coordinator','teacher')
    ) then
      raise exception 'Sem permissão para editar esta questão.';
    end if;
  end if;

  update app.quiz_questions
  set statement = left(p_payload->>'statement', 6000),
      topic = left(p_payload->>'topic', 180),
      subtopic = left(p_payload->>'subtopic', 180),
      difficulty = (p_payload->>'difficulty')::app.difficulty_level,
      expected_time_seconds = greatest(30, least(900, (p_payload->>'expected_time_seconds')::integer)),
      review_status = case when review_status = 'approved' then 'review' else review_status end,
      approved_by = case when review_status = 'approved' then null else approved_by end,
      approved_at = case when review_status = 'approved' then null else approved_at end,
      version = version + 1,
      updated_at = now()
  where id = p_question_id;

  delete from app.question_answer_keys where quiz_question_id = p_question_id;
  delete from app.question_options where quiz_question_id = p_question_id;

  v_correct_option_id := null;
  for v_option in select value from jsonb_array_elements(p_payload->'options') order by value->>'label'
  loop
    v_position := v_position + 1;
    insert into app.question_options (quiz_question_id, label, option_text, position)
    values (p_question_id, v_option->>'label', left(v_option->>'text', 1200), v_position)
    returning id into v_option_id;
    if v_option->>'label' = p_payload->>'correct_label' then
      v_correct_option_id := v_option_id;
    end if;
  end loop;

  if v_correct_option_id is null then raise exception 'Gabarito inválido.'; end if;

  insert into app.question_answer_keys (
    quiz_question_id, correct_option_id, explanation_correct, explanation_wrong, created_by
  ) values (
    p_question_id, v_correct_option_id,
    left(p_payload->>'explanation_correct', 5000),
    left(coalesce(p_payload->>'explanation_wrong', 'Revise o conceito e compare cada alternativa.'), 5000),
    p_actor_auth_uid
  );

  return p_question_id;
end;
$$;

revoke all on function app.update_quiz_question(uuid, uuid, jsonb) from public;
grant execute on function app.update_quiz_question(uuid, uuid, jsonb) to service_role;

create or replace function app.set_question_review_status(
  p_question_id uuid,
  p_actor_auth_uid uuid,
  p_status text
)
returns text
language plpgsql
security definer
set search_path = app, public, auth
as $$
declare
  v_org_id uuid;
begin
  if p_status not in ('review','approved','rejected') then raise exception 'Status de revisão inválido.'; end if;
  select q.organization_id into v_org_id
  from app.quiz_questions qq join app.quizzes q on q.id = qq.quiz_id
  where qq.id = p_question_id and q.status in ('draft','review');
  if v_org_id is null then raise exception 'Questão não encontrada ou simulado não editável.'; end if;
  if not exists (
    select 1 from app.memberships m where m.organization_id = v_org_id
      and m.auth_uid = p_actor_auth_uid and m.status = 'active'
      and m.role in ('admin','coordinator','teacher')
  ) then raise exception 'Sem permissão para revisar esta questão.'; end if;

  update app.quiz_questions
  set review_status = p_status,
      approved_by = case when p_status = 'approved' then p_actor_auth_uid else null end,
      approved_at = case when p_status = 'approved' then now() else null end,
      updated_at = now(), version = version + 1
  where id = p_question_id;
  return p_status;
end;
$$;

revoke all on function app.set_question_review_status(uuid, uuid, text) from public;
grant execute on function app.set_question_review_status(uuid, uuid, text) to service_role;

-- Copia questões aprovadas para outro simulado, preservando o banco de origem.
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
  v_source_id uuid;
  v_new_id uuid;
  v_key record;
  v_option record;
  v_new_option_id uuid;
  v_correct_new_option_id uuid;
  v_position integer;
  v_count integer := 0;
begin
  select organization_id into v_target_org from app.quizzes where id = p_target_quiz_id and status in ('draft','review');
  if v_target_org is null then raise exception 'Simulado de destino inválido ou já publicado.'; end if;
  if not exists (
    select 1 from app.memberships m where m.organization_id = v_target_org
      and m.auth_uid = p_actor_auth_uid and m.status = 'active'
      and m.role in ('admin','coordinator','teacher')
  ) then raise exception 'Sem permissão para alterar o simulado de destino.'; end if;

  select coalesce(max(position), 0) into v_position from app.quiz_questions where quiz_id = p_target_quiz_id;

  foreach v_source_id in array p_question_ids loop
    if not exists (
      select 1 from app.quiz_questions qq join app.quizzes q on q.id = qq.quiz_id
      where qq.id = v_source_id and qq.review_status = 'approved' and q.organization_id = v_target_org
    ) then continue; end if;

    v_position := v_position + 1;
    insert into app.quiz_questions (
      quiz_id, statement, topic, subtopic, difficulty, position, expected_time_seconds,
      review_status, source_question_id, approved_by, approved_at
    )
    select p_target_quiz_id, statement, topic, subtopic, difficulty, v_position, expected_time_seconds,
      'approved', id, p_actor_auth_uid, now()
    from app.quiz_questions where id = v_source_id
    returning id into v_new_id;

    select qak.correct_option_id, qak.explanation_correct, qak.explanation_wrong
      into v_key from app.question_answer_keys qak where qak.quiz_question_id = v_source_id;
    v_correct_new_option_id := null;

    for v_option in select * from app.question_options where quiz_question_id = v_source_id order by position loop
      insert into app.question_options (quiz_question_id, label, option_text, position)
      values (v_new_id, v_option.label, v_option.option_text, v_option.position)
      returning id into v_new_option_id;
      if v_option.id = v_key.correct_option_id then v_correct_new_option_id := v_new_option_id; end if;
    end loop;

    insert into app.question_answer_keys (
      quiz_question_id, correct_option_id, explanation_correct, explanation_wrong, created_by
    ) values (
      v_new_id, v_correct_new_option_id, v_key.explanation_correct, v_key.explanation_wrong, p_actor_auth_uid
    );
    v_count := v_count + 1;
  end loop;

  update app.quizzes set planned_question_count = (
    select count(*) from app.quiz_questions where quiz_id = p_target_quiz_id
  ), updated_at = now(), version = version + 1 where id = p_target_quiz_id;

  return v_count;
end;
$$;

revoke all on function app.clone_approved_questions(uuid, uuid[], uuid) from public;
grant execute on function app.clone_approved_questions(uuid, uuid[], uuid) to service_role;
