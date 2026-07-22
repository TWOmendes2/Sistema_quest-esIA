import { z } from 'zod';
import { getAuthenticatedUser } from '@/server/auth/session';
import { createSupabaseAdminClient } from '@/server/supabase/admin';
import { jsonError, jsonOk } from '@/lib/http';
const schema = z.object({ password: z.string().min(8).max(128) });
export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request); if (!user) return jsonError('UNAUTHORIZED', 'Sessão inválida.', 401);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return jsonError('BAD_REQUEST', 'A senha deve ter ao menos 8 caracteres.', 400);
  const client = createSupabaseAdminClient();
  const { error } = await client.auth.admin.updateUserById(user.authUid, { password: parsed.data.password, user_metadata: { ...user.userMetadata, must_change_password: false, temporary_password_changed_at: new Date().toISOString() } });
  if (error) return jsonError('INTERNAL_ERROR', error.message, 500);
  return jsonOk({ changed: true });
}
