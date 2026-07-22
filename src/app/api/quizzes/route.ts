import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { authorizeManagement, canManageAllSubjects, canManageClassesForSubjects } from '@/server/auth/management';
import { appSchema } from '@/server/supabase/admin';
import { auditLog } from '@/server/audit/audit';
import { invalidatePlatformData } from '@/server/cache/data-cache';

const createQuizSchema = z.object({
  organizationId: z.string().uuid().optional(),
  subjectIds: z.array(z.string().uuid()).min(1).max(30).optional(),
  subjectId: z.string().uuid().optional(),
  classIds: z.array(z.string().uuid()).max(100).optional(),
  classId: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  durationMinutes: z.number().int().min(1).max(600).default(60),
  plannedQuestionCount: z.number().int().min(1).max(300).default(20),
  releaseAt: z.string().datetime().optional(),
  dueAt: z.string().datetime().optional(),
  settings: z.object({
    maxAttempts: z.number().int().min(1).max(10).default(1),
    showExplanation: z.boolean().default(true),
    showRanking: z.boolean().default(true),
    allowReview: z.boolean().default(true),
    shuffleQuestions: z.boolean().default(false),
    shuffleOptions: z.boolean().default(false)
  }).default({})
}).refine((value) => Boolean(value.subjectId || value.subjectIds?.length), { message: 'Selecione ao menos uma matéria.', path: ['subjectIds'] })
  .refine((value) => !value.releaseAt || !value.dueAt || new Date(value.dueAt) > new Date(value.releaseAt), { message: 'O prazo deve ser posterior à liberação.', path: ['dueAt'] });

export async function GET(request: Request) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;
  let query = appSchema().from('quizzes')
    .select('id,organization_id,subject_id,title,description,status,version,duration_minutes,planned_question_count,settings,published_at,release_at,due_at,created_at,quiz_kind')
    .eq('organization_id', auth.membership.organizationId)
    .eq('quiz_kind', 'assessment')
    .order('created_at', { ascending: false });
  if (auth.scope.role === 'teacher') {
    if (!auth.scope.allowedSubjectIds.length) return jsonOk([]);
    const [{ data: links, error: linkError }, { data: primary, error: primaryError }] = await Promise.all([
      appSchema().from('quiz_subjects')
        .select('quiz_id')
        .eq('organization_id', auth.membership.organizationId)
        .eq('status', 'active')
        .in('subject_id', auth.scope.allowedSubjectIds),
      appSchema().from('quizzes')
        .select('id')
        .eq('organization_id', auth.membership.organizationId)
        .eq('quiz_kind', 'assessment')
        .in('subject_id', auth.scope.allowedSubjectIds),
    ]);
    if (linkError || primaryError) return jsonError('INTERNAL_ERROR', linkError?.message || primaryError?.message || 'Falha ao filtrar simulados.', 500);
    const quizIds = [...new Set([...(links ?? []).map((item) => item.quiz_id), ...(primary ?? []).map((item) => item.id)])];
    if (!quizIds.length) return jsonOk([]);
    query = query.in('id', quizIds);
  }
  const { data, error } = await query;
  if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  return jsonOk(data ?? []);
}

export async function POST(request: Request) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;
  const parsed = createQuizSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Dados do simulado inválidos.', 400, parsed.error.flatten());
  const organizationId = auth.membership.organizationId;
  if (parsed.data.organizationId && parsed.data.organizationId !== organizationId) return jsonError('FORBIDDEN', 'Organização inválida.', 403);
  const subjectIds = [...new Set(parsed.data.subjectIds?.length ? parsed.data.subjectIds : [parsed.data.subjectId!])];
  const classIds = [...new Set(parsed.data.classIds ?? (parsed.data.classId ? [parsed.data.classId] : []))];
  if (!canManageAllSubjects(auth.scope, subjectIds)) return jsonError('FORBIDDEN', 'Você só pode criar simulados das matérias atribuídas a você.', 403);
  try {
    if (!(await canManageClassesForSubjects(auth.scope, classIds, subjectIds))) {
      return jsonError('FORBIDDEN', 'Uma ou mais turmas não pertencem às matérias atribuídas a você.', 403);
    }
  } catch (error) {
    return jsonError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Falha ao validar as turmas.', 500);
  }

  const [{ data: subjects, error: subjectError }, { data: classes, error: classError }] = await Promise.all([
    appSchema().from('subjects').select('id').eq('organization_id', organizationId).eq('status', 'active').in('id', subjectIds),
    classIds.length ? appSchema().from('classes').select('id').eq('organization_id', organizationId).eq('status', 'active').in('id', classIds) : Promise.resolve({ data: [], error: null } as any)
  ]);
  if (subjectError || classError) return jsonError('INTERNAL_ERROR', subjectError?.message || classError?.message || 'Falha ao validar o público.', 500);
  if ((subjects ?? []).length !== subjectIds.length) return jsonError('BAD_REQUEST', 'Uma ou mais matérias não existem ou estão inativas.', 400);
  if ((classes ?? []).length !== classIds.length) return jsonError('BAD_REQUEST', 'Uma ou mais turmas não existem ou estão inativas.', 400);

  const { data, error } = await appSchema().from('quizzes').insert({
    organization_id: organizationId,
    subject_id: subjectIds[0],
    title: parsed.data.title,
    description: parsed.data.description || null,
    duration_minutes: parsed.data.durationMinutes,
    planned_question_count: parsed.data.plannedQuestionCount,
    settings: parsed.data.settings,
    status: 'draft',
    quiz_kind: 'assessment',
    release_at: parsed.data.releaseAt || null,
    due_at: parsed.data.dueAt || null,
    created_by: auth.user.authUid
  }).select('id,title,status').single();
  if (error) return jsonError('INTERNAL_ERROR', `${error.message}. Confirme se a migration 013 foi aplicada.`, 500);

  const { error: scopeError } = await appSchema().rpc('set_quiz_scope', {
    p_quiz_id: data.id,
    p_subject_ids: subjectIds,
    p_class_ids: classIds,
    p_release_at: parsed.data.releaseAt || null,
    p_due_at: parsed.data.dueAt || null,
    p_actor_auth_uid: auth.user.authUid
  });
  if (scopeError) {
    await appSchema().from('quizzes').delete().eq('id', data.id);
    return jsonError('INTERNAL_ERROR', `O simulado não pôde ser associado ao público: ${scopeError.message}`, 500);
  }

  await auditLog({ organizationId, actorAuthUid: auth.user.authUid, action: 'quiz_created', entityName: 'quizzes', entityId: data.id, metadata: { title: data.title, subject_ids: subjectIds, class_ids: classIds } });
  invalidatePlatformData();
  return jsonOk(data, 201);
}
