import { NextResponse } from 'next/server';
import { clearSessionCookies, readCookie, accessCookieName } from '@/server/auth/session';
import { createSupabaseAdminClient } from '@/server/supabase/admin';
import { auditLog } from '@/server/audit/audit';
import { getRequestIp, getUserAgent } from '@/lib/http';

export async function POST(request: Request) {
  const token = readCookie(request, accessCookieName);
  const response = NextResponse.json({ ok: true, data: { loggedOut: true } });
  clearSessionCookies(response);

  if (token) {
    try {
      await createSupabaseAdminClient().auth.admin.signOut(token, 'global');
    } catch (error) {
      console.error('supabase_signout_failed', error);
    }
  }

  await auditLog({ action: 'logout', entityName: 'auth_session', ipAddress: getRequestIp(request), userAgent: getUserAgent(request) });
  return response;
}
