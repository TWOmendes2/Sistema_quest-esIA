import { NextResponse, type NextRequest } from 'next/server';

const publicRoutes = ['/', '/login', '/first-access', '/register', '/esqueci-senha', '/redefinir-senha'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = publicRoutes.includes(pathname) || pathname.startsWith('/api/auth/');
  const hasSession = Boolean(request.cookies.get('sb-access-token')?.value);

  if (!isPublic && !hasSession && !pathname.startsWith('/_next') && !pathname.startsWith('/api/')) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
