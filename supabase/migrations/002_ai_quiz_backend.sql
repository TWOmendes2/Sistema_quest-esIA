-- Backend de geração de simulados por IA.
-- Execute após 001_initial_schema_rls.sql.

create or replace function app.create_quiz_from_ai(
  p_organization_id uuid,
  p_subject_id uuid,
  p_actor_auth_uid uuid,
  p_quiz_id uuid,
  p_class_id uuid,
  p_auto_publish boolean,
  p_payload jsonb
)
returns table (quiz_id uuid, question_count integer, quiz_status text)
language plpgsql
security definer
set search_path = app, public, auth
as $$
declare
  v_quiz_id uuid;
  v_question jsonb;
  v_option jsonb;
  v_question_id uuid;
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

  if jsonb_typeof(p_payload->'questions') <> 'array' or jsonb_array_length(p_payload->'questions') < 1 then
    raise exception 'Payload não contém questões.';
  end if;

  if p_quiz_id is null then
    insert into app.quizzes (
      organization_id, subject_id, title, description, status,
      created_by, published_by, published_at
    ) values (
      p_organization_id,
      p_subject_id,
      left(coalesce(nullif(p_payload->>'title', ''), 'Simulado gerado por IA'), 200),
      left(coalesce(p_payload->>'description', 'Gerado automaticamente a partir de transcrição.'), 2000),
      case when p_auto_publish then 'published'::app.quiz_status else 'draft'::app.quiz_status end,
      p_actor_auth_uid,
      case when p_auto_publish then p_actor_auth_uid else null end,
      case when p_auto_publish then now() else null end
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
    from app.quiz_questions
    where quiz_id = v_quiz_id;
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
      quiz_id, statement, topic, subtopic, difficulty,
      position, expected_time_seconds
    ) values (
      v_quiz_id,
      left(v_question->>'statement', 6000),
      left(v_question->>'topic', 180),
      left(v_question->>'subtopic', 180),
      (v_question->>'difficulty')::app.difficulty_level,
      v_position,
      greatest(30, least(900, coalesce((v_question->>'expected_time_seconds')::integer, 120)))
    ) returning id into v_question_id;

    v_option_position := 0;
    v_correct_option_id := null;

    for v_option in
      select value from jsonb_array_elements(v_question->'options')
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
      raise exception 'A alternativa correta da questão % não existe.', v_position;
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

  if p_auto_publish and p_class_id is not null then
    insert into app.quiz_assignments (
      organization_id, quiz_id, class_id, subject_id,
      release_at, status
    ) values (
      p_organization_id, v_quiz_id, p_class_id, p_subject_id,
      now(), 'active'
    ) on conflict (quiz_id, class_id, subject_id)
      do update set release_at = excluded.release_at, status = 'active';
  end if;

  return query
  select v_quiz_id,
         jsonb_array_length(p_payload->'questions'),
         case when p_auto_publish then 'published' else 'draft' end;
end;
$$;

revoke all on function app.create_quiz_from_ai(uuid, uuid, uuid, uuid, uuid, boolean, jsonb) from public;
grant execute on function app.create_quiz_from_ai(uuid, uuid, uuid, uuid, uuid, boolean, jsonb) to service_role;
