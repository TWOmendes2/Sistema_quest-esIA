import 'server-only';
import { appSchema } from '@/server/supabase/admin';
import type { GeneratedQuiz } from './question-schema';

export async function persistGeneratedQuiz(input: {
  organizationId: string;
  subjectId: string;
  actorAuthUid: string;
  aiJobId: string;
  quizId?: string;
  classId?: string;
  autoPublish: boolean;
  quiz: GeneratedQuiz;
}): Promise<{ quizId: string; questionCount: number; status: 'draft' | 'published'; questionIds: string[] }> {
  const { data, error } = await appSchema().rpc('create_quiz_from_ai_v2', {
    p_organization_id: input.organizationId,
    p_subject_id: input.subjectId,
    p_actor_auth_uid: input.actorAuthUid,
    p_ai_job_id: input.aiJobId,
    p_quiz_id: input.quizId || null,
    p_class_id: input.classId || null,
    p_auto_publish: input.autoPublish,
    p_payload: input.quiz
  });

  if (error) throw new Error(`Falha ao gravar questões no Supabase: ${error.message}. Aplique a migration 006_fix_ai_quiz_ambiguous_quiz_id.sql.`);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.quiz_id) throw new Error('O banco não retornou o ID do simulado criado.');

  return {
    quizId: String(result.quiz_id),
    questionCount: Number(result.question_count || input.quiz.questions.length),
    status: result.quiz_status === 'published' ? 'published' : 'draft',
    questionIds: Array.isArray(result.question_ids) ? result.question_ids.map(String) : []
  };
}
