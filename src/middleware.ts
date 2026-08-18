import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback_secret')

// /api/salud es pública: identifica el despliegue cuando NO se puede entrar.
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/salud']

/** Las llamadas de API reciben 401 JSON; las de navegación, redirección al login. */
function rechazar(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  return NextResponse.redirect(new URL('/login', req.url))
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const token = req.cookies.get('auth_token')?.value
  if (!token) return rechazar(req)

  try {
    await jwtVerify(token, secret)
    return NextResponse.next()
  } catch {
    return rechazar(req)
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
