-- Nexo Avalia v0.4.1
-- Isolamento de professores por matéria.
-- Execute depois de 013_priority_scale_multiscope.sql e antes de 019.
--
-- Regras:
--   * admin/coordinator mantêm acesso amplo à organização;
--   * teacher só lê e altera conteúdo da matéria atribuída;
--   * vínculo teacher_assignments com subject_id NULL não concede acesso amplo;
--   * simulado multidisciplinar só pode ter configurações gerais alteradas por
--     quem administra todas as matérias efetivamente existentes nele;
--   * em simulados multidisciplinares, o professor ainda pode trabalhar apenas
--     nas questões da própria matéria;
--   * o backend continua obrigado a aplicar o mesmo escopo porque usa service_role.

begin;

create or replace function app.teacher_has_subject(
  org_id uuid,
  target_subject_id uuid,
  actor_uid uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = app, public, auth
as $$
  select target_subject_id is not null and exists (
    select 1
    from app.memberships as m
    join app.teacher_assignments as ta
      on ta.organization_id = m.organization_id
     and ta.teacher_auth_uid = m.auth_uid
    where m.organization_id = org_id
      and m.auth_uid = actor_uid
      and m.role = 'teacher'::app.user_role
      and m.status = 'active'
      and ta.subject_id = target_subject_id
  );
$$;

create or replace function app.teacher_has_class(
  org_id uuid,
  target_class_id uuid,
  actor_uid uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = app, public, auth
as $$
  select target_class_id is not null and exists (
    select 1
    from app.memberships as m
    join app.teacher_assignments as ta
      on ta.organization_id = m.organization_id
     and ta.teacher_auth_uid = m.auth_uid
    where m.organization_id = org_id
      and m.auth_uid = actor_uid
      and m.role = 'teacher'::app.user_role
      and m.status = 'active'
      and ta.subject_id is not null
      and (
        ta.class_id = target_class_id
        or (
          ta.class_id is null
          and exists (
            select 1
            from app.enrollments as e
            where e.organization_id = org_id
              and e.class_id = target_class_id
              and e.subject_id = ta.subject_id
              and e.status = 'active'
              and coalesce(e.contract_status, 'not_required') <> 'pending'
          )
        )
      )
  );
$$;

create or replace function app.is_teacher_for_scope(
  org_id uuid,
  scope_class_id uuid,
  scope_subject_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = app, public, auth
as $$
  select scope_subject_id is not null and exists (
    select 1
    from app.memberships as m
    join app.teacher_assignments as ta
      on ta.organization_id = m.organization_id
     and ta.teacher_auth_uid = m.auth_uid
    where m.organization_id = org_id
      and m.auth_uid = auth.uid()
      and m.role = 'teacher'::app.user_role
      and m.status = 'active'
      and ta.subject_id = scope_subject_id
      and (ta.class_id is null or ta.class_id = scope_class_id)
  );
$$;

create or replace function app.can_manage_quiz(target_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, public, auth
as $$
  with quiz_scope as (
    select q.id, q.organization_id, q.subject_id
    from app.quizzes as q
    where q.id = target_quiz_id
  ),
  effective_subjects as (
    select q.subject_id
    from quiz_scope as q
    where q.subject_id is not null

    union

    select qs.subject_id
    from app.quiz_subjects as qs
    join quiz_scope as q on q.id = qs.quiz_id
    where qs.status = 'active'

    union

    select qq.subject_id
    from app.quiz_questions as qq
    join quiz_scope as q on q.id = qq.quiz_id
    where qq.subject_id is not null
      and coalesce(qq.review_status, 'review') <> 'rejected'
  )
  select exists (
    select 1
    from quiz_scope as q
    where app.has_role(
      q.organization_id,
      array['admin','coordinator']::app.user_role[]
    )
    or (
      app.has_role(q.organization_id, array['teacher']::app.user_role[])
      and exists (select 1 from effective_subjects)
      and not exists (
        select 1
        from effective_subjects as es
        where not app.teacher_has_subject(q.organization_id, es.subject_id)
      )
    )
  );
$$;

create or replace function app.teacher_can_read_quiz(target_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, public, auth
as $$
  select exists (
    select 1
    from app.quizzes as q
    where q.id = target_quiz_id
      and app.has_role(q.organization_id, array['teacher']::app.user_role[])
      and (
        app.teacher_has_subject(q.organization_id, q.subject_id)
        or exists (
          select 1
          from app.quiz_subjects as qs
          where qs.quiz_id = q.id
            and qs.status = 'active'
            and app.teacher_has_subject(q.organization_id, qs.subject_id)
        )
        or exists (
          select 1
          from app.quiz_questions as qq
          where qq.quiz_id = q.id
            and coalesce(qq.review_status, 'review') <> 'rejected'
            and app.teacher_has_subject(q.organization_id, qq.subject_id)
        )
      )
  );
$$;

create or replace function app.can_read_quiz(target_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, public, auth
as $$
  select exists (
    select 1
    from app.quizzes as q
    where q.id = target_quiz_id
      and (
        app.has_role(
          q.organization_id,
          array['admin','coordinator']::app.user_role[]
        )
        or app.teacher_can_read_quiz(q.id)
        or (
          q.quiz_kind = 'assessment'
          and q.status = 'published'
          and (q.release_at is null or q.release_at <= now())
          and (q.due_at is null or q.due_at >= now())
          and exists (
            select 1
            from app.student_profiles as sp
            where sp.auth_uid = auth.uid()
              and sp.organization_id = q.organization_id
              and sp.status = 'active'
              and exists (
                select 1
                from app.enrollments as e
                where e.student_id = sp.id
                  and e.organization_id = q.organization_id
                  and e.status = 'active'
                  and coalesce(e.contract_status, 'not_required') <> 'pending'
                  and (
                    exists (
                      select 1
                      from app.quiz_classes as qc
                      where qc.quiz_id = q.id
                        and qc.class_id = e.class_id
                        and qc.status = 'active'
                    )
                    or exists (
                      select 1
                      from app.quiz_subjects as qs
                      where qs.quiz_id = q.id
                        and qs.subject_id = e.subject_id
                        and qs.status = 'active'
                    )
                  )
              )
          )
        )
      )
  );
$$;

create or replace function app.can_manage_question_scope(
  target_quiz_id uuid,
  target_subject_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = app, public, auth
as $$
  select exists (
    select 1
    from app.quizzes as q
    where q.id = target_quiz_id
      and (
        app.has_role(
          q.organization_id,
          array['admin','coordinator']::app.user_role[]
        )
        or (
          app.teacher_has_subject(q.organization_id, target_subject_id)
          and (
            q.subject_id = target_subject_id
            or exists (
              select 1
              from app.quiz_subjects as qs
              where qs.quiz_id = q.id
                and qs.subject_id = target_subject_id
                and qs.status = 'active'
            )
          )
        )
      )
  );
$$;

create or replace function app.can_manage_question(target_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, public, auth
as $$
  select exists (
    select 1
    from app.quiz_questions as qq
    where qq.id = target_question_id
      and app.can_manage_question_scope(qq.quiz_id, qq.subject_id)
  );
$$;

create or replace function app.can_read_question(target_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, public, auth
as $$
  select exists (
    select 1
    from app.quiz_questions as qq
    join app.quizzes as q on q.id = qq.quiz_id
    where qq.id = target_question_id
      and (
        app.has_role(
          q.organization_id,
          array['admin','coordinator']::app.user_role[]
        )
        or app.teacher_has_subject(q.organization_id, qq.subject_id)
        or (
          qq.review_status = 'approved'
          and app.can_read_quiz(q.id)
          and exists (
            select 1
            from app.student_profiles as sp
            where sp.organization_id = q.organization_id
              and sp.auth_uid = auth.uid()
              and sp.status = 'active'
          )
        )
      )
  );
$$;

create or replace function app.can_read_attempt(target_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, public, auth
as $$
  select exists (
    select 1
    from app.attempts as a
    where a.id = target_attempt_id
      and (
        app.is_student_owner(a.student_id)
        or app.has_role(
          a.organization_id,
          array['admin','coordinator']::app.user_role[]
        )
        or app.can_manage_quiz(a.quiz_id)
      )
  );
$$;

create or replace function app.can_read_attempt_answer(target_answer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app, public, auth
as $$
  select exists (
    select 1
    from app.attempt_answers as aa
    join app.attempts as a on a.id = aa.attempt_id
    join app.quiz_questions as qq on qq.id = aa.quiz_question_id
    where aa.id = target_answer_id
      and (
        app.is_student_owner(a.student_id)
        or app.has_role(
          a.organization_id,
          array['admin','coordinator']::app.user_role[]
        )
        or app.teacher_has_subject(a.organization_id, qq.subject_id)
      )
  );
$$;

-- Garante que todas as tabelas abaixo continuem protegidas mesmo em bases que
-- tiveram migrations antigas parcialmente aplicadas.
alter table app.student_profiles enable row level security;
alter table app.classes enable row level security;
alter table app.subjects enable row level security;
alter table app.quizzes enable row level security;
alter table app.quiz_subjects enable row level security;
alter table app.quiz_classes enable row level security;
alter table app.quiz_questions enable row level security;
alter table app.question_options enable row level security;
alter table app.question_answer_keys enable row level security;
alter table app.attempts enable row level security;
alter table app.attempt_answers enable row level security;
alter table app.content_sources enable row level security;
alter table app.ai_jobs enable row level security;

-- Perfis: professor só lê alunos com matrícula ativa na própria matéria.
drop policy if exists "student and staff can view profiles" on app.student_profiles;
drop policy if exists "student and scoped staff can view profiles" on app.student_profiles;
create policy "student and scoped staff can view profiles"
on app.student_profiles
for select
using (
  student_profiles.auth_uid = auth.uid()
  or app.has_role(
    student_profiles.organization_id,
    array['admin','coordinator']::app.user_role[]
  )
  or exists (
    select 1
    from app.enrollments as e
    where e.student_id = student_profiles.id
      and e.organization_id = student_profiles.organization_id
      and e.status = 'active'
      and coalesce(e.contract_status, 'not_required') <> 'pending'
      and app.teacher_has_subject(
        student_profiles.organization_id,
        e.subject_id
      )
  )
);

-- Turmas e matérias: professor só vê o próprio escopo.
drop policy if exists "members can view classes" on app.classes;
drop policy if exists "members can view scoped classes" on app.classes;
create policy "members can view scoped classes"
on app.classes
for select
using (
  app.has_role(
    classes.organization_id,
    array['admin','coordinator']::app.user_role[]
  )
  or app.teacher_has_class(classes.organization_id, classes.id)
  or exists (
    select 1
    from app.enrollments as e
    join app.student_profiles as sp on sp.id = e.student_id
    where e.organization_id = classes.organization_id
      and e.class_id = classes.id
      and e.status = 'active'
      and coalesce(e.contract_status, 'not_required') <> 'pending'
      and sp.auth_uid = auth.uid()
      and sp.status = 'active'
  )
);

drop policy if exists "members can view subjects" on app.subjects;
drop policy if exists "members can view scoped subjects" on app.subjects;
create policy "members can view scoped subjects"
on app.subjects
for select
using (
  app.has_role(
    subjects.organization_id,
    array['admin','coordinator']::app.user_role[]
  )
  or app.teacher_has_subject(subjects.organization_id, subjects.id)
  or exists (
    select 1
    from app.enrollments as e
    join app.student_profiles as sp on sp.id = e.student_id
    where e.organization_id = subjects.organization_id
      and e.subject_id = subjects.id
      and e.status = 'active'
      and coalesce(e.contract_status, 'not_required') <> 'pending'
      and sp.auth_uid = auth.uid()
      and sp.status = 'active'
  )
);

-- Simulados e seus vínculos.
drop policy if exists "users can view allowed quizzes" on app.quizzes;
create policy "users can view allowed quizzes"
on app.quizzes
for select
using (app.can_read_quiz(quizzes.id));

drop policy if exists "staff can manage quizzes" on app.quizzes;
create policy "staff can manage quizzes"
on app.quizzes
for all
using (app.can_manage_quiz(quizzes.id))
with check (
  app.has_role(
    quizzes.organization_id,
    array['admin','coordinator']::app.user_role[]
  )
  or app.teacher_has_subject(
    quizzes.organization_id,
    quizzes.subject_id
  )
);

drop policy if exists "members can view quiz subjects" on app.quiz_subjects;
drop policy if exists "members can view scoped quiz subjects" on app.quiz_subjects;
create policy "members can view scoped quiz subjects"
on app.quiz_subjects
for select
using (
  app.has_role(
    quiz_subjects.organization_id,
    array['admin','coordinator']::app.user_role[]
  )
  or app.teacher_has_subject(
    quiz_subjects.organization_id,
    quiz_subjects.subject_id
  )
  or (
    exists (
      select 1
      from app.student_profiles as sp
      where sp.auth_uid = auth.uid()
        and sp.organization_id = quiz_subjects.organization_id
        and sp.status = 'active'
    )
    and app.can_read_quiz(quiz_subjects.quiz_id)
  )
);

drop policy if exists "staff can manage quiz subjects" on app.quiz_subjects;
create policy "staff can manage quiz subjects"
on app.quiz_subjects
for all
using (app.can_manage_quiz(quiz_subjects.quiz_id))
with check (
  app.has_role(
    quiz_subjects.organization_id,
    array['admin','coordinator']::app.user_role[]
  )
  or (
    app.can_manage_quiz(quiz_subjects.quiz_id)
    and app.teacher_has_subject(
      quiz_subjects.organization_id,
      quiz_subjects.subject_id
    )
  )
);

drop policy if exists "members can view quiz classes" on app.quiz_classes;
drop policy if exists "members can view scoped quiz classes" on app.quiz_classes;
create policy "members can view scoped quiz classes"
on app.quiz_classes
for select
using (
  app.has_role(
    quiz_classes.organization_id,
    array['admin','coordinator']::app.user_role[]
  )
  or (
    app.teacher_can_read_quiz(quiz_classes.quiz_id)
    and app.teacher_has_class(
      quiz_classes.organization_id,
      quiz_classes.class_id
    )
  )
  or (
    exists (
      select 1
      from app.student_profiles as sp
      where sp.auth_uid = auth.uid()
        and sp.organization_id = quiz_classes.organization_id
        and sp.status = 'active'
    )
    and app.can_read_quiz(quiz_classes.quiz_id)
  )
);

drop policy if exists "staff can manage quiz classes" on app.quiz_classes;
create policy "staff can manage quiz classes"
on app.quiz_classes
for all
using (app.can_manage_quiz(quiz_classes.quiz_id))
with check (
  app.has_role(
    quiz_classes.organization_id,
    array['admin','coordinator']::app.user_role[]
  )
  or (
    app.can_manage_quiz(quiz_classes.quiz_id)
    and app.teacher_has_class(
      quiz_classes.organization_id,
      quiz_classes.class_id
    )
  )
);

-- Questões, alternativas e gabaritos por matéria da questão.
drop policy if exists "users can view allowed questions" on app.quiz_questions;
create policy "users can view allowed questions"
on app.quiz_questions
for select
using (app.can_read_question(quiz_questions.id));

drop policy if exists "staff can manage questions" on app.quiz_questions;
create policy "staff can manage questions"
on app.quiz_questions
for all
using (app.can_manage_question(quiz_questions.id))
with check (
  app.can_manage_question_scope(
    quiz_questions.quiz_id,
    quiz_questions.subject_id
  )
);

drop policy if exists "users can view allowed options" on app.question_options;
create policy "users can view allowed options"
on app.question_options
for select
using (app.can_read_question(question_options.quiz_question_id));

drop policy if exists "staff can manage options" on app.question_options;
create policy "staff can manage options"
on app.question_options
for all
using (app.can_manage_question(question_options.quiz_question_id))
with check (app.can_manage_question(question_options.quiz_question_id));

drop policy if exists "staff can view answer keys" on app.question_answer_keys;
create policy "staff can view answer keys"
on app.question_answer_keys
for select
using (app.can_manage_question(question_answer_keys.quiz_question_id));

drop policy if exists "staff can manage answer keys" on app.question_answer_keys;
create policy "staff can manage answer keys"
on app.question_answer_keys
for all
using (app.can_manage_question(question_answer_keys.quiz_question_id))
with check (
  app.can_manage_question(question_answer_keys.quiz_question_id)
);

-- A tentativa agregada de um simulado multidisciplinar não expõe resultados
-- de outras matérias. As respostas individuais continuam disponíveis somente
-- quando a questão pertence à matéria do professor.
drop policy if exists "users can view allowed attempts" on app.attempts;
create policy "users can view allowed attempts"
on app.attempts
for select
using (app.can_read_attempt(attempts.id));

drop policy if exists "users can view allowed attempt answers" on app.attempt_answers;
create policy "users can view allowed attempt answers"
on app.attempt_answers
for select
using (app.can_read_attempt_answer(attempt_answers.id));

-- Fontes não possuem subject_id; por isso o professor só acessa as próprias.
drop policy if exists "staff can manage content sources" on app.content_sources;
drop policy if exists "staff can manage scoped content sources" on app.content_sources;
create policy "staff can manage scoped content sources"
on app.content_sources
for all
using (
  app.has_role(
    content_sources.organization_id,
    array['admin','coordinator']::app.user_role[]
  )
  or (
    app.has_role(
      content_sources.organization_id,
      array['teacher']::app.user_role[]
    )
    and content_sources.created_by = auth.uid()
  )
)
with check (
  app.has_role(
    content_sources.organization_id,
    array['admin','coordinator']::app.user_role[]
  )
  or (
    app.has_role(
      content_sources.organization_id,
      array['teacher']::app.user_role[]
    )
    and content_sources.created_by = auth.uid()
  )
);

-- Jobs de IA são compartilhados entre os professores da mesma matéria.
drop policy if exists "staff can manage ai jobs" on app.ai_jobs;
drop policy if exists "staff can manage scoped ai jobs" on app.ai_jobs;
create policy "staff can manage scoped ai jobs"
on app.ai_jobs
for all
using (
  app.has_role(
    ai_jobs.organization_id,
    array['admin','coordinator']::app.user_role[]
  )
  or (
    app.has_role(
      ai_jobs.organization_id,
      array['teacher']::app.user_role[]
    )
    and app.teacher_has_subject(
      ai_jobs.organization_id,
      ai_jobs.subject_id
    )
  )
)
with check (
  app.has_role(
    ai_jobs.organization_id,
    array['admin','coordinator']::app.user_role[]
  )
  or (
    app.has_role(
      ai_jobs.organization_id,
      array['teacher']::app.user_role[]
    )
    and app.teacher_has_subject(
      ai_jobs.organization_id,
      ai_jobs.subject_id
    )
  )
);

revoke all on function app.teacher_has_subject(uuid, uuid, uuid) from public;
revoke all on function app.teacher_has_class(uuid, uuid, uuid) from public;
revoke all on function app.is_teacher_for_scope(uuid, uuid, uuid) from public;
revoke all on function app.can_manage_quiz(uuid) from public;
revoke all on function app.teacher_can_read_quiz(uuid) from public;
revoke all on function app.can_read_quiz(uuid) from public;
revoke all on function app.can_manage_question_scope(uuid, uuid) from public;
revoke all on function app.can_manage_question(uuid) from public;
revoke all on function app.can_read_question(uuid) from public;
revoke all on function app.can_read_attempt(uuid) from public;
revoke all on function app.can_read_attempt_answer(uuid) from public;

grant execute on function app.teacher_has_subject(uuid, uuid, uuid)
  to authenticated, service_role;
grant execute on function app.teacher_has_class(uuid, uuid, uuid)
  to authenticated, service_role;
grant execute on function app.is_teacher_for_scope(uuid, uuid, uuid)
  to authenticated, service_role;
grant execute on function app.can_manage_quiz(uuid)
  to authenticated, service_role;
grant execute on function app.teacher_can_read_quiz(uuid)
  to authenticated, service_role;
grant execute on function app.can_read_quiz(uuid)
  to authenticated, service_role;
grant execute on function app.can_manage_question_scope(uuid, uuid)
  to authenticated, service_role;
grant execute on function app.can_manage_question(uuid)
  to authenticated, service_role;
grant execute on function app.can_read_question(uuid)
  to authenticated, service_role;
grant execute on function app.can_read_attempt(uuid)
  to authenticated, service_role;
grant execute on function app.can_read_attempt_answer(uuid)
  to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
