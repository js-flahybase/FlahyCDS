import { NextResponse } from 'next/server';
import { getRequestSession } from '../../../../lib/auth';

export async function GET(request) {
  const session = getRequestSession(request);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.userId,
      username: session.username,
      userType: session.userType || ''
    }
  });
}
