import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { getActiveStudentProfile, getAuthenticatedUser } from '@/server/auth/session';
import { appSchema } from '@/server/supabase/admin';

const bodySchema = z.object({ quizId: z.string().uuid() });

type QuizSettings = { maxAttempts?: unknown };

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('UNAUTHORIZED', 'Sessão inválida.', 401);

  const profile = await getActiveStudentProfile(user.authUid);
  if (!profile) return jsonError('FORBIDDEN', 'Perfil de aluno não está ativo.', 403);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Simulado inválido.', 400, parsed.error.flatten());

  const access = await getQuizAccess(parsed.data.quizId, profile.id, profile.organization_id);
  if (!access) return jsonError('FORBIDDEN', 'Simulado não liberado para este aluno.', 403);

  const { data: existing, error: existingError } = await appSchema()
    .from('attempts')
    .select('id,quiz_id,status,started_at')
    .eq('student_id', profile.id)
    .eq('quiz_id', parsed.data.quizId)
    .eq('status', 'in_progress')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) return jsonError('INTERNAL_ERROR', existingError.message, 500);
  if (existing) return jsonOk(existing);

  const { count: submittedCount, error: countError } = await appSchema()
    .from('attempts')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', profile.id)
    .eq('quiz_id', parsed.data.quizId)
    .eq('status', 'submitted');
  if (countError) return jsonError('INTERNAL_ERROR', countError.message, 500);
  if ((submittedCount ?? 0) >= access.maxAttempts) {
    return jsonError('CONFLICT', `O limite de ${access.maxAttempts} tentativa(s) deste simulado já foi atingido.`, 409);
  }

  const { count: approvedQuestions, error: questionError } = await appSchema()
    .from('quiz_questions')
    .select('id', { count: 'exact', head: true })
    .eq('quiz_id', parsed.data.quizId)
    .eq('review_status', 'approved');
  if (questionError) return jsonError('INTERNAL_ERROR', questionError.message, 500);
  if (!approvedQuestions) return jsonError('CONFLICT', 'Este simulado ainda não possui questões aprovadas.', 409);

  const { data, error } = await appSchema()
    .from('attempts')
    .insert({ organization_id: profile.organization_id, student_id: profile.id, quiz_id: parsed.data.quizId })
    .select('id,quiz_id,status,started_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: concurrentAttempt, error: concurrentError } = await appSchema()
        .from('attempts')
        .select('id,quiz_id,status,started_at')
        .eq('student_id', profile.id)
        .eq('quiz_id', parsed.data.quizId)
        .eq('status', 'in_progress')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!concurrentError && concurrentAttempt) return jsonOk(concurrentAttempt);
    }
    return jsonError('INTERNAL_ERROR', error.message, 500);
  }
  return jsonOk(data, 201);
}

async function getQuizAccess(quizId: string, studentId: string, organizationId: string): Promise<{ maxAttempts: number } | null> {
  const { data: quiz, error: quizError } = await appSchema()
    .from('quizzes')
    .select('id,organization_id,status,quiz_kind,settings,release_at,due_at')
    .eq('id', quizId)
    .eq('organization_id', organizationId)
    .eq('status', 'published')
    .eq('quiz_kind', 'assessment')
    .maybeSingle();
  if (quizError || !quiz) return null;

  const now = Date.now();
  if (quiz.release_at && new Date(quiz.release_at).getTime() > now) return null;
  if (quiz.due_at && new Date(quiz.due_at).getTime() < now) return null;

  const [{ data: quizClasses, error: classError }, { data: quizSubjects, error: subjectError }, { data: enrollments, error: enrollmentError }] = await Promise.all([
    appSchema().from('quiz_classes').select('class_id').eq('organization_id', organizationId).eq('quiz_id', quizId).eq('status', 'active'),
    appSchema().from('quiz_subjects').select('subject_id').eq('organization_id', organizationId).eq('quiz_id', quizId).eq('status', 'active'),
    appSchema().from('enrollments').select('class_id,subject_id').eq('organization_id', organizationId).eq('student_id', studentId).eq('status', 'active').or('contract_status.is.null,contract_status.neq.pending')
  ]);
  if (classError || subjectError || enrollmentError) return null;

  const enrolledClassIds = new Set((enrollments ?? []).map((item) => item.class_id));
  const enrolledSubjectIds = new Set((enrollments ?? []).map((item) => item.subject_id));
  const allowed = (quizClasses ?? []).some((item) => enrolledClassIds.has(item.class_id))
    || (quizSubjects ?? []).some((item) => enrolledSubjectIds.has(item.subject_id));
  if (!allowed) return null;

  const settings = (quiz.settings && typeof quiz.settings === 'object' ? quiz.settings : {}) as QuizSettings;
  const configuredMax = Number(settings.maxAttempts);
  const maxAttempts = Number.isInteger(configuredMax) && configuredMax >= 1 && configuredMax <= 10 ? configuredMax : 1;
  return { maxAttempts };
}
