import "server-only";
import { appSchema } from "@/server/supabase/admin";
import { cachedRows } from "@/server/cache/data-cache";
import { getManagementContext } from "@/server/data/context";
import { subjectCode, subjectColor } from "@/lib/subject";
import { normalizeCpf } from "@/lib/cpf";
import { hashCpf } from "@/server/security/cpf-hash";
import type {
  AiJobSummary,
  AuditSummary,
  ClassSummary,
  QuestionModel,
  QuizSummary,
  StudentSummary,
  SubjectSummary,
  RankingEntry,
  RankingFilters,
} from "@/lib/domain-types";

type AnyRow = Record<string, any>;

async function rows(
  table: string,
  select = "*",
  organizationId?: string,
): Promise<AnyRow[]> {
  return cachedRows(table, select, organizationId);
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return (
    Math.round(
      (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
    ) / 10
  );
}

function uniqueCount(values: Array<string | null | undefined>): number {
  return new Set(values.filter(Boolean)).size;
}

export async function getSubjects(): Promise<SubjectSummary[]> {
  const context = await getManagementContext();
  const { organizationId, role, allowedSubjectIds } = context;
  const [subjects, teacherAssignments, enrollments, quizzes, quizSubjects, questions, attempts] = await Promise.all([
    rows('subjects', 'id,name,status,code,color,logo_path,teacher_names,created_at', organizationId),
    rows('teacher_assignments', 'teacher_auth_uid,class_id,subject_id', organizationId),
    rows('enrollments', 'student_id,class_id,subject_id,status', organizationId),
    rows('quizzes', 'id,subject_id,status,quiz_kind', organizationId),
    rows('quiz_subjects', 'quiz_id,subject_id,status', organizationId),
    rows('quiz_questions', 'id,quiz_id,subject_id,source_question_id,review_status'),
    rows('attempts', 'id,quiz_id,score_normalized,status', organizationId)
  ]);

  const scoresBySubject = new Map<string, number[]>();
  if (role === 'teacher' && allowedSubjectIds.length) {
    const organizationQuizIds = new Set(quizzes.map((item) => item.id));
    const approvedQuestionSubject = new Map(
      questions
        .filter((item) =>
          organizationQuizIds.has(item.quiz_id) &&
          item.review_status === 'approved' &&
          allowedSubjectIds.includes(item.subject_id)
        )
        .map((item) => [item.id, item.subject_id] as const),
    );
    const attemptAnswers = await rowsByQuestionIds([...approvedQuestionSubject.keys()]);
    const subjectAttemptTotals = new Map<string, { subjectId: string; correct: number; total: number }>();
    for (const answer of attemptAnswers) {
      const subjectId = approvedQuestionSubject.get(answer.quiz_question_id);
      if (!subjectId) continue;
      const key = `${answer.attempt_id}:${subjectId}`;
      const totals = subjectAttemptTotals.get(key) || { subjectId, correct: 0, total: 0 };
      totals.total += 1;
      if (answer.is_correct === true) totals.correct += 1;
      subjectAttemptTotals.set(key, totals);
    }
    for (const totals of subjectAttemptTotals.values()) {
      const bucket = scoresBySubject.get(totals.subjectId) || [];
      bucket.push(totals.total ? (totals.correct / totals.total) * 100 : 0);
      scoresBySubject.set(totals.subjectId, bucket);
    }
  }

  const visibleSubjects = subjects.filter((subject) => subject.status !== 'archived' && (role !== 'teacher' || allowedSubjectIds.includes(subject.id)));
  return visibleSubjects.map((subject) => {
    const subjectEnrollments = enrollments.filter((item) => item.subject_id === subject.id && item.status === 'active');
    const subjectQuizIds = new Set([
      ...quizzes.filter((item) => item.quiz_kind === 'assessment' && item.subject_id === subject.id).map((item) => item.id),
      ...quizSubjects.filter((item) => item.status === 'active' && item.subject_id === subject.id).map((item) => item.quiz_id)
    ]);
    return {
      id: subject.id,
      name: subject.name,
      code: subjectCode(subject.name, subject.code),
      color: subjectColor(subject.name, subject.color),
      status: subject.status,
      logoPath: subject.logo_path ?? null,
      teacherNames: Array.isArray(subject.teacher_names) ? subject.teacher_names : [],
      teachers: Math.max(
        uniqueCount(teacherAssignments.filter((item) => item.subject_id === subject.id).map((item) => item.teacher_auth_uid)),
        Array.isArray(subject.teacher_names) ? subject.teacher_names.length : 0
      ),
      classes: uniqueCount(subjectEnrollments.map((item) => item.class_id)),
      students: uniqueCount(subjectEnrollments.map((item) => item.student_id)),
      quizzes: subjectQuizIds.size,
      questions: questions.filter((item) => !item.source_question_id && item.review_status !== 'rejected' && item.subject_id === subject.id).length,
      average: role === 'teacher'
        ? average(scoresBySubject.get(subject.id) || [])
        : average(
            attempts
              .filter((item) => item.status === 'submitted' && subjectQuizIds.has(item.quiz_id) && item.score_normalized !== null)
              .map((item) => Number(item.score_normalized)),
          )
    } satisfies SubjectSummary;
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export async function getClasses(): Promise<ClassSummary[]> {
  const context = await getManagementContext();
  const { organizationId, role, allowedClassIds, allowedSubjectIds } = context;
  const [classes, enrollments, quizzes, quizClasses, quizSubjects, questionRows, attempts] = await Promise.all([
    rows('classes', 'id,name,status,code,description,created_at', organizationId),
    rows('enrollments', 'student_id,class_id,subject_id,status,contract_status', organizationId),
    rows('quizzes', 'id,subject_id,status,quiz_kind', organizationId),
    rows('quiz_classes', 'class_id,quiz_id,status', organizationId),
    rows('quiz_subjects', 'quiz_id,subject_id,status', organizationId),
    rows('quiz_questions', 'id,quiz_id,subject_id,review_status'),
    rows('attempts', 'id,student_id,quiz_id,score_normalized,status', organizationId)
  ]);

  const activeEnrollments = enrollments.filter((item) =>
    item.status === 'active' &&
    item.contract_status !== 'pending' &&
    (role !== 'teacher' || allowedSubjectIds.includes(item.subject_id))
  );
  const assessmentQuizzes = quizzes.filter((item) => item.status !== 'archived' && item.quiz_kind === 'assessment');
  const subjectsByQuiz = new Map<string, Set<string>>();
  for (const quiz of assessmentQuizzes) subjectsByQuiz.set(quiz.id, new Set([quiz.subject_id].filter(Boolean)));
  for (const link of quizSubjects.filter((item) => item.status === 'active')) {
    const bucket = subjectsByQuiz.get(link.quiz_id);
    if (bucket) bucket.add(link.subject_id);
  }
  const visibleQuizIds = new Set(assessmentQuizzes
    .filter((quiz) => role !== 'teacher' || [...(subjectsByQuiz.get(quiz.id) || [])].some((id) => allowedSubjectIds.includes(id)))
    .map((quiz) => quiz.id));
  const questionsByQuiz = new Map<string, string[]>();
  for (const question of questionRows.filter((item) =>
    item.review_status === 'approved' &&
    visibleQuizIds.has(item.quiz_id) &&
    (role !== 'teacher' || allowedSubjectIds.includes(item.subject_id))
  )) {
    const bucket = questionsByQuiz.get(question.quiz_id) || [];
    bucket.push(question.id);
    questionsByQuiz.set(question.quiz_id, bucket);
  }

  let answerRows: AnyRow[] = [];
  if (role === 'teacher') {
    const questionIds = [...questionsByQuiz.values()].flat();
    if (questionIds.length) {
      const { data, error } = await appSchema().from('attempt_answers')
        .select('attempt_id,quiz_question_id,is_correct')
        .in('quiz_question_id', questionIds);
      if (error) throw new Error(`attempt_answers: ${error.message}`);
      answerRows = (data ?? []) as AnyRow[];
    }
  }
  const answersByAttempt = new Map<string, AnyRow[]>();
  for (const answer of answerRows) {
    const bucket = answersByAttempt.get(answer.attempt_id) || [];
    bucket.push(answer);
    answersByAttempt.set(answer.attempt_id, bucket);
  }

  return classes
    .filter((classRow) => classRow.status !== 'archived')
    .filter((classRow) => role !== 'teacher' || allowedClassIds.includes(classRow.id) || activeEnrollments.some((item) => item.class_id === classRow.id))
    .map((classRow) => {
      const classEnrollments = activeEnrollments.filter((item) => item.class_id === classRow.id);
      const studentIds = new Set(classEnrollments.map((item) => item.student_id));
      const classSubjectIds = new Set(classEnrollments.map((item) => item.subject_id));
      const directQuizIds = new Set(quizClasses
        .filter((item) => item.class_id === classRow.id && item.status === 'active' && visibleQuizIds.has(item.quiz_id))
        .map((item) => item.quiz_id));
      const quizIds = new Set([...visibleQuizIds].filter((quizId) =>
        directQuizIds.has(quizId) || [...(subjectsByQuiz.get(quizId) || [])].some((subjectId) => classSubjectIds.has(subjectId))
      ));
      const rawAttempts = attempts.filter((item) => item.status === 'submitted' && quizIds.has(item.quiz_id) && studentIds.has(item.student_id));
      type ScopedAttempt = {
        student_id: string;
        quiz_id: string;
        scopedScore: number | null;
        hasScopedAnswers: boolean;
      };

      const scopedAttempts: ScopedAttempt[] = role === 'teacher'
        ? rawAttempts
            .map((attempt): ScopedAttempt => {
              const scopedAnswers = answersByAttempt.get(attempt.id) || [];
              const correct = scopedAnswers.filter(
                (answer) => answer.is_correct === true,
              ).length;

              return {
                student_id: String(attempt.student_id),
                quiz_id: String(attempt.quiz_id),
                scopedScore: scopedAnswers.length
                  ? (correct / scopedAnswers.length) * 100
                  : null,
                hasScopedAnswers: scopedAnswers.length > 0,
              };
            })
            .filter((item) => item.hasScopedAnswers)
        : rawAttempts.map(
            (attempt): ScopedAttempt => ({
              student_id: String(attempt.student_id),
              quiz_id: String(attempt.quiz_id),
              scopedScore:
                attempt.score_normalized === null ||
                attempt.score_normalized === undefined
                  ? null
                  : Number(attempt.score_normalized),
              hasScopedAnswers: true,
            }),
          );
      const possible = Math.max(1, studentIds.size * Math.max(1, quizIds.size));
      return {
        id: classRow.id,
        name: classRow.name,
        code: classRow.code || `T-${String(classRow.id).slice(0, 5).toUpperCase()}`,
        description: classRow.description ?? null,
        status: classRow.status,
        students: studentIds.size,
        subjects: uniqueCount(classEnrollments.map((item) => item.subject_id)),
        quizzes: quizIds.size,
        participation: Math.min(100, Math.round((uniqueCount(scopedAttempts.map((item) => `${item.student_id}:${item.quiz_id}`)) / possible) * 100)),
        average: average(scopedAttempts.filter((item) => item.scopedScore !== null).map((item) => Number(item.scopedScore)))
      } satisfies ClassSummary;
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export async function getQuizzes(): Promise<QuizSummary[]> {
  const context = await getManagementContext();
  const { organizationId, role, allowedSubjectIds } = context;
  const [quizzes, subjects, questionRows, quizClasses, quizSubjects, classes, attempts, enrollments] = await Promise.all([
    rows('quizzes', 'id,subject_id,title,description,status,quiz_kind,duration_minutes,planned_question_count,settings,release_at,due_at,created_at,published_at', organizationId),
    rows('subjects', 'id,name,color', organizationId),
    rows('quiz_questions', 'id,quiz_id,subject_id,expected_time_seconds,review_status'),
    rows('quiz_classes', 'quiz_id,class_id,status', organizationId),
    rows('quiz_subjects', 'quiz_id,subject_id,status', organizationId),
    rows('classes', 'id,name', organizationId),
    rows('attempts', 'id,quiz_id,student_id,status,score_normalized', organizationId),
    rows('enrollments', 'class_id,subject_id,student_id,status,contract_status', organizationId)
  ]);
  const subjectMap = new Map(subjects.map((item) => [item.id, item]));
  const classMap = new Map(classes.map((item) => [item.id, item.name]));
  const assessmentQuizzes = quizzes.filter((quiz) => quiz.status !== 'archived' && quiz.quiz_kind === 'assessment');
  const actualSubjectsByQuiz = new Map<string, string[]>();
  for (const quiz of assessmentQuizzes) {
    const linked = quizSubjects.filter((item) => item.quiz_id === quiz.id && item.status === 'active').map((item) => item.subject_id);
    const questionSubjects = questionRows.filter((item) => item.quiz_id === quiz.id && item.review_status !== 'rejected').map((item) => item.subject_id).filter(Boolean);
    actualSubjectsByQuiz.set(quiz.id, [...new Set([...linked, ...questionSubjects, quiz.subject_id].filter(Boolean))]);
  }
  const visibleQuizzes = assessmentQuizzes.filter((quiz) =>
    role !== 'teacher' || (actualSubjectsByQuiz.get(quiz.id) || []).some((id) => allowedSubjectIds.includes(id))
  );
  const visibleQuizIdSet = new Set(visibleQuizzes.map((quiz) => quiz.id));
  const visibleQuestionIds = questionRows.filter((item) =>
    visibleQuizIdSet.has(item.quiz_id) &&
    item.review_status !== 'rejected' &&
    (role !== 'teacher' || allowedSubjectIds.includes(item.subject_id))
  ).map((item) => item.id);
  let answerRows: AnyRow[] = [];
  if (role === 'teacher' && visibleQuestionIds.length) {
    const { data, error } = await appSchema().from('attempt_answers')
      .select('attempt_id,quiz_question_id,is_correct')
      .in('quiz_question_id', visibleQuestionIds);
    if (error) throw new Error(`attempt_answers: ${error.message}`);
    answerRows = (data ?? []) as AnyRow[];
  }
  const answersByAttempt = new Map<string, AnyRow[]>();
  for (const answer of answerRows) {
    const bucket = answersByAttempt.get(answer.attempt_id) || [];
    bucket.push(answer);
    answersByAttempt.set(answer.attempt_id, bucket);
  }

  return visibleQuizzes
    .map((quiz) => {
      const allQuizQuestions = questionRows.filter((item) => item.quiz_id === quiz.id && item.review_status !== 'rejected');
      const quizQuestions = role === 'teacher' ? allQuizQuestions.filter((item) => allowedSubjectIds.includes(item.subject_id)) : allQuizQuestions;
      const classIds = [...new Set(quizClasses.filter((item) => item.quiz_id === quiz.id && item.status === 'active').map((item) => item.class_id))];
      const actualSubjectIds = actualSubjectsByQuiz.get(quiz.id) || [quiz.subject_id];
      const subjectIds = role === 'teacher' ? actualSubjectIds.filter((id) => allowedSubjectIds.includes(id)) : actualSubjectIds;
      const classNames = classIds.map((id) => classMap.get(id)).filter(Boolean) as string[];
      const subjectRows = subjectIds.map((id) => subjectMap.get(id)).filter(Boolean) as AnyRow[];
      const primarySubject = subjectMap.get(subjectIds[0] || quiz.subject_id) || subjectRows[0];
      const rawAttempts = attempts.filter((item) => item.quiz_id === quiz.id && item.status === 'submitted');
      type ScopedAttempt = {
        student_id: string;
        quiz_id: string;
        scopedScore: number | null;
        hasScopedAnswers: boolean;
      };

      const scopedAttempts: ScopedAttempt[] = role === 'teacher'
        ? rawAttempts
            .map((attempt): ScopedAttempt => {
              const scopedAnswers = answersByAttempt.get(attempt.id) || [];
              const correct = scopedAnswers.filter(
                (answer) => answer.is_correct === true,
              ).length;

              return {
                student_id: String(attempt.student_id),
                quiz_id: String(attempt.quiz_id),
                scopedScore: scopedAnswers.length
                  ? (correct / scopedAnswers.length) * 100
                  : null,
                hasScopedAnswers: scopedAnswers.length > 0,
              };
            })
            .filter((item) => item.hasScopedAnswers)
        : rawAttempts.map(
            (attempt): ScopedAttempt => ({
              student_id: String(attempt.student_id),
              quiz_id: String(attempt.quiz_id),
              scopedScore:
                attempt.score_normalized === null ||
                attempt.score_normalized === undefined
                  ? null
                  : Number(attempt.score_normalized),
              hasScopedAnswers: true,
            }),
          );
      const eligibleStudentIds = new Set(enrollments.filter((enrollment) =>
        enrollment.status === 'active' &&
        enrollment.contract_status !== 'pending' &&
        subjectIds.includes(enrollment.subject_id) &&
        (!classIds.length || classIds.includes(enrollment.class_id) || subjectIds.includes(enrollment.subject_id))
      ).map((item) => item.student_id));
      const settings = quiz.settings && typeof quiz.settings === 'object' ? quiz.settings : {};
      const computedDuration = Math.max(1, Math.ceil(quizQuestions.reduce((sum, item) => sum + Number(item.expected_time_seconds || 0), 0) / 60));
      const canEdit = role !== 'teacher' || (actualSubjectIds.length > 0 && actualSubjectIds.every((id) => allowedSubjectIds.includes(id)));
      return {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description ?? null,
        subjectId: subjectIds[0] || quiz.subject_id,
        subject: subjectRows.length > 1 ? `${primarySubject?.name || 'Multidisciplinar'} +${subjectRows.length - 1}` : primarySubject?.name || 'Sem matéria',
        subjectColor: subjectColor(primarySubject?.name, primarySubject?.color),
        subjectIds,
        subjectNames: subjectRows.map((item) => item.name),
        status: quiz.status,
        questionCount: quizQuestions.length,
        durationMinutes: Number(quiz.duration_minutes || computedDuration || 60),
        plannedQuestionCount: Number(quiz.planned_question_count || quizQuestions.length || 1),
        classId: classIds[0] ?? null,
        className: classNames.join(', ') || 'Não atribuído',
        classIds,
        classNames,
        releaseAt: quiz.release_at ?? null,
        dueAt: quiz.due_at ?? null,
        maxAttempts: Number(settings.maxAttempts || 1),
        showExplanation: settings.showExplanation !== false,
        showRanking: settings.showRanking !== false,
        allowReview: settings.allowReview !== false,
        shuffleQuestions: settings.shuffleQuestions === true,
        shuffleOptions: settings.shuffleOptions === true,
        attempts: scopedAttempts.length,
        participation: eligibleStudentIds.size ? Math.min(100, Math.round((uniqueCount(scopedAttempts.map((item) => item.student_id)) / eligibleStudentIds.size) * 100)) : 0,
        average: average(scopedAttempts.filter((item) => item.scopedScore !== null).map((item) => Number(item.scopedScore))),
        canEdit,
        canDelete: role !== 'teacher',
        createdAt: quiz.created_at
      } satisfies QuizSummary;
    })
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

async function loadQuestions(bankOnly: boolean): Promise<QuestionModel[]> {
  const context = await getManagementContext();
  const { organizationId, role, allowedSubjectIds } = context;
  const [quizzes, subjects, questionRows] = await Promise.all([
    rows('quizzes', 'id,organization_id,subject_id,title,status,quiz_kind', organizationId),
    rows('subjects', 'id,name,color', organizationId),
    rows('quiz_questions', 'id,quiz_id,subject_id,statement,topic,subtopic,difficulty,expected_time_seconds,position,review_status,source_ai_job_id,source_question_id,updated_at')
  ]);
  const quizMap = new Map(quizzes.map((item) => [item.id, item]));
  const subjectMap = new Map(subjects.map((item) => [item.id, item]));
  const filteredQuestions = questionRows.filter((item) => {
    const quiz = quizMap.get(item.quiz_id);
    if (!quiz || item.review_status === 'rejected') return false;
    if (bankOnly && quiz.quiz_kind !== 'question_bank') return false;
    if (!bankOnly && quiz.quiz_kind !== 'assessment') return false;
    if (role === 'teacher' && !allowedSubjectIds.includes(item.subject_id || quiz.subject_id)) return false;
    return true;
  });
  const ids = filteredQuestions.map((item) => item.id);
  let optionRows: AnyRow[] = [];
  let keyRows: AnyRow[] = [];
  if (ids.length) {
    const [optionsResponse, keyResponse] = await Promise.all([
      appSchema().from('question_options').select('id,quiz_question_id,label,option_text,position').in('quiz_question_id', ids).order('position'),
      appSchema().from('question_answer_keys').select('quiz_question_id,correct_option_id,explanation_correct,explanation_wrong').in('quiz_question_id', ids)
    ]);
    if (optionsResponse.error) throw new Error(`question_options: ${optionsResponse.error.message}`);
    if (keyResponse.error) throw new Error(`question_answer_keys: ${keyResponse.error.message}`);
    optionRows = (optionsResponse.data ?? []) as AnyRow[];
    keyRows = (keyResponse.data ?? []) as AnyRow[];
  }
  const keyMap = new Map(keyRows.map((item) => [item.quiz_question_id, item]));
  return filteredQuestions.map((question) => {
    const quiz = quizMap.get(question.quiz_id)!;
    const subject = subjectMap.get(question.subject_id || quiz.subject_id);
    const options = optionRows.filter((item) => item.quiz_question_id === question.id).sort((a, b) => Number(a.position) - Number(b.position)).map((item) => ({ id: item.id, label: item.label, text: item.option_text }));
    const key = keyMap.get(question.id);
    const correct = options.find((item) => item.id === key?.correct_option_id);
    return {
      id: question.id,
      quizId: question.quiz_id,
      quizTitle: quiz.title,
      subjectId: question.subject_id || quiz.subject_id,
      subject: subject?.name || 'Sem matéria',
      subjectColor: subjectColor(subject?.name, subject?.color),
      statement: question.statement,
      topic: question.topic || 'Sem tema',
      subtopic: question.subtopic || 'Sem subtema',
      difficulty: question.difficulty,
      expectedTimeSeconds: Number(question.expected_time_seconds || 120),
      position: Number(question.position || 0),
      reviewStatus: question.review_status || (quiz.status === 'published' ? 'approved' : 'review'),
      sourceAiJobId: question.source_ai_job_id ?? null,
      options,
      correctOptionId: key?.correct_option_id || '',
      correctLabel: (correct?.label || 'A') as QuestionModel['correctLabel'],
      explanationCorrect: key?.explanation_correct || '',
      explanationWrong: key?.explanation_wrong || '',
      updatedAt: question.updated_at ?? null
    } satisfies QuestionModel;
  }).sort((a, b) => (b.updatedAt ? +new Date(b.updatedAt) : 0) - (a.updatedAt ? +new Date(a.updatedAt) : 0));
}

export async function getQuestions(): Promise<QuestionModel[]> {
  return loadQuestions(false);
}

export async function getQuestionBank(): Promise<QuestionModel[]> {
  return loadQuestions(true);
}


export async function getStudents(searchTerm = ""): Promise<StudentSummary[]> {
  const context = await getManagementContext();
  const { organizationId, role, allowedSubjectIds } = context;
  const [profiles, registries, enrollments, registryEnrollments, classes, subjects, attempts] = await Promise.all([
    rows('student_profiles', 'id,registry_id,auth_uid,nickname,full_name,email,cpf_hash,cpf_last4,status,first_access_completed,created_at,updated_at', organizationId),
    rows('students_registry', 'id,full_name,email,cpf_hash,cpf_last4,status,created_at', organizationId),
    rows('enrollments', 'student_id,class_id,subject_id,status,contract_status', organizationId),
    rows('registry_enrollments', 'registry_id,class_id,subject_id,status', organizationId),
    rows('classes', 'id,name,status', organizationId),
    rows('subjects', 'id,name,status', organizationId),
    rows('attempts', 'student_id,started_at,status', organizationId),
  ]);
  const classMap = new Map(classes.filter((item) => item.status !== 'archived').map((item) => [item.id, item.name]));
  const subjectMap = new Map(subjects.filter((item) => item.status !== 'archived').map((item) => [item.id, item.name]));
  const visibleEnrollments = enrollments.filter((item) =>
    item.status === 'active' && item.contract_status !== 'pending' &&
    (role !== 'teacher' || allowedSubjectIds.includes(item.subject_id))
  );
  const visibleRegistryEnrollments = registryEnrollments.filter((item) =>
    item.status === 'active' && (role !== 'teacher' || allowedSubjectIds.includes(item.subject_id))
  );
  const visibleStudentIds = new Set(visibleEnrollments.map((item) => item.student_id));
  const visibleRegistryIds = new Set(visibleRegistryEnrollments.map((item) => item.registry_id));
  const visibleProfiles = role === 'teacher' ? profiles.filter((item) => visibleStudentIds.has(item.id)) : profiles;
  const claimedRegistryIds = new Set(visibleProfiles.map((profile) => profile.registry_id).filter(Boolean));
  const rawSearch = searchTerm.trim();
  const normalizedSearch = rawSearch.toLocaleLowerCase('pt-BR');
  const cpfDigits = normalizeCpf(rawSearch);
  const exactCpfHash = cpfDigits.length === 11 ? hashCpf(cpfDigits) : null;
  const matchesSearch = (row: AnyRow, registryOnly: boolean): boolean => {
    if (!normalizedSearch) return true;
    if (exactCpfHash && row.cpf_hash === exactCpfHash) return true;
    if (cpfDigits.length >= 2 && String(row.cpf_last4 || '').includes(cpfDigits.slice(-4))) return true;
    return [row.full_name, registryOnly ? '' : row.nickname, row.email]
      .filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(normalizedSearch);
  };
  const profileSummaries = visibleProfiles.filter((profile) => matchesSearch(profile, false)).map((profile) => {
    const profileEnrollments = visibleEnrollments.filter((item) => item.student_id === profile.id);
    const lastAccess = attempts.filter((item) => item.student_id === profile.id).map((item) => item.started_at).filter(Boolean).sort().at(-1) || null;
    return {
      id: profile.id, name: profile.full_name, nickname: profile.nickname, email: profile.email, cpfLast4: profile.cpf_last4,
      classNames: [...new Set(profileEnrollments.map((item) => classMap.get(item.class_id)).filter(Boolean))] as string[],
      subjects: [...new Set(profileEnrollments.map((item) => subjectMap.get(item.subject_id)).filter(Boolean))] as string[],
      status: profile.status, lastAccess, createdAt: profile.created_at, registryOnly: false,
      firstAccessCompleted: Boolean(profile.first_access_completed),
    } satisfies StudentSummary;
  });
  const registrySummaries = registries
    .filter((registry) => !claimedRegistryIds.has(registry.id))
    .filter((registry) => role !== 'teacher' || visibleRegistryIds.has(registry.id))
    .filter((registry) => matchesSearch(registry, true))
    .map((registry) => {
      const links = visibleRegistryEnrollments.filter((item) => item.registry_id === registry.id);
      return {
        id: registry.id, name: registry.full_name, nickname: 'aguardando-acesso', email: registry.email || 'E-mail não informado', cpfLast4: registry.cpf_last4,
        classNames: [...new Set(links.map((item) => classMap.get(item.class_id)).filter(Boolean))] as string[],
        subjects: [...new Set(links.map((item) => subjectMap.get(item.subject_id)).filter(Boolean))] as string[],
        status: registry.status === 'active' ? 'imported' : registry.status, lastAccess: null, createdAt: registry.created_at,
        registryOnly: true, firstAccessCompleted: false,
      } satisfies StudentSummary;
    });
  return [...profileSummaries, ...registrySummaries].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export async function getAiJobs(): Promise<AiJobSummary[]> {
  const context = await getManagementContext();
  const { organizationId, role, allowedSubjectIds } = context;
  const [jobs, sources, subjects, questionRows, memberships, profiles] = await Promise.all([
    rows(
      "ai_jobs",
      "id,content_source_id,quiz_id,target_quiz_id,subject_id,status,prompt_version,model_name,input_tokens,output_tokens,estimated_cost,pre_estimated_cost,duration_ms,requested_by,result_json,created_at",
      organizationId,
    ),
    rows("content_sources", "id,title", organizationId),
    rows("subjects", "id,name", organizationId),
    rows("quiz_questions", "id,quiz_id,source_ai_job_id"),
    rows("memberships", "auth_uid,role", organizationId),
    rows("student_profiles", "auth_uid,full_name", organizationId),
  ]);
  const sourceMap = new Map(sources.map((item) => [item.id, item.title]));
  const subjectMap = new Map(subjects.map((item) => [item.id, item.name]));
  const profileMap = new Map(
    profiles.map((item) => [item.auth_uid, item.full_name]),
  );
  const roleMap = new Map(
    memberships.map((item) => [item.auth_uid, item.role]),
  );

  return jobs
    .filter(
      (job) =>
        role !== "teacher" ||
        (job.subject_id && allowedSubjectIds.includes(job.subject_id)),
    )
    .map((job) => {
      const persistedCount = questionRows.filter(
        (item) =>
          item.source_ai_job_id === job.id ||
          (job.quiz_id && item.quiz_id === job.quiz_id),
      ).length;
      const generatedQuestions = Array.isArray(job.result_json?.questions)
        ? job.result_json.questions.length
        : 0;
      return {
        id: job.id,
        title: sourceMap.get(job.content_source_id) || "Fonte sem título",
        subject: subjectMap.get(job.subject_id) || "—",
        status: job.status,
        model: job.model_name,
        promptVersion: job.prompt_version,
        inputTokens:
          job.input_tokens === null ? null : Number(job.input_tokens),
        outputTokens:
          job.output_tokens === null ? null : Number(job.output_tokens),
        preEstimatedCostUsd:
          job.pre_estimated_cost === null ||
          job.pre_estimated_cost === undefined
            ? null
            : Number(job.pre_estimated_cost),
        actualCostUsd:
          job.estimated_cost === null ? null : Number(job.estimated_cost),
        durationMs:
          job.duration_ms === null || job.duration_ms === undefined
            ? null
            : Number(job.duration_ms),
        questionCount: persistedCount || generatedQuestions,
        requestedBy:
          profileMap.get(job.requested_by) ||
          roleMap.get(job.requested_by) ||
          String(job.requested_by).slice(0, 8),
        createdAt: job.created_at,
        quizId: job.quiz_id ?? null,
      } satisfies AiJobSummary;
    })
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export async function getAuditLogs(limit = 200): Promise<AuditSummary[]> {
  const context = await getManagementContext();
  const { organizationId } = context;
  const [logs, memberships, profiles] = await Promise.all([
    rows(
      "audit_logs",
      "id,actor_auth_uid,action,entity_name,entity_id,ip_address,metadata,created_at",
      organizationId,
    ),
    rows("memberships", "auth_uid,role", organizationId),
    rows("student_profiles", "auth_uid,full_name", organizationId),
  ]);
  const roleMap = new Map(
    memberships.map((item) => [item.auth_uid, item.role]),
  );
  const profileMap = new Map(
    profiles.map((item) => [item.auth_uid, item.full_name]),
  );
  return logs
    .filter((log) => context.role !== 'teacher' || log.actor_auth_uid === context.authUid)
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    .slice(0, limit)
    .map((log) => {
      const action = String(log.action);
      const severity: AuditSummary["severity"] =
        action.includes("failed") || action.includes("rejected")
          ? "warning"
          : action.includes("success") ||
              action.includes("approved") ||
              action.includes("completed")
            ? "success"
            : "info";
      const metadata =
        log.metadata && typeof log.metadata === "object" ? log.metadata : {};
      const detail = Object.keys(metadata).length
        ? JSON.stringify(metadata).slice(0, 260)
        : `${action} em ${log.entity_name}`;
      return {
        id: log.id,
        date: log.created_at,
        actor:
          profileMap.get(log.actor_auth_uid) ||
          (log.actor_auth_uid
            ? String(log.actor_auth_uid).slice(0, 8)
            : "Sistema"),
        role: roleMap.get(log.actor_auth_uid) || "sistema",
        action,
        entity: log.entity_name,
        detail,
        ip: log.ip_address
          ? String(log.ip_address).replace(/\.\d+$/, ".***")
          : "—",
        severity,
      };
    });
}

export async function getRankings(filters: RankingFilters = {}): Promise<RankingEntry[]> {
  const context = await getManagementContext();
  const organizationId = context.organizationId;
  const [attempts, profiles, quizzes, quizClasses, quizSubjects, enrollments, classes, subjects, questions] = await Promise.all([
    rows('attempts', 'id,student_id,quiz_id,status,score_normalized,correct_count,wrong_count,duration_seconds,submitted_at,started_at', organizationId),
    rows('student_profiles', 'id,nickname,status', organizationId),
    rows('quizzes', 'id,title,subject_id,status,quiz_kind', organizationId),
    rows('quiz_classes', 'quiz_id,class_id,status', organizationId),
    rows('quiz_subjects', 'quiz_id,subject_id,status', organizationId),
    rows('enrollments', 'student_id,class_id,subject_id,status,contract_status', organizationId),
    rows('classes', 'id,name,status', organizationId),
    rows('subjects', 'id,name,color,status', organizationId),
    (filters.subjectId || context.role === 'teacher') ? rows('quiz_questions', 'id,quiz_id,subject_id,review_status', undefined) : Promise.resolve([])
  ]);
  const profileMap = new Map(profiles.map((item) => [item.id, item]));
  const quizMap = new Map(quizzes.filter((item) => item.status !== 'archived' && item.quiz_kind === 'assessment').map((item) => [item.id, item]));
  const classMap = new Map(classes.map((item) => [item.id, item]));
  const subjectMap = new Map(subjects.map((item) => [item.id, item]));
  const linksByQuiz = new Map<string, { classIds: string[]; subjectIds: string[] }>();
  for (const quiz of quizMap.values()) linksByQuiz.set(quiz.id, { classIds: [], subjectIds: [] });
  for (const link of quizClasses.filter((item) => item.status === 'active')) linksByQuiz.get(link.quiz_id)?.classIds.push(link.class_id);
  for (const link of quizSubjects.filter((item) => item.status === 'active')) linksByQuiz.get(link.quiz_id)?.subjectIds.push(link.subject_id);
  const visibleQuizIds = new Set(
    [...quizMap.values()]
      .filter((quiz) => {
        if (context.role !== 'teacher') return true;
        const linkedSubjectIds = linksByQuiz.get(quiz.id)?.subjectIds || [];
        const effectiveSubjectIds = [...new Set([quiz.subject_id, ...linkedSubjectIds].filter(Boolean))];
        return effectiveSubjectIds.some((id) => context.allowedSubjectIds.includes(id));
      })
      .map((quiz) => quiz.id),
  );
  const activeEnrollments = enrollments.filter((item) =>
    item.status === 'active' &&
    item.contract_status !== 'pending' &&
    (context.role !== 'teacher' || context.allowedSubjectIds.includes(item.subject_id))
  );
  const classStudents = filters.classId ? new Set(activeEnrollments.filter((item) => item.class_id === filters.classId).map((item) => item.student_id)) : null;
  const selected = attempts.filter((attempt) => attempt.status === 'submitted' && visibleQuizIds.has(attempt.quiz_id) && (!filters.quizId || attempt.quiz_id === filters.quizId) && (!classStudents || classStudents.has(attempt.student_id)));

  let perAttempt: Array<Record<string, any>>;
  if (filters.subjectId && context.role === 'teacher' && !context.allowedSubjectIds.includes(filters.subjectId)) return [];
  const subjectScopeIds = filters.subjectId
    ? [filters.subjectId]
    : context.role === 'teacher'
      ? context.allowedSubjectIds
      : [];
  if (subjectScopeIds.length) {
    const questionIds = new Set(
      questions
        .filter(
          (item) =>
            subjectScopeIds.includes(item.subject_id) &&
            item.review_status === 'approved',
        )
        .map((item) => item.id),
    );
    const attemptIds = selected.map((item) => item.id);
    const answerRows = attemptIds.length ? await rowsByAttemptIds(attemptIds) : [];
    const singleSubjectId = subjectScopeIds.length === 1 ? subjectScopeIds[0] : '';
    const subjectLabel = filters.subjectId
      ? null
      : context.role === 'teacher'
        ? 'Minhas matérias'
        : null;
    perAttempt = selected
      .map((attempt) => {
        const subjectAnswers = answerRows.filter(
          (answer) =>
            answer.attempt_id === attempt.id &&
            questionIds.has(answer.quiz_question_id),
        );
        const correct = subjectAnswers.filter(
          (answer) => answer.is_correct === true,
        ).length;
        const wrong = subjectAnswers.length - correct;
        return {
          ...attempt,
          correct_count: correct,
          wrong_count: wrong,
          duration_seconds: attempt.duration_seconds,
          score_normalized: subjectAnswers.length
            ? (correct / subjectAnswers.length) * 100
            : 0,
          subject_id: singleSubjectId,
          subject_label: subjectLabel,
        };
      })
      .filter(
        (item) => Number(item.correct_count) + Number(item.wrong_count) > 0,
      );
  } else {
    perAttempt = selected.map((attempt) => ({
      ...attempt,
      subject_id: quizMap.get(attempt.quiz_id)?.subject_id,
    }));
  }

  if ((filters.mode || 'best') === 'all') {
    const output = perAttempt.map((row) => toRankingEntry(row, profileMap, quizMap, classMap, subjectMap, filters.classId || null));
    output.sort(compareOfficialRanking);
    return output.map((item, index) => ({ ...item, position: index + 1 }));
  }

  const bestPerStudentQuiz = new Map<string, Record<string, any>>();
  for (const row of perAttempt) {
    const key = `${row.student_id}:${row.quiz_id}`;
    const current = bestPerStudentQuiz.get(key);
    if (!current || compareAttemptOfficial(row, current) < 0) bestPerStudentQuiz.set(key, row);
  }
  const bestRows = [...bestPerStudentQuiz.values()];
  if (filters.quizId) {
    const output = bestRows.map((row) => toRankingEntry(row, profileMap, quizMap, classMap, subjectMap, filters.classId || null));
    output.sort(compareOfficialRanking);
    return output.map((item, index) => ({ ...item, position: index + 1 }));
  }

  const aggregate = new Map<string, Record<string, any>>();
  for (const row of bestRows) {
    const current = aggregate.get(row.student_id) || { id: row.student_id, student_id: row.student_id, quiz_id: '', correct_count: 0, wrong_count: 0, duration_seconds: 0, scoreSum: 0, scoreCount: 0, submitted_at: row.submitted_at, subject_id: filters.subjectId || row.subject_id, subject_label: row.subject_label };
    current.correct_count += Number(row.correct_count || 0);
    current.wrong_count += Number(row.wrong_count || 0);
    current.duration_seconds += Number(row.duration_seconds || 0);
    current.scoreSum += Number(row.score_normalized || 0);
    current.scoreCount += 1;
    if (+new Date(row.submitted_at || 0) < +new Date(current.submitted_at || 0)) current.submitted_at = row.submitted_at;
    aggregate.set(row.student_id, current);
  }
  const output = [...aggregate.values()].map((row) => {
    const profile = profileMap.get(row.student_id);
    const subject = filters.subjectId ? subjectMap.get(filters.subjectId) : null;
    const correct = Number(row.correct_count || 0); const wrong = Number(row.wrong_count || 0); const answered = correct + wrong;
    const subjectLabel = subject?.name || row.subject_label || 'Todas as matérias';
    return { id: `aggregate:${row.student_id}`, attemptId: '', studentId: row.student_id, quizId: '', quiz: filters.subjectId ? `Ranking de ${subject?.name || 'matéria'}` : 'Ranking geral', classId: filters.classId || null, className: filters.classId ? classMap.get(filters.classId)?.name || 'Turma' : 'Todas as turmas', subjectId: filters.subjectId || row.subject_id || '', subject: subjectLabel, subjectColor: subjectColor(subject?.name, subject?.color), nickname: profile?.nickname || 'Aluno', score: row.scoreCount ? row.scoreSum / row.scoreCount : 0, correct, wrong, answered, accuracy: answered ? Math.round(correct / answered * 1000) / 10 : 0, durationSeconds: Number(row.duration_seconds || 0), position: 0, submittedAt: row.submitted_at || null } satisfies RankingEntry;
  });
  output.sort(compareOfficialRanking);
  return output.map((item, index) => ({ ...item, position: index + 1 }));
}

async function rowsByAttemptIds(attemptIds: string[]): Promise<Array<Record<string, any>>> {
  const output: Array<Record<string, any>> = [];
  for (let index = 0; index < attemptIds.length; index += 200) {
    const chunk = attemptIds.slice(index, index + 200);
    const { data, error } = await appSchema()
      .from('attempt_answers')
      .select('attempt_id,quiz_question_id,is_correct,elapsed_seconds,points_awarded')
      .in('attempt_id', chunk);
    if (error) throw new Error(`attempt_answers: ${error.message}`);
    output.push(...(data ?? []));
  }
  return output;
}

async function rowsByQuestionIds(questionIds: string[]): Promise<Array<Record<string, any>>> {
  const output: Array<Record<string, any>> = [];
  for (let index = 0; index < questionIds.length; index += 200) {
    const chunk = questionIds.slice(index, index + 200);
    const { data, error } = await appSchema()
      .from('attempt_answers')
      .select('attempt_id,quiz_question_id,is_correct')
      .in('quiz_question_id', chunk);
    if (error) throw new Error(`attempt_answers: ${error.message}`);
    output.push(...(data ?? []));
  }
  return output;
}

function toRankingEntry(row: Record<string, any>, profileMap: Map<any, any>, quizMap: Map<any, any>, classMap: Map<any, any>, subjectMap: Map<any, any>, classId: string | null): RankingEntry {
  const quiz = quizMap.get(row.quiz_id); const profile = profileMap.get(row.student_id); const subject = subjectMap.get(row.subject_id || quiz?.subject_id); const correct = Number(row.correct_count || 0); const wrong = Number(row.wrong_count || 0); const answered = correct + wrong;
  return { id: row.id, attemptId: row.id, studentId: row.student_id, quizId: row.quiz_id, quiz: quiz?.title || 'Simulado', classId, className: classId ? classMap.get(classId)?.name || 'Turma' : 'Todas as turmas', subjectId: subject?.id || row.subject_id || '', subject: row.subject_label || subject?.name || 'Todas as matérias', subjectColor: subjectColor(subject?.name, subject?.color), nickname: profile?.nickname || 'Aluno', score: Number(row.score_normalized || 0), correct, wrong, answered, accuracy: answered ? Math.round(correct / answered * 1000) / 10 : 0, durationSeconds: Number(row.duration_seconds || 0), position: 0, submittedAt: row.submitted_at || row.started_at || null };
}

function compareAttemptOfficial(a: Record<string, any>, b: Record<string, any>): number {
  return Number(b.correct_count || 0) - Number(a.correct_count || 0) || Number(a.duration_seconds ?? Number.MAX_SAFE_INTEGER) - Number(b.duration_seconds ?? Number.MAX_SAFE_INTEGER) || Number(b.score_normalized || 0) - Number(a.score_normalized || 0) || +new Date(a.submitted_at || 0) - +new Date(b.submitted_at || 0);
}
function compareOfficialRanking(a: RankingEntry, b: RankingEntry): number {
  return b.correct - a.correct || a.durationSeconds - b.durationSeconds || b.score - a.score || +new Date(a.submittedAt || 0) - +new Date(b.submittedAt || 0);
}

export async function getAdminOverview() {
  const context = await getManagementContext();
  const [students, classes, subjects, quizzes, questions, aiJobs, auditLogs] = await Promise.all([
    getStudents(), getClasses(), getSubjects(), getQuizzes(), getQuestionBank(), getAiJobs(), getAuditLogs(8),
  ]);
  const { organizationId } = context;
  let submitted: AnyRow[];
  let pendingStudents = 0;
  if (context.role === 'teacher') {
    const rankings = await getRankings({ mode: 'all', sort: 'correct' });
    submitted = rankings.map((item) => ({
      id: item.attemptId || item.id,
      student_id: item.studentId,
      quiz_id: item.quizId,
      score_normalized: item.score,
      duration_seconds: item.durationSeconds,
      submitted_at: item.submittedAt,
      created_at: item.submittedAt,
    }));
  } else {
    const [attemptRows, pending] = await Promise.all([
      rows('attempts', 'id,student_id,quiz_id,status,score_normalized,created_at,submitted_at,duration_seconds', organizationId),
      rows('student_profiles', 'id,status', organizationId),
    ]);
    submitted = attemptRows.filter((item) => item.status === 'submitted');
    pendingStudents = pending.filter((item) => item.status === 'pending').length;
  }
  const now = Date.now();
  const weekMs = 7 * 86400000;
  const weekly = Array.from({ length: 8 }, (_, index) => {
    const start = now - (8 - index) * weekMs;
    const end = start + weekMs;
    return submitted.filter((item) => {
      const timestamp = +new Date(item.submitted_at || item.created_at || 0);
      return timestamp >= start && timestamp < end;
    }).length;
  });
  const scores = submitted.filter((item) => item.score_normalized !== null).map((item) => Number(item.score_normalized));
  const activeStudents = students.filter((item) => item.status === 'active').length;
  const publishedQuizzes = quizzes.filter((item) => item.status === 'published').length;
  const possible = Math.max(1, activeStudents * Math.max(1, publishedQuizzes));
  return {
    organizationId, role: context.role, students, classes, subjects, quizzes, questions, aiJobs, auditLogs,
    stats: {
      activeStudents,
      pendingStudents,
      publishedQuizzes,
      participation: Math.min(100, Math.round((uniqueCount(submitted.map((item) => `${item.student_id}:${item.quiz_id}`)) / possible) * 1000) / 10),
      attempts: submitted.length,
      average: average(scores),
      questions: questions.length,
      averageDurationSeconds: submitted.length ? Math.round(submitted.reduce((sum, item) => sum + Number(item.duration_seconds || 0), 0) / submitted.length) : 0,
    },
    weekly,
  };
}

export async function getPendingStudents() {
  const context = await getManagementContext();
  if (context.role === 'teacher') return [];
  const { organizationId } = context;
  const [profiles, registry, registryEnrollments, classes] = await Promise.all([
    rows(
      "student_profiles",
      "id,registry_id,nickname,full_name,email,cpf_last4,status,created_at",
      organizationId,
    ),
    rows(
      "students_registry",
      "id,full_name,email,cpf_last4,status",
      organizationId,
    ),
    rows("registry_enrollments", "registry_id,class_id,status", organizationId),
    rows("classes", "id,name", organizationId),
  ]);
  const registryMap = new Map(registry.map((item) => [item.id, item]));
  const classMap = new Map(classes.map((item) => [item.id, item.name]));
  return profiles
    .filter((profile) => profile.status === "pending")
    .map((profile) => {
      const registryRow = profile.registry_id
        ? registryMap.get(profile.registry_id)
        : null;
      const classNames = registryEnrollments
        .filter(
          (item) =>
            item.registry_id === profile.registry_id &&
            item.status === "active",
        )
        .map((item) => classMap.get(item.class_id))
        .filter(Boolean) as string[];
      return {
        id: profile.id,
        name: profile.full_name,
        email: profile.email,
        nickname: profile.nickname,
        cpfLast4: profile.cpf_last4,
        requestedAt: profile.created_at,
        registryMatch: Boolean(registryRow),
        requestedClass: classNames.join(", ") || "Sem turma vinculada",
      };
    })
    .sort((a, b) => +new Date(b.requestedAt) - +new Date(a.requestedAt));
}

export async function getSystemUsers() {
  const context = await getManagementContext();
  if (context.role === 'teacher') return [];
  const { organizationId } = context;
  const [memberships, teacherAssignments] = await Promise.all([
    rows("memberships", "id,auth_uid,role,status,created_at", organizationId),
    rows(
      "teacher_assignments",
      "teacher_auth_uid,class_id,subject_id",
      organizationId,
    ),
  ]);
  const { createSupabaseAdminClient } = await import("@/server/supabase/admin");
  const authClient = createSupabaseAdminClient();
  const { data, error } = await authClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) throw new Error(`auth.users: ${error.message}`);
  const authMap = new Map(data.users.map((user) => [user.id, user]));
  return memberships
    .map((membership) => {
      const user = authMap.get(membership.auth_uid);
      const metadata =
        user?.user_metadata && typeof user.user_metadata === "object"
          ? user.user_metadata
          : {};
      const assignments = teacherAssignments.filter(
        (item) => item.teacher_auth_uid === membership.auth_uid,
      );
      const scope =
        membership.role === "teacher"
          ? `${uniqueCount(assignments.map((item) => item.class_id))} turma(s) · ${uniqueCount(assignments.map((item) => item.subject_id))} matéria(s)`
          : membership.role === "admin"
            ? "Organização inteira"
            : "Gestão acadêmica";
      return {
        id: membership.id,
        authUid: membership.auth_uid,
        name: String(
          metadata.full_name ||
            metadata.name ||
            user?.email?.split("@")[0] ||
            "Usuário",
        ),
        email: user?.email || "—",
        role: membership.role,
        status: membership.status,
        scope,
        lastAccess: user?.last_sign_in_at || null,
        mfa: Boolean(user?.factors?.length),
        createdAt: membership.created_at,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function getStudentAdminDetail(studentId: string) {
  const { organizationId } = await getManagementContext();
  const { data: profileRow, error: profileError } = await appSchema()
    .from("student_profiles")
    .select(
      "id,organization_id,registry_id,auth_uid,nickname,full_name,email,cpf_last4,status,first_access_completed,approved_at,created_at,updated_at",
    )
    .eq("organization_id", organizationId)
    .eq("id", studentId)
    .maybeSingle();
  if (profileError) throw profileError;

  let registryOnly = false;
  let profile: AnyRow | null = profileRow as AnyRow | null;
  if (!profile) {
    const { data: registry, error: registryError } = await appSchema()
      .from("students_registry")
      .select(
        "id,organization_id,full_name,email,cpf_last4,status,created_at,updated_at",
      )
      .eq("organization_id", organizationId)
      .eq("id", studentId)
      .maybeSingle();
    if (registryError) throw registryError;
    if (!registry) return null;
    registryOnly = true;
    profile = {
      id: registry.id,
      organization_id: registry.organization_id,
      registry_id: registry.id,
      auth_uid: null,
      nickname: "aguardando-acesso",
      full_name: registry.full_name,
      email: registry.email || "E-mail não informado",
      cpf_last4: registry.cpf_last4,
      status: registry.status || "imported",
      first_access_completed: false,
      approved_at: null,
      created_at: registry.created_at,
      updated_at: registry.updated_at,
    };
  }

  const [
    enrollments,
    registryEnrollments,
    classes,
    subjects,
    attempts,
    quizzes,
    contractRequirements,
  ] = await Promise.all([
    rows(
      "enrollments",
      "id,student_id,class_id,subject_id,status,contract_status,source,manual_override,blocked_reason,created_at,updated_at",
      organizationId,
    ),
    rows(
      "registry_enrollments",
      "id,registry_id,class_id,subject_id,status,contract_status,source,manual_override,blocked_reason,created_at,updated_at",
      organizationId,
    ),
    rows("classes", "id,name,code,status", organizationId),
    rows(
      "subjects",
      "id,name,color,status,logo_path,teacher_names",
      organizationId,
    ),
    rows(
      "attempts",
      "id,student_id,quiz_id,status,started_at,submitted_at,duration_seconds,score_normalized,correct_count,wrong_count",
      organizationId,
    ),
    rows("quizzes", "id,title,subject_id,status", organizationId),
    rows(
      "student_contract_requirements",
      "id,registry_id,student_id,class_id,contract_name,status,source,external_url,detected_at,resolved_at",
      organizationId,
    ),
  ]);
  const classMap = new Map(classes.map((item) => [item.id, item]));
  const subjectMap = new Map(subjects.map((item) => [item.id, item]));
  const quizMap = new Map(quizzes.map((item) => [item.id, item]));
  const accessRows = registryOnly
    ? registryEnrollments.filter(
        (item) => item.registry_id === profile!.registry_id,
      )
    : enrollments.filter((item) => item.student_id === profile!.id);
  const studentAttempts: AnyRow[] = registryOnly
    ? []
    : attempts
        .filter((item) => item.student_id === profile!.id)
        .map((attempt): AnyRow => {
          const quiz = quizMap.get(attempt.quiz_id);
          const subject = subjectMap.get(quiz?.subject_id);
          return {
            ...attempt,
            quizTitle: quiz?.title || "Simulado removido",
            subject: subject?.name || "—",
            subjectColor: subjectColor(subject?.name, subject?.color),
          };
        })
        .sort((a, b) => +new Date(b.started_at) - +new Date(a.started_at));
  const submitted = studentAttempts.filter(
    (item) => item.status === "submitted",
  );
  const performance = subjects
    .map((subject) => {
      const quizIds = new Set(
        quizzes
          .filter((quiz) => quiz.subject_id === subject.id)
          .map((quiz) => quiz.id),
      );
      const subjectAttempts = submitted.filter((attempt) =>
        quizIds.has(attempt.quiz_id),
      );
      return {
        id: subject.id,
        name: subject.name,
        color: subjectColor(subject.name, subject.color),
        attempts: subjectAttempts.length,
        average: average(
          subjectAttempts.map((attempt) =>
            Number(attempt.score_normalized || 0),
          ),
        ),
        best: subjectAttempts.length
          ? Math.max(
              ...subjectAttempts.map((attempt) =>
                Number(attempt.score_normalized || 0),
              ),
            )
          : 0,
      };
    })
    .filter((item) => item.attempts > 0);

  return {
    profile,
    registryOnly,
    enrollments: accessRows.map((item) => ({
      id: String(item.id),
      student_id: registryOnly ? null : String(item.student_id),
      registry_id: registryOnly
        ? String(item.registry_id)
        : profile!.registry_id
          ? String(profile!.registry_id)
          : null,
      class_id: String(item.class_id),
      subject_id: String(item.subject_id),
      status: String(item.status || "inactive"),
      contract_status: String(item.contract_status || "not_required"),
      source: String(item.source || "import"),
      manual_override: Boolean(item.manual_override),
      blocked_reason: item.blocked_reason ? String(item.blocked_reason) : null,
      created_at: item.created_at ? String(item.created_at) : null,
      updated_at: item.updated_at ? String(item.updated_at) : null,
      className: classMap.get(item.class_id)?.name || "—",
      classCode: classMap.get(item.class_id)?.code || null,
      subjectName: subjectMap.get(item.subject_id)?.name || "—",
      subjectColor: subjectColor(
        subjectMap.get(item.subject_id)?.name,
        subjectMap.get(item.subject_id)?.color,
      ),
    })),
    attempts: studentAttempts,
    performance,
    pendingContracts: contractRequirements
      .filter(
        (item) =>
          (item.student_id === profile!.id ||
            item.registry_id === profile!.registry_id) &&
          item.status === "pending",
      )
      .map((item) => ({
        id: String(item.id),
        registry_id: String(item.registry_id),
        student_id: item.student_id ? String(item.student_id) : null,
        class_id: item.class_id ? String(item.class_id) : null,
        contract_name: String(item.contract_name || "Contrato pendente"),
        status: String(item.status),
        source: String(item.source || "import"),
        external_url: item.external_url ? String(item.external_url) : null,
        detected_at: item.detected_at ? String(item.detected_at) : null,
        resolved_at: item.resolved_at ? String(item.resolved_at) : null,
        className:
          classMap.get(item.class_id)?.name ||
          String(item.contract_name || "Contrato pendente"),
      })),
    availableClasses: classes
      .filter((item) => item.status === "active")
      .map((item) => ({ id: item.id, name: item.name })),
    availableSubjects: subjects
      .filter((item) => item.status === "active")
      .map((item) => ({
        id: item.id,
        name: item.name,
        color: subjectColor(item.name, item.color),
      })),
    stats: {
      attempts: submitted.length,
      average: average(
        submitted.map((item) => Number(item.score_normalized || 0)),
      ),
      best: submitted.length
        ? Math.max(
            ...submitted.map((item) => Number(item.score_normalized || 0)),
          )
        : 0,
      totalCorrect: submitted.reduce(
        (sum, item) => sum + Number(item.correct_count || 0),
        0,
      ),
    },
  };
}

export async function getClassAdminDetail(classId: string) {
  const { organizationId } = await getManagementContext();
  const { data: classRow, error } = await appSchema()
    .from("classes")
    .select("id,name,code,description,status,created_at")
    .eq("organization_id", organizationId)
    .eq("id", classId)
    .maybeSingle();
  if (error) throw error;
  if (!classRow) return null;
  const [enrollments, profiles, subjects, assignments, quizzes, attempts] =
    await Promise.all([
      rows(
        "enrollments",
        "student_id,class_id,subject_id,status",
        organizationId,
      ),
      rows(
        "student_profiles",
        "id,full_name,nickname,email,status",
        organizationId,
      ),
      rows("subjects", "id,name,color,status", organizationId),
      rows(
        "quiz_assignments",
        "quiz_id,class_id,subject_id,release_at,due_at,status",
        organizationId,
      ),
      rows(
        "quizzes",
        "id,title,subject_id,status,duration_minutes,created_at",
        organizationId,
      ),
      rows(
        "attempts",
        "student_id,quiz_id,status,score_normalized",
        organizationId,
      ),
    ]);
  const profileMap = new Map(profiles.map((item) => [item.id, item]));
  const subjectMap = new Map(subjects.map((item) => [item.id, item]));
  const quizMap = new Map(quizzes.map((item) => [item.id, item]));
  const classEnrollments = enrollments.filter(
    (item) => item.class_id === classId && item.status === "active",
  );
  const studentIds = new Set(classEnrollments.map((item) => item.student_id));
  const classAssignments = assignments.filter(
    (item) => item.class_id === classId && item.status === "active",
  );
  const quizIds = new Set(classAssignments.map((item) => item.quiz_id));
  const classAttempts = attempts.filter(
    (item) =>
      studentIds.has(item.student_id) &&
      quizIds.has(item.quiz_id) &&
      item.status === "submitted",
  );
  return {
    class: classRow,
    students: [...studentIds]
      .map((id): AnyRow => ({
        ...(profileMap.get(id) || {}),
        subjects: uniqueCount(
          classEnrollments
            .filter((item) => item.student_id === id)
            .map((item) => item.subject_id),
        ),
      }))
      .filter((item) => item.id),
    subjects: [...new Set(classEnrollments.map((item) => item.subject_id))].map(
      (id) => {
        const subject = subjectMap.get(id);
        return {
          id,
          name: subject?.name || "—",
          color: subjectColor(subject?.name, subject?.color),
          students: uniqueCount(
            classEnrollments
              .filter((item) => item.subject_id === id)
              .map((item) => item.student_id),
          ),
        };
      },
    ),
    quizzes: classAssignments
      .map((assignment): AnyRow => {
        const quiz = quizMap.get(assignment.quiz_id);
        const quizAttempts = classAttempts.filter(
          (item) => item.quiz_id === assignment.quiz_id,
        );
        return {
          ...quiz,
          assignment,
          subject: subjectMap.get(assignment.subject_id)?.name || "—",
          subjectColor: subjectColor(
            subjectMap.get(assignment.subject_id)?.name,
            subjectMap.get(assignment.subject_id)?.color,
          ),
          attempts: quizAttempts.length,
          average: average(
            quizAttempts.map((item) => Number(item.score_normalized || 0)),
          ),
        };
      })
      .filter((item) => item.id),
    stats: {
      students: studentIds.size,
      subjects: uniqueCount(classEnrollments.map((item) => item.subject_id)),
      quizzes: quizIds.size,
      participation:
        studentIds.size && quizIds.size
          ? Math.min(
              100,
              Math.round(
                (classAttempts.length / (studentIds.size * quizIds.size)) * 100,
              ),
            )
          : 0,
      average: average(
        classAttempts.map((item) => Number(item.score_normalized || 0)),
      ),
    },
  };
}

export type ReportFilters = {
  classId?: string;
  quizId?: string;
  subjectId?: string;
};

export async function getReportsData(filters: ReportFilters = {}) {
  const context = await getManagementContext();
  const { organizationId } = context;
  const [
    classes,
    subjects,
    quizzes,
    rankings,
    attempts,
    quizClasses,
    quizSubjects,
    enrollments,
    questionRows,
    answers,
  ] = await Promise.all([
    getClasses(),
    getSubjects(),
    getQuizzes(),
    getRankings({ ...filters, mode: "all", sort: "correct" }),
    rows(
      "attempts",
      "id,student_id,quiz_id,status,score_normalized,correct_count,wrong_count,duration_seconds,submitted_at,started_at",
      organizationId,
    ),
    rows("quiz_classes", "quiz_id,class_id,status", organizationId),
    rows("quiz_subjects", "quiz_id,subject_id,status", organizationId),
    rows(
      "enrollments",
      "student_id,class_id,subject_id,status,contract_status",
      organizationId,
    ),
    rows(
      "quiz_questions",
      "id,quiz_id,subject_id,topic,review_status",
    ),
    rows("attempt_answers", "attempt_id,quiz_question_id,is_correct"),
  ]);

  const effectiveSubjectIds = filters.subjectId
    ? [filters.subjectId]
    : context.role === 'teacher'
      ? context.allowedSubjectIds
      : [];
  if (context.role === 'teacher' && filters.subjectId && !context.allowedSubjectIds.includes(filters.subjectId)) {
    return {
      overview: { stats: { participation: 0, attempts: 0, students: 0, average: 0, averageDurationSeconds: 0, questions: 0, totalCorrect: 0, totalWrong: 0, accuracy: 0 }, weekly: Array(8).fill(0) },
      classes: [], subjects: [], quizzes: [], rankings: [], options: { classes, subjects, quizzes }, topics: []
    };
  }
  const activeEnrollments = enrollments.filter(
    (item) => item.status === "active" && item.contract_status !== "pending" &&
      (context.role !== 'teacher' || context.allowedSubjectIds.includes(item.subject_id)),
  );
  const subjectMap = new Map(subjects.map((item) => [item.id, item]));
  const classLinksByQuiz = new Map<string, Set<string>>();
  const subjectLinksByQuiz = new Map<string, Set<string>>();
  for (const quiz of quizzes) {
    classLinksByQuiz.set(quiz.id, new Set(quiz.classIds));
    subjectLinksByQuiz.set(quiz.id, new Set(quiz.subjectIds));
  }
  for (const link of quizClasses.filter((item) => item.status === "active")) {
    if (!classLinksByQuiz.has(link.quiz_id)) classLinksByQuiz.set(link.quiz_id, new Set());
    classLinksByQuiz.get(link.quiz_id)?.add(link.class_id);
  }
  for (const link of quizSubjects.filter((item) =>
    item.status === "active" &&
    (context.role !== 'teacher' || context.allowedSubjectIds.includes(item.subject_id))
  )) {
    if (!subjectLinksByQuiz.has(link.quiz_id)) subjectLinksByQuiz.set(link.quiz_id, new Set());
    subjectLinksByQuiz.get(link.quiz_id)?.add(link.subject_id);
  }

  const enrollmentsByStudent = new Map<string, AnyRow[]>();
  for (const enrollment of activeEnrollments) {
    const bucket = enrollmentsByStudent.get(enrollment.student_id) || [];
    bucket.push(enrollment);
    enrollmentsByStudent.set(enrollment.student_id, bucket);
  }
  const isStudentEligible = (studentId: string, quizId: string) => {
    const studentEnrollments = enrollmentsByStudent.get(studentId) || [];
    const classIds = classLinksByQuiz.get(quizId) || new Set<string>();
    const subjectIds = subjectLinksByQuiz.get(quizId) || new Set<string>();
    return studentEnrollments.some(
      (enrollment) =>
        classIds.has(enrollment.class_id) ||
        subjectIds.has(enrollment.subject_id),
    );
  };

  const classStudentIds = filters.classId
    ? new Set(
        activeEnrollments
          .filter((item) => item.class_id === filters.classId)
          .map((item) => item.student_id),
      )
    : null;
  const classSubjectIds = filters.classId
    ? new Set(
        activeEnrollments
          .filter((item) => item.class_id === filters.classId)
          .map((item) => item.subject_id),
      )
    : null;

  const allowedQuizIds = new Set(
    quizzes
      .filter((quiz) => !filters.quizId || quiz.id === filters.quizId)
      .filter((quiz) =>
        !effectiveSubjectIds.length ||
        effectiveSubjectIds.some((subjectId) =>
          (subjectLinksByQuiz.get(quiz.id) || new Set()).has(subjectId)
        )
      )
      .filter((quiz) => {
        if (!filters.classId) return true;
        const directClass = (classLinksByQuiz.get(quiz.id) || new Set()).has(
          filters.classId,
        );
        const subjectMatch = [...(subjectLinksByQuiz.get(quiz.id) || new Set())]
          .some((subjectId) => classSubjectIds?.has(subjectId));
        return directClass || subjectMatch;
      })
      .map((quiz) => quiz.id),
  );

  const filteredAttempts = attempts.filter(
    (attempt) =>
      attempt.status === "submitted" &&
      allowedQuizIds.has(attempt.quiz_id) &&
      (!classStudentIds || classStudentIds.has(attempt.student_id)),
  );
  const attemptIds = new Set(filteredAttempts.map((item) => item.id));
  const filteredQuestions = questionRows.filter(
    (question) =>
      allowedQuizIds.has(question.quiz_id) &&
      question.review_status === "approved" &&
      (!effectiveSubjectIds.length || effectiveSubjectIds.includes(question.subject_id)),
  );
  const filteredQuestionIds = new Set(filteredQuestions.map((item) => item.id));
  const filteredAnswers = answers.filter(
    (answer) =>
      attemptIds.has(answer.attempt_id) &&
      filteredQuestionIds.has(answer.quiz_question_id),
  );
  if (context.role === 'teacher') {
    const scopedAttemptIds = new Set(filteredAnswers.map((answer) => answer.attempt_id));
    for (let index = filteredAttempts.length - 1; index >= 0; index -= 1) {
      if (!scopedAttemptIds.has(filteredAttempts[index].id)) filteredAttempts.splice(index, 1);
    }
    attemptIds.clear();
    filteredAttempts.forEach((item) => attemptIds.add(item.id));
  }
  const scopedScoreByAttempt = new Map<string, number>();
  for (const attempt of filteredAttempts) {
    const attemptAnswers = filteredAnswers.filter((answer) => answer.attempt_id === attempt.id);
    const correct = attemptAnswers.filter((answer) => answer.is_correct === true).length;
    if (attemptAnswers.length) scopedScoreByAttempt.set(attempt.id, (correct / attemptAnswers.length) * 100);
  }

  const useAnswerScope = effectiveSubjectIds.length > 0;
  const totalCorrect = useAnswerScope
    ? filteredAnswers.filter((item) => item.is_correct === true).length
    : filteredAttempts.reduce((sum, item) => sum + Number(item.correct_count || 0), 0);
  const totalWrong = useAnswerScope
    ? filteredAnswers.filter((item) => item.is_correct !== true).length
    : filteredAttempts.reduce((sum, item) => sum + Number(item.wrong_count || 0), 0);
  const answered = totalCorrect + totalWrong;
  const scores = useAnswerScope
    ? rankings.map((item) => Number(item.score || 0))
    : filteredAttempts.map((item) => Number(item.score_normalized || 0));

  const candidateStudentIds = classStudentIds
    ? [...classStudentIds]
    : [...enrollmentsByStudent.keys()];
  const eligiblePairs = new Set<string>();
  for (const quizId of allowedQuizIds) {
    for (const studentId of candidateStudentIds) {
      if (isStudentEligible(studentId, quizId)) {
        eligiblePairs.add(`${studentId}:${quizId}`);
      }
    }
  }
  const submittedPairs = new Set(
    filteredAttempts.map(
      (attempt) => `${attempt.student_id}:${attempt.quiz_id}`,
    ),
  );
  const participation = eligiblePairs.size
    ? Math.min(
        100,
        Math.round((submittedPairs.size / eligiblePairs.size) * 100),
      )
    : 0;

  const now = new Date();
  const weekly = Array.from({ length: 8 }, () => 0);
  for (const attempt of filteredAttempts) {
    const submittedAt = new Date(
      attempt.submitted_at || attempt.started_at || 0,
    );
    if (Number.isNaN(submittedAt.getTime())) continue;
    const daysAgo = Math.floor(
      (now.getTime() - submittedAt.getTime()) / 86_400_000,
    );
    const bucketFromCurrent = Math.floor(daysAgo / 7);
    if (bucketFromCurrent >= 0 && bucketFromCurrent < 8) {
      weekly[7 - bucketFromCurrent] += 1;
    }
  }

  const classPerformance = classes
    .filter((classRow) => !filters.classId || classRow.id === filters.classId)
    .map((classRow) => {
      const studentIds = new Set(
        activeEnrollments
          .filter((item) => item.class_id === classRow.id)
          .map((item) => item.student_id),
      );
      const quizIds = new Set(
        [...allowedQuizIds].filter((quizId) =>
          [...studentIds].some((studentId) => isStudentEligible(studentId, quizId)),
        ),
      );
      const scopedAttempts = filteredAttempts.filter(
        (item) => studentIds.has(item.student_id) && quizIds.has(item.quiz_id),
      );
      const possiblePairs = new Set<string>();
      for (const quizId of quizIds) {
        for (const studentId of studentIds) {
          if (isStudentEligible(studentId, quizId)) {
            possiblePairs.add(`${studentId}:${quizId}`);
          }
        }
      }
      const completedPairs = new Set(
        scopedAttempts.map((item) => `${item.student_id}:${item.quiz_id}`),
      );
      return {
        ...classRow,
        students: studentIds.size,
        quizzes: quizIds.size,
        attempts: scopedAttempts.length,
        participation: possiblePairs.size
          ? Math.min(
              100,
              Math.round((completedPairs.size / possiblePairs.size) * 100),
            )
          : 0,
        average: average(
          scopedAttempts.map((item) =>
            useAnswerScope
              ? Number(scopedScoreByAttempt.get(item.id) || 0)
              : Number(item.score_normalized || 0)
          ),
        ),
      };
    })
    .filter((item) => item.quizzes > 0 || Boolean(filters.classId));

  const answerByQuestion = new Map<string, AnyRow[]>();
  for (const answer of filteredAnswers) {
    const bucket = answerByQuestion.get(answer.quiz_question_id) || [];
    bucket.push(answer);
    answerByQuestion.set(answer.quiz_question_id, bucket);
  }

  const subjectPerformance = subjects
    .filter((subject) => !filters.subjectId || subject.id === filters.subjectId)
    .map((subject) => {
      const subjectQuizIds = new Set(
        [...allowedQuizIds].filter((quizId) =>
          (subjectLinksByQuiz.get(quizId) || new Set()).has(subject.id),
        ),
      );
      const subjectQuestionIds = new Set(
        questionRows
          .filter(
            (question) =>
              subjectQuizIds.has(question.quiz_id) &&
              question.subject_id === subject.id &&
              question.review_status === "approved",
          )
          .map((question) => question.id),
      );
      const subjectAnswers = answers.filter(
        (answer) =>
          attemptIds.has(answer.attempt_id) &&
          subjectQuestionIds.has(answer.quiz_question_id),
      );
      const correct = subjectAnswers.filter(
        (answer) => answer.is_correct === true,
      ).length;
      return {
        ...subject,
        quizzes: subjectQuizIds.size,
        attempts: new Set(subjectAnswers.map((answer) => answer.attempt_id)).size,
        average: subjectAnswers.length
          ? Math.round((correct / subjectAnswers.length) * 1000) / 10
          : 0,
      };
    })
    .filter((item) => item.quizzes > 0 || Boolean(filters.subjectId));

  const topicMap = new Map<
    string,
    {
      subject: string;
      color: string;
      questions: number;
      correct: number;
      answered: number;
    }
  >();
  for (const question of filteredQuestions) {
    const subject = subjectMap.get(question.subject_id);
    if (!subject) continue;
    const topic = question.topic || "Sem tema";
    const key = `${subject.id}:${topic}`;
    const item = topicMap.get(key) || {
      subject: subject.name,
      color: subject.color,
      questions: 0,
      correct: 0,
      answered: 0,
    };
    item.questions += 1;
    const questionAnswers = answerByQuestion.get(question.id) || [];
    item.answered += questionAnswers.length;
    item.correct += questionAnswers.filter(
      (answer) => answer.is_correct === true,
    ).length;
    topicMap.set(key, item);
  }

  return {
    overview: {
      stats: {
        participation,
        attempts: filteredAttempts.length,
        students: uniqueCount(filteredAttempts.map((item) => item.student_id)),
        average: average(scores),
        averageDurationSeconds: filteredAttempts.length
          ? Math.round(
              filteredAttempts.reduce(
                (sum, item) => sum + Number(item.duration_seconds || 0),
                0,
              ) / filteredAttempts.length,
            )
          : 0,
        questions: filteredQuestions.length,
        totalCorrect,
        totalWrong,
        accuracy: answered
          ? Math.round((totalCorrect / answered) * 1000) / 10
          : 0,
      },
      weekly,
    },
    classes: classPerformance,
    subjects: subjectPerformance,
    quizzes: quizzes.filter((quiz) => allowedQuizIds.has(quiz.id)),
    rankings,
    options: { classes, subjects, quizzes },
    topics: [...topicMap.entries()]
      .map(([key, item]) => ({
        key,
        ...item,
        accuracy: item.answered
          ? Math.round((item.correct / item.answered) * 1000) / 10
          : 0,
      }))
      .sort((a, b) => a.accuracy - b.accuracy),
  };
}

export async function getPasswordResetRequests() {
  const context = await getManagementContext();
  if (context.role === 'teacher') return [];
  const { data: requests, error } = await appSchema().from('password_reset_requests')
    .select('id,student_id,cpf_last4,status,created_at,reviewed_at,rejection_reason')
    .eq('organization_id', context.organizationId).eq('status', 'pending').order('created_at', { ascending: true });
  if (error) throw new Error(`password_reset_requests: ${error.message}`);
  const studentIds = (requests ?? []).map((item: any) => item.student_id);
  const { data: students } = studentIds.length ? await appSchema().from('student_profiles').select('id,full_name,email,nickname').in('id', studentIds) : { data: [] } as any;
  const studentMap = new Map((students ?? []).map((item: any) => [item.id, item]));
  return (requests ?? []).map((item: any) => { const student: any = studentMap.get(item.student_id); return { id: item.id, studentId: item.student_id, name: student?.full_name || 'Aluno', email: student?.email || '', nickname: student?.nickname || '', cpfLast4: item.cpf_last4, requestedAt: item.created_at }; });
}
