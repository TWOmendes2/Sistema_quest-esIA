-- ============================================================
-- 011 — DEDUPLICAÇÃO DO BANCO DE QUESTÕES
-- ============================================================
-- Objetivos:
-- 1. criar uma impressão digital estável para cada enunciado;
-- 2. marcar cópias e duplicações com source_question_id;
-- 3. impedir novas duplicações no mesmo simulado pelos fluxos de IA/reuso;
-- 4. manter cópias históricas já utilizadas em simulados e tentativas;
-- 5. permitir que o banco de questões exiba apenas a questão canônica.
--
-- A migration não apaga questões nem respostas de alunos.
-- Pode ser executada novamente.
-- ============================================================

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

-- Consolida duplicações exatas por organização e matéria.
-- A linha mais antiga vira a canônica; as demais continuam nos simulados,
-- mas passam a apontar para a canônica.
with ranked_questions as (
  select
    qq.id,
    first_value(qq.id) over (
      partition by q.organization_id, q.subject_id, qq.content_fingerprint
      order by qq.created_at asc, qq.id asc
    ) as canonical_id
  from app.quiz_questions as qq
  join app.quizzes as q
    on q.id = qq.quiz_id
  where qq.content_fingerprint is not null
    and qq.content_fingerprint <> md5('')
)
update app.quiz_questions as qq
set source_question_id = ranked.canonical_id,
    updated_at = now()
from ranked_questions as ranked
where qq.id = ranked.id
  and ranked.id <> ranked.canonical_id
  and qq.source_question_id is distinct from ranked.canonical_id;

-- A questão canônica nunca aponta para si mesma.
update app.quiz_questions
set source_question_id = null,
    updated_at = now()
where source_question_id = id;

create index if not exists idx_quiz_questions_fingerprint
  on app.quiz_questions(content_fingerprint);

create index if not exists idx_quiz_questions_source_question
  on app.quiz_questions(source_question_id);

create index if not exists idx_quiz_questions_quiz_fingerprint
  on app.quiz_questions(quiz_id, content_fingerprint);

-- Mantém fingerprint e vínculo canônico atualizados em inserts/edições.
create or replace function app.prepare_question_identity()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_organization_id uuid;
  v_subject_id uuid;
  v_canonical_id uuid;
begin
  new.content_fingerprint := app.question_fingerprint(new.statement);

  select q.organization_id, q.subject_id
    into v_organization_id, v_subject_id
  from app.quizzes as q
  where q.id = new.quiz_id;

  select coalesce(qq.source_question_id, qq.id)
    into v_canonical_id
  from app.quiz_questions as qq
  join app.quizzes as q
    on q.id = qq.quiz_id
  where q.organization_id = v_organization_id
    and q.subject_id = v_subject_id
    and qq.content_fingerprint = new.content_fingerprint
    and qq.id <> new.id
  order by
    case when qq.source_question_id is null then 0 else 1 end,
    qq.created_at asc,
    qq.id asc
  limit 1;

  if v_canonical_id is not null then
    new.source_question_id := v_canonical_id;
  elsif tg_op = 'UPDATE' and new.statement is distinct from old.statement then
    new.source_question_id := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prepare_question_identity on app.quiz_questions;
create trigger trg_prepare_question_identity
before insert or update of statement, quiz_id
on app.quiz_questions
for each row
execute function app.prepare_question_identity();

-- Se uma questão canônica for removida, escolhe outra instância da família
-- como canônica sem deixar várias cópias soltas no banco.
create or replace function app.relink_question_family_after_delete()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_organization_id uuid;
  v_subject_id uuid;
  v_new_canonical_id uuid;
begin
  select q.organization_id, q.subject_id
    into v_organization_id, v_subject_id
  from app.quizzes as q
  where q.id = old.quiz_id;

  if v_organization_id is null or old.content_fingerprint is null then
    return old;
  end if;

  select qq.id
    into v_new_canonical_id
  from app.quiz_questions as qq
  join app.quizzes as q
    on q.id = qq.quiz_id
  where q.organization_id = v_organization_id
    and q.subject_id = v_subject_id
    and qq.content_fingerprint = old.content_fingerprint
  order by qq.created_at asc, qq.id asc
  limit 1;

  if v_new_canonical_id is not null then
    update app.quiz_questions as qq
    set source_question_id = case
          when qq.id = v_new_canonical_id then null
          else v_new_canonical_id
        end,
        updated_at = now()
    from app.quizzes as q
    where q.id = qq.quiz_id
      and q.organization_id = v_organization_id
      and q.subject_id = v_subject_id
      and qq.content_fingerprint = old.content_fingerprint;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_relink_question_family_after_delete on app.quiz_questions;
create trigger trg_relink_question_family_after_delete
after delete
on app.quiz_questions
for each row
execute function app.relink_question_family_after_delete();

-- Persistência de IA com deduplicação no mesmo simulado e vínculo canônico.
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
  v_created_new boolean := false;
  v_question jsonb;
  v_option jsonb;
  v_question_id uuid;
  v_question_ids uuid[] := '{}';
  v_option_id uuid;
  v_correct_option_id uuid;
  v_position integer := 0;
  v_option_position integer;
  v_labels text[];
  v_fingerprint text;
  v_canonical_id uuid;
  v_inserted_count integer := 0;
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
    where s.id = p_subject_id
      and s.organization_id = p_organization_id
      and s.status = 'active'
  ) then
    raise exception 'Matéria inválida ou inativa.';
  end if;

  if p_class_id is not null and not exists (
    select 1 from app.classes c
    where c.id = p_class_id
      and c.organization_id = p_organization_id
      and c.status = 'active'
  ) then
    raise exception 'Turma inválida ou inativa.';
  end if;

  if jsonb_typeof(p_payload->'questions') <> 'array'
     or jsonb_array_length(p_payload->'questions') < 1 then
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
      0
    ) returning id into v_quiz_id;
    v_created_new := true;
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

    select coalesce(max(qq.position), 0)
      into v_position
    from app.quiz_questions as qq
    where qq.quiz_id = v_quiz_id;
  end if;

  for v_question in
    select value from jsonb_array_elements(p_payload->'questions')
  loop
    if jsonb_array_length(v_question->'options') <> 5 then
      raise exception 'Uma questão não possui exatamente cinco alternativas.';
    end if;

    select array_agg(value->>'label' order by value->>'label')
      into v_labels
    from jsonb_array_elements(v_question->'options');

    if v_labels <> array['A','B','C','D','E']::text[] then
      raise exception 'A questão deve conter exatamente as alternativas A, B, C, D e E.';
    end if;

    v_fingerprint := app.question_fingerprint(v_question->>'statement');

    -- Não insere duas vezes o mesmo enunciado no mesmo simulado.
    if exists (
      select 1
      from app.quiz_questions as existing
      where existing.quiz_id = v_quiz_id
        and existing.content_fingerprint = v_fingerprint
    ) then
      continue;
    end if;

    select coalesce(qq.source_question_id, qq.id)
      into v_canonical_id
    from app.quiz_questions as qq
    join app.quizzes as q
      on q.id = qq.quiz_id
    where q.organization_id = p_organization_id
      and q.subject_id = p_subject_id
      and qq.content_fingerprint = v_fingerprint
    order by
      case when qq.source_question_id is null then 0 else 1 end,
      qq.created_at asc,
      qq.id asc
    limit 1;

    v_position := v_position + 1;

    insert into app.quiz_questions (
      quiz_id, statement, topic, subtopic, difficulty, position,
      expected_time_seconds, review_status, source_ai_job_id,
      source_question_id, content_fingerprint, approved_by, approved_at
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
      v_canonical_id,
      v_fingerprint,
      case when p_auto_publish then p_actor_auth_uid else null end,
      case when p_auto_publish then now() else null end
    ) returning id into v_question_id;

    v_question_ids := array_append(v_question_ids, v_question_id);
    v_inserted_count := v_inserted_count + 1;
    v_option_position := 0;
    v_correct_option_id := null;

    for v_option in
      select value
      from jsonb_array_elements(v_question->'options')
      order by value->>'label'
    loop
      v_option_position := v_option_position + 1;

      insert into app.question_options (
        quiz_question_id, label, option_text, position
      ) values (
        v_question_id,
        v_option->>'label',
        left(v_option->>'text', 1200),
        v_option_position
      ) returning id into v_option_id;

      if v_option->>'label' = v_question->>'correct_label' then
        v_correct_option_id := v_option_id;
      end if;
    end loop;

    if v_correct_option_id is null then
      raise exception 'A alternativa correta da questão não existe.';
    end if;

    insert into app.question_answer_keys (
      quiz_question_id, correct_option_id,
      explanation_correct, explanation_wrong, created_by
    ) values (
      v_question_id,
      v_correct_option_id,
      left(v_question->>'explanation_correct', 5000),
      left(v_question->>'explanation_wrong', 5000),
      p_actor_auth_uid
    );
  end loop;

  if v_inserted_count = 0 then
    if v_created_new then
      delete from app.quizzes where id = v_quiz_id;
    end if;
    raise exception 'Todas as questões geradas já existem no simulado de destino.';
  end if;

  update app.quizzes
  set planned_question_count = (
        select count(*) from app.quiz_questions as qq where qq.quiz_id = v_quiz_id
      ),
      updated_at = now()
  where id = v_quiz_id;

  if p_auto_publish and p_class_id is not null then
    update app.quiz_assignments as qa
    set release_at = now(), status = 'active'
    where qa.quiz_id = v_quiz_id
      and qa.class_id = p_class_id
      and qa.subject_id = p_subject_id;

    if not found then
      insert into app.quiz_assignments (
        organization_id, quiz_id, class_id, subject_id, release_at, status
      ) values (
        p_organization_id, v_quiz_id, p_class_id, p_subject_id, now(), 'active'
      )
      on conflict (quiz_id, class_id, subject_id)
      do update set release_at = excluded.release_at, status = 'active';
    end if;
  end if;

  return query
  select
    v_quiz_id,
    v_inserted_count,
    case when p_auto_publish then 'published' else 'draft' end,
    v_question_ids;
end;
$$;

revoke all on function app.create_quiz_from_ai_v2(uuid, uuid, uuid, uuid, uuid, uuid, boolean, jsonb) from public;
grant execute on function app.create_quiz_from_ai_v2(uuid, uuid, uuid, uuid, uuid, uuid, boolean, jsonb) to service_role;

-- Reutilização sem duplicar a mesma questão no mesmo simulado.
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
  select q.organization_id
    into v_target_org
  from app.quizzes as q
  where q.id = p_target_quiz_id
    and q.status in ('draft','review');

  if v_target_org is null then
    raise exception 'Simulado de destino inválido ou já publicado.';
  end if;

  if not exists (
    select 1
    from app.memberships m
    where m.organization_id = v_target_org
      and m.auth_uid = p_actor_auth_uid
      and m.status = 'active'
      and m.role in ('admin','coordinator','teacher')
  ) then
    raise exception 'Sem permissão para alterar o simulado de destino.';
  end if;

  select coalesce(max(qq.position), 0)
    into v_position
  from app.quiz_questions as qq
  where qq.quiz_id = p_target_quiz_id;

  foreach v_source_id in array p_question_ids
  loop
    select
      coalesce(qq.source_question_id, qq.id),
      qq.content_fingerprint
      into v_root_id, v_source_fingerprint
    from app.quiz_questions as qq
    join app.quizzes as q
      on q.id = qq.quiz_id
    where qq.id = v_source_id
      and qq.review_status = 'approved'
      and q.organization_id = v_target_org;

    if v_root_id is null then
      continue;
    end if;

    if exists (
      select 1
      from app.quiz_questions as target_question
      where target_question.quiz_id = p_target_quiz_id
        and (
          target_question.id = v_root_id
          or target_question.source_question_id = v_root_id
          or target_question.content_fingerprint = v_source_fingerprint
        )
    ) then
      continue;
    end if;

    v_position := v_position + 1;

    insert into app.quiz_questions (
      quiz_id, statement, topic, subtopic, difficulty, position,
      expected_time_seconds, review_status, source_question_id,
      content_fingerprint, approved_by, approved_at
    )
    select
      p_target_quiz_id,
      qq.statement,
      qq.topic,
      qq.subtopic,
      qq.difficulty,
      v_position,
      qq.expected_time_seconds,
      'approved',
      v_root_id,
      qq.content_fingerprint,
      p_actor_auth_uid,
      now()
    from app.quiz_questions as qq
    where qq.id = v_source_id
    returning id into v_new_id;

    select
      qak.correct_option_id,
      qak.explanation_correct,
      qak.explanation_wrong
      into v_key
    from app.question_answer_keys as qak
    where qak.quiz_question_id = v_source_id;

    v_correct_new_option_id := null;

    for v_option in
      select *
      from app.question_options
      where quiz_question_id = v_source_id
      order by position
    loop
      insert into app.question_options (
        quiz_question_id, label, option_text, position
      ) values (
        v_new_id,
        v_option.label,
        v_option.option_text,
        v_option.position
      ) returning id into v_new_option_id;

      if v_option.id = v_key.correct_option_id then
        v_correct_new_option_id := v_new_option_id;
      end if;
    end loop;

    insert into app.question_answer_keys (
      quiz_question_id, correct_option_id,
      explanation_correct, explanation_wrong, created_by
    ) values (
      v_new_id,
      v_correct_new_option_id,
      v_key.explanation_correct,
      v_key.explanation_wrong,
      p_actor_auth_uid
    );

    v_count := v_count + 1;
  end loop;

  update app.quizzes
  set planned_question_count = (
        select count(*) from app.quiz_questions where quiz_id = p_target_quiz_id
      ),
      updated_at = now(),
      version = version + 1
  where id = p_target_quiz_id;

  return v_count;
end;
$$;

revoke all on function app.clone_approved_questions(uuid, uuid[], uuid) from public;
grant execute on function app.clone_approved_questions(uuid, uuid[], uuid) to service_role;

notify pgrst, 'reload schema';

-- Diagnóstico final: mostra quantas cópias foram consolidadas por organização.
select
  q.organization_id,
  count(*) filter (where qq.source_question_id is null) as questoes_canonicas,
  count(*) filter (where qq.source_question_id is not null) as copias_historicas,
  count(*) as total_instancias
from app.quiz_questions as qq
join app.quizzes as q
  on q.id = qq.quiz_id
group by q.organization_id
order by q.organization_id;
