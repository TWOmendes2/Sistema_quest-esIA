import { jsonError, jsonOk } from '@/lib/http';
import { getActiveStudentProfile, getAuthenticatedUser, getMemberships } from '@/server/auth/session';

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('UNAUTHORIZED', 'Sessão inválida ou expirada.', 401);

  const [profile, memberships] = await Promise.all([
    getActiveStudentProfile(user.authUid),
    getMemberships(user.authUid)
  ]);

  return jsonOk({ user, profile, memberships });
}
