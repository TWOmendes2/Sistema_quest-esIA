import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { authorizeManagement, canManageAllSubjects } from '@/server/auth/management';
import { appSchema } from '@/server/supabase/admin';
import { auditLog } from '@/server/audit/audit';
import { invalidatePlatformData } from '@/server/cache/data-cache';
const schema = z.object({ targetQuizId: z.string().uuid(), questionIds: z.array(z.string().uuid()).min(1).max(100) });
export async function POST(request: Request) {
  const auth = await authorizeManagement(request); if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return jsonError('BAD_REQUEST', 'Seleção inválida.', 400, parsed.error.flatten());
  const [{ data: quiz }, { data: sourceQuestions }] = await Promise.all([
    appSchema().from('quizzes').select('id,organization_id,subject_id,status,quiz_kind').eq('id', parsed.data.targetQuizId).maybeSingle(),
    appSchema().from('quiz_questions').select('id,subject_id,review_status').in('id', parsed.data.questionIds)
  ]);
  if (!quiz || quiz.organization_id !== auth.membership.organizationId) return jsonError('NOT_FOUND', 'Simulado de destino não encontrado.', 404);
  if (quiz.quiz_kind !== 'assessment' || !['draft', 'review'].includes(quiz.status)) return jsonError('CONFLICT', 'O simulado de destino não aceita novas questões.', 409);
  if ((sourceQuestions ?? []).length !== parsed.data.questionIds.length || (sourceQuestions ?? []).some((item) => item.review_status !== 'approved')) return jsonError('BAD_REQUEST', 'Todas as questões precisam existir e estar aprovadas.', 400);
  const subjectIds = [...new Set((sourceQuestions ?? []).map((item) => item.subject_id))];
  if (!canManageAllSubjects(auth.scope, subjectIds)) return jsonError('FORBIDDEN', 'Você não pode reutilizar questões de outra matéria.', 403);
  const { data: existingLinks, error: existingLinkError } = await appSchema().from('quiz_subjects').select('subject_id').eq('quiz_id', quiz.id).eq('status', 'active');
  if (existingLinkError) return jsonError('INTERNAL_ERROR', existingLinkError.message, 500);
  const targetSubjectIds = [...new Set([...(existingLinks ?? []).map((item) => item.subject_id), quiz.subject_id].filter(Boolean))];
  if (!canManageAllSubjects(auth.scope, targetSubjectIds)) return jsonError('FORBIDDEN', 'Você só pode adicionar questões a simulados inteiramente vinculados às suas matérias.', 403);
  const existing = new Set(targetSubjectIds);
  const missing = subjectIds.filter((id) => !existing.has(id));
  if (missing.length && auth.scope.role === 'teacher') return jsonError('FORBIDDEN', 'A matéria da questão precisa já fazer parte do simulado.', 403);
  if (missing.length) {
    const { error: linkError } = await appSchema().from('quiz_subjects').insert(missing.map((subjectId) => ({ organization_id: auth.membership.organizationId, quiz_id: quiz.id, subject_id: subjectId, created_by: auth.user.authUid })));
    if (linkError) return jsonError('INTERNAL_ERROR', `Não foi possível incluir a matéria no simulado: ${linkError.message}`, 500);
  }
  const { data, error } = await appSchema().rpc('clone_approved_questions', { p_target_quiz_id: parsed.data.targetQuizId, p_question_ids: parsed.data.questionIds, p_actor_auth_uid: auth.user.authUid });
  if (error) return jsonError('INTERNAL_ERROR', `Não foi possível adicionar as questões: ${error.message}. Confirme se a migration 013 foi aplicada.`, 500);
  const count = Number(data || 0);
  await auditLog({ organizationId: auth.membership.organizationId, actorAuthUid: auth.user.authUid, action: 'questions_attached_to_quiz', entityName: 'quizzes', entityId: parsed.data.targetQuizId, metadata: { question_ids: parsed.data.questionIds, subject_ids: subjectIds, copied: count } });
  invalidatePlatformData(); return jsonOk({ copied: count, skipped: Math.max(0, parsed.data.questionIds.length - count), addedSubjectIds: missing });
}
