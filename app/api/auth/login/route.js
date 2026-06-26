import { NextResponse } from 'next/server';
import { buildSession, recordLoginEvent, setSessionCookie, verifyPassword } from '../../../../lib/auth';
import { query } from '../../../../lib/db';

export async function POST(request) {
  try {
    const body = await request.json();
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    }

    const result = await query(
      `select u.id, u.username, u.password_salt, u.password_hash, u.is_active, t.code as user_type
       from app_users u
       left join user_types t on t.id = u.user_type_id
       where u.username = $1
       limit 1`,
      [username]
    );

    const user = result.rows[0];
    if (!user) {
      await recordLoginEvent(null, username, false, request, 'Unknown username');
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    if (!user.is_active) {
      await recordLoginEvent(user.id, username, false, request, 'Inactive user');
      return NextResponse.json({ error: 'User is inactive' }, { status: 403 });
    }

    const passwordOk = verifyPassword(password, user.password_salt, user.password_hash);
    if (!passwordOk) {
      await recordLoginEvent(user.id, username, false, request, 'Incorrect password');
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    await recordLoginEvent(user.id, username, true, request, 'Login successful');

    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        userType: user.user_type || ''
      }
    });

    return setSessionCookie(
      response,
      buildSession({
        id: user.id,
        username: user.username,
        userType: user.user_type || ''
      })
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
