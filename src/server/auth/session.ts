import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseAdminClient, appSchema } from '@/server/supabase/admin';
import { env } from '@/server/env';

export const accessCookieName = 'sb-access-token';
export const refreshCookieName = 'sb-refresh-token';

export type AuthenticatedUser = {
  authUid: string;
  email: string | null;
  userMetadata: Record<string, unknown>;
};

export function setSessionCookies(response: NextResponse, accessToken: string, refreshToken: string, expiresInSeconds: number): void {
  const cookieBase = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.sessionCookieSecure,
    path: '/',
    maxAge: expiresInSeconds
  };

  response.cookies.set(accessCookieName, accessToken, cookieBase);
  response.cookies.set(refreshCookieName, refreshToken, cookieBase);
}

export function clearSessionCookies(response: NextResponse): void {
  const cookieBase = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.sessionCookieSecure,
    path: '/',
    maxAge: 0
  };

  response.cookies.set(accessCookieName, '', cookieBase);
  response.cookies.set(refreshCookieName, '', cookieBase);
}

export function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((part) => part.trim());
  const target = cookies.find((part) => part.startsWith(`${name}=`));
  if (!target) return null;
  return decodeURIComponent(target.slice(name.length + 1));
}

export async function getAuthenticatedUser(request: Request): Promise<AuthenticatedUser | null> {
  const token = readCookie(request, accessCookieName);
  if (!token) return null;

  return getAuthenticatedUserFromToken(token);
}

export async function getAuthenticatedUserFromToken(token: string): Promise<AuthenticatedUser | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  return {
    authUid: data.user.id,
    email: data.user.email ?? null,
    userMetadata: (data.user.user_metadata ?? {}) as Record<string, unknown>
  };
}

export async function getActiveStudentProfile(authUid: string) {
  const { data, error } = await appSchema()
    .from('student_profiles')
    .select('id, organization_id, nickname, full_name, email, status')
    .eq('auth_uid', authUid)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getMemberships(authUid: string) {
  const { data, error } = await appSchema()
    .from('memberships')
    .select('organization_id, role, status')
    .eq('auth_uid', authUid)
    .eq('status', 'active');

  if (error) throw error;
  return data ?? [];
}
