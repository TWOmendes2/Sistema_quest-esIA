import 'server-only';
import { appSchema } from '@/server/supabase/admin';
import { cachedRows } from '@/server/cache/data-cache';
import { getStudentContext } from '@/server/data/context';
import { subjectColor } from '@/lib/subject';
import type { QuizSummary, StudentQuizQuestion } from '@/lib/domain-types';

type Row = Record<string, any>;

type StudentRankingFilters = { quizId?: string; subjectId?: string; classId?: string };

async function cachedData(table: string, select: string, organizationId?: string) {
  return { data: await cachedRows(table, select, organizationId), error: null };
}

export async function getStudentProfileData() {
  const { profile } = await getStudentContext();
  const { data: fullProfile, error } = await appSchema()
    .from('student_profiles')
    .select('id,organization_id,registry_id,auth_uid,nickname,full_name,email,cpf_last4,status,created_at')
    .eq('id', profile.id)
    .single();
  if (error) throw error;
  const [{ data: enrollments }, { data: classes }, { data: subjects }, { data: pendingContracts }] = await Promise.all([
    appSchema().from('enrollments').select('class_id,subject_id,status,contract_status,blocked_reason').eq('student_id', profile.id),
    cachedData('classes', 'id,name,status', profile.organization_id),
    cachedData('subjects', 'id,name,color,status', profile.organization_id),
    appSchema().from('student_contract_requirements').select('id,class_id,contract_name,status,external_url,detected_at').eq('organization_id', profile.organization_id).eq('student_id', profile.id).eq('status', 'pending')
  ]);
  const classMap = new Map((classes ?? []).map((item: any) => [item.id, item.name]));
  const subjectMap = new Map((subjects ?? []).map((item: any) => [item.id, item]));
  const active = (enrollments ?? []).filter((item: any) => item.status === 'active' && item.contract_status !== 'pending');
  return {
    ...fullProfile,
    classes: [...new Set(active.map((item: any) => classMap.get(item.class_id)).filter(Boolean))],
    pendingContracts: (pendingContracts ?? []).map((item: any) => ({ ...item, className: classMap.get(item.class_id) || item.contract_name })),
    blockedAccesses: (enrollments ?? []).filter((item: any) => item.status !== 'active' || item.contract_status === 'pending').map((item: any) => ({ ...item, className: classMap.get(item.class_id) || 'Turma' })),
    subjects: [...new Map<string, { id: string; name: string; color: string }>(active.flatMap((item: any) => {
      const subject: any = subjectMap.get(item.subject_id);
      return subject ? [[subject.id, { id: subject.id, name: subject.name, color: subjectColor(subject.name, subject.color) }] as const] : [];
    })).values()]
  };
}

async function getActiveEnrollmentScope(studentId: string, organizationId: string) {
  const { data, error } = await appSchema()
    .from('enrollments')
    .select('class_id,subject_id,status,contract_status')
    .eq('organization_id', organizationId)
    .eq('student_id', studentId)
    .eq('status', 'active')
.or('contract_status.is.null,contract_status.neq.pending');
  if (error) throw error;
  return {
    enrollments: data ?? [],
    classIds: new Set((data ?? []).map((item) => item.class_id)),
    subjectIds: new Set((data ?? []).map((item) => item.subject_id))
  };
}

export async function getStudentQuizzes(): Promise<QuizSummary[]> {
  const { profile } = await getStudentContext();
  const scope = await getActiveEnrollmentScope(profile.id, profile.organization_id);
  if (!scope.enrollments.length) return [];

  const [{ data: quizClasses }, { data: quizSubjects }, { data: subjects }, { data: classes }, { data: quizzes }, { data: questionRows }, { data: attempts }] = await Promise.all([
    cachedData('quiz_classes', 'quiz_id,class_id,status', profile.organization_id),
    cachedData('quiz_subjects', 'quiz_id,subject_id,status', profile.organization_id),
    cachedData('subjects', 'id,name,color', profile.organization_id),
    cachedData('classes', 'id,name', profile.organization_id),
    cachedData('quizzes', 'id,subject_id,title,description,status,quiz_kind,duration_minutes,planned_question_count,settings,release_at,due_at,created_at', profile.organization_id),
    cachedData('quiz_questions', 'id,quiz_id,subject_id,expected_time_seconds,review_status'),
    appSchema().from('attempts').select('id,quiz_id,status,score_normalized,created_at').eq('student_id', profile.id)
  ]);
  const subjectMap = new Map((subjects ?? []).map((item: any) => [item.id, item]));
  const classMap = new Map((classes ?? []).map((item: any) => [item.id, item.name]));
  const now = Date.now();

  return (quizzes ?? [])
    .filter((quiz: any) => quiz.status === 'published' && quiz.quiz_kind === 'assessment')
    .filter((quiz: any) => !quiz.release_at || +new Date(quiz.release_at) <= now)
    .filter((quiz: any) => !quiz.due_at || +new Date(quiz.due_at) >= now)
    .filter((quiz: any) => {
      const classAccess = (quizClasses ?? []).some((item: any) => item.quiz_id === quiz.id && item.status === 'active' && scope.classIds.has(item.class_id));
      const subjectAccess = (quizSubjects ?? []).some((item: any) => item.quiz_id === quiz.id && item.status === 'active' && scope.subjectIds.has(item.subject_id));
      return classAccess || subjectAccess;
    })
    .map((quiz: any) => {
      const qs = (questionRows ?? []).filter((item: any) => item.quiz_id === quiz.id && item.review_status === 'approved');
      const classIds = [...new Set((quizClasses ?? []).filter((item: any) => item.quiz_id === quiz.id && item.status === 'active').map((item: any) => item.class_id))];
      const subjectIds = [...new Set([
        ...(quizSubjects ?? []).filter((item: any) => item.quiz_id === quiz.id && item.status === 'active').map((item: any) => item.subject_id),
        ...qs.map((item: any) => item.subject_id).filter(Boolean),
        quiz.subject_id
      ])];
      const classNames = classIds.map((id) => classMap.get(id)).filter(Boolean) as string[];
      const subjectRows = subjectIds.map((id) => subjectMap.get(id)).filter(Boolean) as any[];
      const primary = subjectMap.get(quiz.subject_id) || subjectRows[0];
      const quizAttempts = (attempts ?? []).filter((item: any) => item.quiz_id === quiz.id);
      const submitted = quizAttempts.filter((item: any) => item.status === 'submitted');
      const best = submitted.length ? Math.max(...submitted.map((item: any) => Number(item.score_normalized || 0))) : 0;
      const progressAttempt = quizAttempts.find((item: any) => item.status === 'in_progress');
      const settings = quiz.settings && typeof quiz.settings === 'object' ? quiz.settings : {};
      return {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        subjectId: quiz.subject_id,
        subject: subjectRows.length > 1 ? `${primary?.name || 'Multidisciplinar'} +${subjectRows.length - 1}` : primary?.name || 'Sem matéria',
        subjectColor: subjectColor(primary?.name, primary?.color),
        subjectIds,
        subjectNames: subjectRows.map((item) => item.name),
        status: quiz.status,
        questionCount: qs.length,
        durationMinutes: Number(quiz.duration_minutes || Math.ceil(qs.reduce((sum: number, item: any) => sum + Number(item.expected_time_seconds || 0), 0) / 60) || 60),
        plannedQuestionCount: Number(quiz.planned_question_count || qs.length || 1),
        classId: classIds[0] || null,
        className: classNames.join(', ') || 'Todas as turmas elegíveis',
        classIds,
        classNames,
        releaseAt: quiz.release_at,
        dueAt: quiz.due_at,
        maxAttempts: Number(settings.maxAttempts || 1),
        showExplanation: settings.showExplanation !== false,
        showRanking: settings.showRanking !== false,
        allowReview: settings.allowReview !== false,
        shuffleQuestions: settings.shuffleQuestions === true,
        shuffleOptions: settings.shuffleOptions === true,
        attempts: submitted.length,
        participation: progressAttempt ? 50 : submitted.length ? 100 : 0,
        average: best,
        canEdit: false,
        canDelete: false,
        createdAt: quiz.created_at
      } satisfies QuizSummary;
    })
    .sort((a, b) => +(new Date(b.releaseAt || b.createdAt)) - +(new Date(a.releaseAt || a.createdAt)));
}

export async function getStudentQuiz(quizId: string): Promise<{ quiz: QuizSummary; questions: StudentQuizQuestion[] } | null> {
  const { profile } = await getStudentContext();
  const quizzes = await getStudentQuizzes();
  const quiz = quizzes.find((item) => item.id === quizId);
  if (!quiz) return null;
  const { data: questionRows, error } = await appSchema()
    .from('quiz_questions')
    .select('id,quiz_id,subject_id,statement,topic,subtopic,expected_time_seconds,position,review_status')
    .eq('quiz_id', quizId)
    .eq('review_status', 'approved')
    .order('position');
  if (error) throw error;
  const ids = (questionRows ?? []).map((item: any) => item.id);
  const [{ data: options, error: optionsError }, { data: subjects }] = await Promise.all([
    ids.length ? appSchema().from('question_options').select('id,quiz_question_id,label,option_text,position').in('quiz_question_id', ids).order('position') : Promise.resolve({ data: [], error: null } as any),
    cachedData('subjects', 'id,name,color', profile.organization_id)
  ]);
  if (optionsError) throw optionsError;
  const subjectMap = new Map((subjects ?? []).map((item: any) => [item.id, item]));
  const questions = (questionRows ?? []).map((item: any) => {
    const subject: any = subjectMap.get(item.subject_id);
    return {
      id: item.id,
      quizId,
      quizTitle: quiz.title,
      subjectId: item.subject_id,
      subject: subject?.name || quiz.subject,
      subjectColor: subjectColor(subject?.name, subject?.color || quiz.subjectColor),
      statement: item.statement,
      topic: item.topic || 'Sem tema',
      subtopic: item.subtopic || 'Sem subtema',
      expectedTimeSeconds: Number(item.expected_time_seconds),
      position: Number(item.position),
      options: (options ?? []).filter((option: any) => option.quiz_question_id === item.id).map((option: any) => ({ id: option.id, label: option.label, text: option.option_text }))
    } satisfies StudentQuizQuestion;
  });
  return { quiz, questions };
}

export async function getStudentAttempts() {
  const { profile } = await getStudentContext();
  const [{ data: attempts, error }, { data: quizzes }, { data: quizSubjects }, { data: subjects }] = await Promise.all([
    appSchema().from('attempts').select('id,quiz_id,status,started_at,submitted_at,duration_seconds,score_normalized,correct_count,wrong_count').eq('student_id', profile.id).order('started_at', { ascending: false }),
    cachedData('quizzes', 'id,title,subject_id', profile.organization_id),
    cachedData('quiz_subjects', 'quiz_id,subject_id,status', profile.organization_id),
    cachedData('subjects', 'id,name,color', profile.organization_id)
  ]);
  if (error) throw error;
  const quizMap = new Map((quizzes ?? []).map((item: any) => [item.id, item]));
  const subjectMap = new Map((subjects ?? []).map((item: any) => [item.id, item]));
  return (attempts ?? []).map((attempt: any) => {
    const quiz: any = quizMap.get(attempt.quiz_id);
    const ids = [...new Set((quizSubjects ?? []).filter((item: any) => item.quiz_id === attempt.quiz_id && item.status === 'active').map((item: any) => item.subject_id))];
    const subjectRows = ids.map((id) => subjectMap.get(id)).filter(Boolean) as any[];
    const primary: any = subjectMap.get(quiz?.subject_id) || subjectRows[0];
    return { ...attempt, quizTitle: quiz?.title || 'Simulado', subject: subjectRows.length > 1 ? 'Multidisciplinar' : primary?.name || '—', subjectColor: subjectColor(primary?.name, primary?.color) };
  });
}

export async function getStudentAttemptResult(attemptId: string) {
  const { profile } = await getStudentContext();
  const { data: attempt, error } = await appSchema()
    .from('attempts')
    .select('id,quiz_id,status,started_at,submitted_at,duration_seconds,score_raw,score_normalized,correct_count,wrong_count')
    .eq('id', attemptId).eq('student_id', profile.id).maybeSingle();
  if (error) throw error;
  if (!attempt) return null;
  const [{ data: quiz }, { data: questions }, { data: answers }, { data: subjects }] = await Promise.all([
    appSchema().from('quizzes').select('id,title,description,subject_id').eq('id', attempt.quiz_id).single(),
    appSchema().from('quiz_questions').select('id,subject_id,statement,topic,subtopic,difficulty,position,expected_time_seconds').eq('quiz_id', attempt.quiz_id).eq('review_status', 'approved').order('position'),
    appSchema().from('attempt_answers').select('quiz_question_id,selected_option_id,elapsed_seconds,is_correct,points_awarded').eq('attempt_id', attempt.id),
    cachedData('subjects', 'id,name,color', profile.organization_id)
  ]);
  const ids = (questions ?? []).map((item: any) => item.id);
  const [{ data: options }, { data: keys }] = await Promise.all([
    ids.length ? appSchema().from('question_options').select('id,quiz_question_id,label,option_text,position').in('quiz_question_id', ids).order('position') : Promise.resolve({ data: [] } as any),
    attempt.status === 'submitted' && ids.length ? appSchema().from('question_answer_keys').select('quiz_question_id,correct_option_id,explanation_correct,explanation_wrong').in('quiz_question_id', ids) : Promise.resolve({ data: [] } as any)
  ]);
  const quizRow = quiz as Row | null;
  if (!quizRow) return null;
  const subjectMap = new Map((subjects ?? []).map((item: any) => [item.id, item]));
  const primary: any = subjectMap.get(quizRow.subject_id);
  const answerMap = new Map<string, Row>((answers ?? []).map((item: any) => [String(item.quiz_question_id), item]));
  const keyMap = new Map<string, Row>((keys ?? []).map((item: any) => [String(item.quiz_question_id), item]));
  return {
    attempt: {
      id: String(attempt.id), status: String(attempt.status), started_at: String(attempt.started_at), submitted_at: attempt.submitted_at ? String(attempt.submitted_at) : null,
      duration_seconds: attempt.duration_seconds == null ? null : Number(attempt.duration_seconds), score_raw: attempt.score_raw == null ? null : Number(attempt.score_raw),
      score_normalized: attempt.score_normalized == null ? null : Number(attempt.score_normalized), correct_count: attempt.correct_count == null ? null : Number(attempt.correct_count), wrong_count: attempt.wrong_count == null ? null : Number(attempt.wrong_count)
    },
    quiz: { id: String(quizRow.id), title: String(quizRow.title || 'Simulado'), description: quizRow.description ? String(quizRow.description) : null, subject: primary?.name || 'Multidisciplinar', subjectColor: subjectColor(primary?.name, primary?.color) },
    questions: (questions ?? []).map((question: any) => {
      const answer = answerMap.get(String(question.id));
      const key = keyMap.get(String(question.id));
      const subject: any = subjectMap.get(question.subject_id);
      return {
        id: String(question.id), subject: subject?.name || '—', subjectColor: subjectColor(subject?.name, subject?.color), statement: String(question.statement || ''), topic: question.topic ? String(question.topic) : null,
        subtopic: question.subtopic ? String(question.subtopic) : null, difficulty: String(question.difficulty || 'medium'), position: Number(question.position || 0),
        options: (options ?? []).filter((item: any) => item.quiz_question_id === question.id).map((item: any) => ({ id: String(item.id), label: String(item.label), option_text: String(item.option_text || '') })),
        answer: answer ? { selected_option_id: answer.selected_option_id ? String(answer.selected_option_id) : null, elapsed_seconds: answer.elapsed_seconds == null ? null : Number(answer.elapsed_seconds), is_correct: answer.is_correct == null ? null : Boolean(answer.is_correct), points_awarded: answer.points_awarded == null ? null : Number(answer.points_awarded) } : null,
        key: key ? { correct_option_id: String(key.correct_option_id), explanation_correct: String(key.explanation_correct || ''), explanation_wrong: key.explanation_wrong ? String(key.explanation_wrong) : null } : null
      };
    })
  };
}

function rankingComparator(a: any, b: any) {
  return Number(b.correct_count || 0) - Number(a.correct_count || 0)
    || Number(a.duration_seconds ?? Number.MAX_SAFE_INTEGER) - Number(b.duration_seconds ?? Number.MAX_SAFE_INTEGER)
    || Number(b.score_normalized || 0) - Number(a.score_normalized || 0)
    || +new Date(a.submitted_at || 0) - +new Date(b.submitted_at || 0);
}

export async function getStudentRanking(filters: StudentRankingFilters = {}) {
  const { profile } = await getStudentContext();
  const scope = await getActiveEnrollmentScope(profile.id, profile.organization_id);
  const [{ data: quizzes }, { data: quizClasses }, { data: quizSubjects }, { data: attempts }, { data: profiles }, { data: subjects }, { data: classes }, { data: allEnrollments }] = await Promise.all([
    cachedData('quizzes', 'id,title,subject_id,status,quiz_kind', profile.organization_id),
    cachedData('quiz_classes', 'quiz_id,class_id,status', profile.organization_id),
    cachedData('quiz_subjects', 'quiz_id,subject_id,status', profile.organization_id),
    appSchema().from('attempts').select('id,student_id,quiz_id,status,score_normalized,correct_count,wrong_count,duration_seconds,submitted_at,started_at').eq('organization_id', profile.organization_id).eq('status', 'submitted'),
    cachedData('student_profiles', 'id,nickname,status', profile.organization_id),
    cachedData('subjects', 'id,name,color,status', profile.organization_id),
    cachedData('classes', 'id,name,status', profile.organization_id),
    cachedData('enrollments', 'student_id,class_id,subject_id,status,contract_status', profile.organization_id)
  ]);
  const allowedQuizIds = new Set((quizzes ?? []).filter((quiz: any) => quiz.status === 'published' && quiz.quiz_kind === 'assessment').filter((quiz: any) =>
    (quizClasses ?? []).some((item: any) => item.quiz_id === quiz.id && item.status === 'active' && scope.classIds.has(item.class_id))
    || (quizSubjects ?? []).some((item: any) => item.quiz_id === quiz.id && item.status === 'active' && scope.subjectIds.has(item.subject_id))
  ).map((quiz: any) => quiz.id));
  const quizMap = new Map((quizzes ?? []).map((item: any) => [item.id, item]));
  const profileMap = new Map((profiles ?? []).map((item: any) => [item.id, item]));
  const subjectMap = new Map((subjects ?? []).map((item: any) => [item.id, item]));
  const classMap = new Map((classes ?? []).map((item: any) => [item.id, item]));
  const activeEnrollments = (allEnrollments ?? []).filter((item: any) => item.status === 'active' && item.contract_status !== 'pending');
  if (filters.quizId && !allowedQuizIds.has(filters.quizId)) return [];
  if (filters.subjectId && !scope.subjectIds.has(filters.subjectId)) return [];
  if (filters.classId && !scope.classIds.has(filters.classId)) return [];
  let selectedAttempts = (attempts ?? []).filter((attempt: any) => allowedQuizIds.has(attempt.quiz_id));
  if (filters.quizId) selectedAttempts = selectedAttempts.filter((item: any) => item.quiz_id === filters.quizId);
  if (filters.classId) {
    const students = new Set(activeEnrollments.filter((item: any) => item.class_id === filters.classId).map((item: any) => item.student_id));
    selectedAttempts = selectedAttempts.filter((item: any) => students.has(item.student_id));
  }

  let perAttempt: any[];
  if (filters.subjectId) {
    const attemptIds = selectedAttempts.map((item: any) => item.id);
    const [{ data: subjectQuestions }, { data: answers }] = await Promise.all([
      appSchema().from('quiz_questions').select('id,quiz_id,subject_id').eq('subject_id', filters.subjectId).eq('review_status', 'approved'),
      attemptIds.length ? appSchema().from('attempt_answers').select('attempt_id,quiz_question_id,is_correct,elapsed_seconds,points_awarded').in('attempt_id', attemptIds) : Promise.resolve({ data: [] } as any)
    ]);
    const questionIds = new Set((subjectQuestions ?? []).map((item: any) => item.id));
    perAttempt = selectedAttempts.map((attempt: any) => {
      const subjectAnswers = (answers ?? []).filter((item: any) => item.attempt_id === attempt.id && questionIds.has(item.quiz_question_id));
      const correct = subjectAnswers.filter((item: any) => item.is_correct === true).length;
      const wrong = subjectAnswers.length - correct;
      return { ...attempt, correct_count: correct, wrong_count: wrong, duration_seconds: attempt.duration_seconds, score_normalized: subjectAnswers.length ? (correct / subjectAnswers.length) * 100 : 0, subject_id: filters.subjectId };
    }).filter((item: any) => item.correct_count + item.wrong_count > 0);
  } else {
    perAttempt = selectedAttempts.map((item: any) => ({ ...item, subject_id: quizMap.get(item.quiz_id)?.subject_id }));
  }

  const bestPerStudentQuiz = new Map<string, any>();
  for (const row of perAttempt) {
    const key = `${row.student_id}:${row.quiz_id}`;
    const current = bestPerStudentQuiz.get(key);
    if (!current || rankingComparator(row, current) < 0) bestPerStudentQuiz.set(key, row);
  }
  const bestRows = [...bestPerStudentQuiz.values()];
  const grouped = new Map<string, any>();
  for (const row of bestRows) {
    const quiz: any = quizMap.get(row.quiz_id);
    const key = row.student_id;
    const current = grouped.get(key) || { id: key, student_id: row.student_id, quiz_id: filters.quizId || null, subject_id: filters.subjectId || null, correct_count: 0, wrong_count: 0, duration_seconds: 0, score_total: 0, score_count: 0, submitted_at: row.submitted_at, quizTitles: [] as string[] };
    current.correct_count += Number(row.correct_count || 0);
    current.wrong_count += Number(row.wrong_count || 0);
    current.duration_seconds += Number(row.duration_seconds || 0);
    current.score_total += Number(row.score_normalized || 0);
    current.score_count += 1;
    current.quizTitles.push(quiz?.title || 'Simulado');
    if (+new Date(row.submitted_at || 0) < +new Date(current.submitted_at || 0)) current.submitted_at = row.submitted_at;
    grouped.set(key, current);
  }
  const subject: any = filters.subjectId ? subjectMap.get(filters.subjectId) : null;
  const classRow: any = filters.classId ? classMap.get(filters.classId) : null;
  const rows = [...grouped.values()].map((item: any) => ({
    ...item,
    nickname: profileMap.get(item.student_id)?.nickname || 'Aluno',
    score_normalized: item.score_count ? item.score_total / item.score_count : 0,
    quiz_title: filters.quizId ? quizMap.get(filters.quizId)?.title || 'Simulado' : item.quizTitles.length === 1 ? item.quizTitles[0] : 'Ranking geral',
    subject_name: subject?.name || (filters.subjectId ? 'Matéria' : 'Todas as matérias'),
    subject_color: subjectColor(subject?.name, subject?.color),
    class_name: classRow?.name || 'Todas as turmas'
  })).sort(rankingComparator).slice(0, 100).map((item: any, index: number) => ({ ...item, position: index + 1, isCurrent: item.student_id === profile.id }));
  return rows;
}

export async function getStudentDashboardData() {
  const [profile, quizzes, attempts, ranking] = await Promise.all([getStudentProfileData(), getStudentQuizzes(), getStudentAttempts(), getStudentRanking()]);
  const submitted = attempts.filter((item: any) => item.status === 'submitted');
  const averageScore = submitted.length ? Math.round(submitted.reduce((sum: number, item: any) => sum + Number(item.score_normalized || 0), 0) / submitted.length * 10) / 10 : 0;
  return { profile, quizzes, attempts, ranking, stats: { available: quizzes.filter((item) => !item.attempts).length, completed: submitted.length, average: averageScore, best: submitted.length ? Math.max(...submitted.map((item: any) => Number(item.score_normalized || 0))) : 0 } };
}

export async function getStudentPerformance() {
  const { profile } = await getStudentContext();
  const [{ data: attempts, error }, { data: subjects }, { data: questions }] = await Promise.all([
    appSchema().from('attempts').select('id,quiz_id,status,started_at,submitted_at,duration_seconds,score_normalized,correct_count,wrong_count').eq('student_id', profile.id).eq('status', 'submitted').order('submitted_at', { ascending: true }),
    cachedData('subjects', 'id,name,color', profile.organization_id),
    cachedData('quiz_questions', 'id,quiz_id,subject_id,topic,subtopic,difficulty')
  ]);
  if (error) throw error;
  const attemptIds = (attempts ?? []).map((item: any) => item.id);
  const { data: answers, error: answersError } = attemptIds.length ? await appSchema().from('attempt_answers').select('attempt_id,quiz_question_id,is_correct,elapsed_seconds').in('attempt_id', attemptIds) : { data: [], error: null } as any;
  if (answersError) throw answersError;
  const subjectMap = new Map((subjects ?? []).map((item: any) => [item.id, item]));
  const questionMap = new Map((questions ?? []).map((item: any) => [item.id, item]));
  const attemptMap = new Map((attempts ?? []).map((item: any) => [item.id, item]));
  const bySubject = new Map<string, { id: string; subject: string; color: string; answered: number; correct: number; scores: number[]; elapsed: number[] }>();
  const byTopic = new Map<string, { subject: string; topic: string; answered: number; correct: number; elapsed: number[] }>();
  for (const answer of answers ?? []) {
    const attempt: any = attemptMap.get((answer as any).attempt_id);
    const question: any = questionMap.get((answer as any).quiz_question_id);
    const subject: any = subjectMap.get(question?.subject_id);
    if (!attempt || !subject || !question) continue;
    const subjectItem = bySubject.get(subject.id) || { id: subject.id, subject: subject.name, color: subjectColor(subject.name, subject.color), answered: 0, correct: 0, scores: [] as number[], elapsed: [] as number[] };
    subjectItem.answered += 1; subjectItem.correct += (answer as any).is_correct === true ? 1 : 0; subjectItem.elapsed.push(Number((answer as any).elapsed_seconds || 0)); subjectItem.scores.push(Number(attempt.score_normalized || 0)); bySubject.set(subject.id, subjectItem);
    const topic = question.topic || 'Sem tema'; const topicKey = `${subject.id}:${topic}`; const topicItem = byTopic.get(topicKey) || { subject: subject.name, topic, answered: 0, correct: 0, elapsed: [] as number[] };
    topicItem.answered += 1; topicItem.correct += (answer as any).is_correct === true ? 1 : 0; topicItem.elapsed.push(Number((answer as any).elapsed_seconds || 0)); byTopic.set(topicKey, topicItem);
  }
  const submitted = (attempts ?? []) as any[];
  const scores = submitted.map((item) => Number(item.score_normalized || 0));
  const totalCorrect = submitted.reduce((sum, item) => sum + Number(item.correct_count || 0), 0);
  const totalWrong = submitted.reduce((sum, item) => sum + Number(item.wrong_count || 0), 0);
  const totalAnswered = totalCorrect + totalWrong;
  return {
    attempts: submitted,
    stats: { attempts: submitted.length, average: scores.length ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10 : 0, best: scores.length ? Math.max(...scores) : 0, totalCorrect, totalWrong, accuracy: totalAnswered ? Math.round((totalCorrect / totalAnswered) * 1000) / 10 : 0, averageQuestionSeconds: (answers ?? []).length ? Math.round((answers ?? []).reduce((sum: number, item: any) => sum + Number(item.elapsed_seconds || 0), 0) / (answers ?? []).length) : 0 },
    subjects: [...bySubject.values()].map((item) => ({ ...item, accuracy: item.answered ? Math.round((item.correct / item.answered) * 1000) / 10 : 0, average: item.scores.length ? Math.round((item.scores.reduce((sum, value) => sum + value, 0) / item.scores.length) * 10) / 10 : 0, averageSeconds: item.elapsed.length ? Math.round(item.elapsed.reduce((sum, value) => sum + value, 0) / item.elapsed.length) : 0 })).sort((a, b) => b.accuracy - a.accuracy),
    topics: [...byTopic.values()].map((item) => ({ ...item, accuracy: item.answered ? Math.round((item.correct / item.answered) * 1000) / 10 : 0, averageSeconds: item.elapsed.length ? Math.round(item.elapsed.reduce((sum, value) => sum + value, 0) / item.elapsed.length) : 0 })).sort((a, b) => a.accuracy - b.accuracy),
    trend: scores.slice(-12)
  };
}
