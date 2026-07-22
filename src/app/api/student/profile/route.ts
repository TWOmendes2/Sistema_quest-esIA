import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/http';
import { getActiveStudentProfile, getAuthenticatedUser } from '@/server/auth/session';
import { appSchema, createSupabaseAdminClient } from '@/server/supabase/admin';

const bodySchema = z.object({
  nickname: z.string().trim().min(2).max(40),
  email: z.string().trim().email().max(255)
});

export async function PATCH(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('UNAUTHORIZED', 'Sessão inválida.', 401);
  const profile = await getActiveStudentProfile(user.authUid);
  if (!profile) return jsonError('FORBIDDEN', 'Perfil de aluno não está ativo.', 403);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('BAD_REQUEST', 'Dados inválidos.', 400, parsed.error.flatten());
  const { data: conflict } = await appSchema().from('student_profiles').select('id').eq('organization_id', profile.organization_id).ilike('nickname', parsed.data.nickname).neq('id', profile.id).maybeSingle();
  if (conflict) return jsonError('CONFLICT', 'Este apelido já está em uso.', 409);
  const { data, error } = await appSchema().from('student_profiles').update({ nickname: parsed.data.nickname, email: parsed.data.email }).eq('id', profile.id).eq('auth_uid', user.authUid).select('id,nickname,email').single();
  if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  if (user.email !== parsed.data.email) {
    const { error: authError } = await createSupabaseAdminClient().auth.admin.updateUserById(user.authUid, { email: parsed.data.email, email_confirm: true });
    if (authError) return jsonError('INTERNAL_ERROR', `Perfil atualizado, mas o login não pôde ser alterado: ${authError.message}`, 500);
  }
  return jsonOk(data);
}
