import { z } from 'zod';
import { authorizeManagement, canManageAllSubjects, canManageClassesForSubjects } from '@/server/auth/management';
import { jsonError, jsonOk } from '@/lib/http';
import { appSchema } from '@/server/supabase/admin';
import { auditLog } from '@/server/audit/audit';
import { invalidatePlatformData } from '@/server/cache/data-cache';

const paramsSchema = z.object({ quizId: z.string().uuid() });
const patchSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(600).optional(),
  plannedQuestionCount: z.number().int().min(1).max(300).optional(),
  status: z.enum(['draft', 'review', 'published']).optional(),
  releaseAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  subjectIds: z.array(z.string().uuid()).min(1).max(30).optional(),
  classIds: z.array(z.string().uuid()).max(100).optional(),
  subjectId: z.string().uuid().optional(),
  classId: z.string().uuid().nullable().optional(),
  settings: z.record(z.unknown()).optional()
}).refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: Request, context: { params: Promise<{ quizId: string }> }) {
  const auth = await authorizeManagement(request);
  if (!auth.ok) return auth.response;
  const params = paramsSchema.safeParse(await context.params);
  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) return jsonError('BAD_REQUEST', 'Dados inválidos.', 400, body.success ? undefined : body.error.flatten());
  const organizationId = auth.membership.organizationId;
  const { data: current, error: currentError } = await appSchema().from('quizzes')
    .select('id,subject_id,status,settings,release_at,due_at,quiz_kind')
    .eq('id', params.data.quizId).eq('organization_id', organizationId).eq('quiz_kind', 'assessment').maybeSingle();
  if (currentError) return jsonError('INTERNAL_ERROR', currentError.message, 500);
  if (!current) return jsonError('NOT_FOUND', 'Simulado não encontrado.', 404);

  const [{ data: currentSubjects }, { data: currentClasses }] = await Promise.all([
    appSchema().from('quiz_subjects').select('subject_id').eq('quiz_id', current.id).eq('status', 'active'),
    appSchema().from('quiz_classes').select('class_id').eq('quiz_id', current.id).eq('status', 'active')
  ]);
  const existingSubjectIds = (currentSubjects ?? []).map((item) => item.subject_id);
  if (!canManageAllSubjects(auth.scope, existingSubjectIds.length ? existingSubjectIds : [current.subject_id])) return jsonError('FORBIDDEN', 'As configurações gerais deste simulado só podem ser alteradas por quem administra todas as matérias vinculadas.', 403);

  const subjectIds = [...new Set(body.data.subjectIds ?? (body.data.subjectId ? [body.data.subjectId] : (existingSubjectIds.length ? existingSubjectIds : [current.subject_id])))];
  const classIds = [...new Set(body.data.classIds ?? (body.data.classId !== undefined ? (body.data.classId ? [body.data.classId] : []) : (currentClasses ?? []).map((item) => item.class_id)))];
  const releaseAt = body.data.releaseAt === undefined ? current.release_at : body.data.releaseAt;
  const dueAt = body.data.dueAt === undefined ? current.due_at : body.data.dueAt;
  if (!canManageAllSubjects(auth.scope, subjectIds)) return jsonError('FORBIDDEN', 'Você não tem permissão para todas as matérias selecionadas.', 403);
  try {
    if (!(await canManageClassesForSubjects(auth.scope, classIds, subjectIds))) {
      return jsonError('FORBIDDEN', 'Uma ou mais turmas não pertencem às matérias atribuídas a você.', 403);
    }
  } catch (error) {
    return jsonError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Falha ao validar as turmas.', 500);
  }
  if (releaseAt && dueAt && new Date(dueAt) <= new Date(releaseAt)) return jsonError('BAD_REQUEST', 'O prazo final deve ser posterior à liberação.', 400);
  if (body.data.status === 'published' && auth.scope.role === 'teacher' && subjectIds.length > 1) return jsonError('FORBIDDEN', 'Um simulado multidisciplinar deve ser publicado por coordenador ou administrador.', 403);

  if (body.data.status && body.data.status !== 'published' && current.status === 'published') {
    const { count } = await appSchema().from('attempts').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('quiz_id', current.id).eq('status', 'submitted');
    if ((count ?? 0) > 0) return jsonError('CONFLICT', 'Este simulado já possui respostas e não pode voltar para rascunho.', 409);
  }
  if (body.data.status === 'published') {
    const [{ count: total }, { count: approved }] = await Promise.all([
      appSchema().from('quiz_questions').select('id', { count: 'exact', head: true }).eq('quiz_id', current.id),
      appSchema().from('quiz_questions').select('id', { count: 'exact', head: true }).eq('quiz_id', current.id).eq('review_status', 'approved')
    ]);
    if (!total) return jsonError('BAD_REQUEST', 'Cadastre ao menos uma questão antes de publicar.', 400);
    if (approved !== total) return jsonError('BAD_REQUEST', 'Todas as questões precisam estar aprovadas antes da publicação.', 400);
    if (!subjectIds.length && !classIds.length) return jsonError('BAD_REQUEST', 'Selecione ao menos uma turma ou matéria para o público.', 400);
    if (!releaseAt || !dueAt) return jsonError('BAD_REQUEST', 'Informe a liberação e o prazo final antes de publicar.', 400);
  }

  const patch: Record<string, unknown> = {};
  if (body.data.title !== undefined) patch.title = body.data.title;
  if (body.data.description !== undefined) patch.description = body.data.description;
  if (body.data.durationMinutes !== undefined) patch.duration_minutes = body.data.durationMinutes;
  if (body.data.plannedQuestionCount !== undefined) patch.planned_question_count = body.data.plannedQuestionCount;
  if (body.data.settings !== undefined) patch.settings = { ...(current.settings && typeof current.settings === 'object' ? current.settings : {}), ...body.data.settings };
  if (body.data.status !== undefined) {
    patch.status = body.data.status;
    patch.published_at = body.data.status === 'published' ? new Date().toISOString() : null;
    patch.published_by = body.data.status === 'published' ? auth.user.authUid : null;
  }
  if (Object.keys(patch).length) {
    const { error } = await appSchema().from('quizzes').update(patch).eq('id', current.id).eq('organization_id', organizationId);
    if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  }

  const scopeChanged = body.data.subjectIds !== undefined || body.data.subjectId !== undefined || body.data.classIds !== undefined || body.data.classId !== undefined || body.data.releaseAt !== undefined || body.data.dueAt !== undefined;
  if (scopeChanged) {
    const { error } = await appSchema().rpc('set_quiz_scope', { p_quiz_id: current.id, p_subject_ids: subjectIds, p_class_ids: classIds, p_release_at: releaseAt, p_due_at: dueAt, p_actor_auth_uid: auth.user.authUid });
    if (error) return jsonError('INTERNAL_ERROR', `Falha ao atualizar o público: ${error.message}`, 500);
  }
  await auditLog({ organizationId, actorAuthUid: auth.user.authUid, action: body.data.status === 'published' ? 'quiz_published' : 'quiz_updated', entityName: 'quizzes', entityId: current.id, metadata: { ...body.data, subjectIds, classIds } });
  invalidatePlatformData();
  return jsonOk({ id: current.id, ...body.data, subjectIds, classIds });
}

export async function DELETE(request: Request, context: { params: Promise<{ quizId: string }> }) {
  const auth = await authorizeManagement(request, ['admin', 'coordinator']);
  if (!auth.ok) return auth.response;
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return jsonError('BAD_REQUEST', 'ID inválido.', 400);
  const { data, error } = await appSchema().from('quizzes').delete().eq('id', params.data.quizId).eq('organization_id', auth.membership.organizationId).select('id,title').maybeSingle();
  if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  if (!data) return jsonError('NOT_FOUND', 'Simulado não encontrado.', 404);
  await auditLog({ organizationId: auth.membership.organizationId, actorAuthUid: auth.user.authUid, action: 'quiz_deleted', entityName: 'quizzes', entityId: data.id, metadata: { title: data.title } });
  invalidatePlatformData();
  return jsonOk({ deleted: true });
}
