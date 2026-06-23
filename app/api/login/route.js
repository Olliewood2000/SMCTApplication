import { NextResponse } from 'next/server';

// POST /api/login  { password }
// If the password matches DASHBOARD_PASSWORD, set an httpOnly cookie.
export async function POST(request) {
  const { password } = await request.json();

  if (password && password === process.env.DASHBOARD_PASSWORD) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set('smct_auth', process.env.DASHBOARD_PASSWORD, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return res;
  }

  return NextResponse.json({ ok: false }, { status: 401 });
}
