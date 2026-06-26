import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { query } from './db';

export { hashPassword, verifyPassword } from './password';

const SESSION_COOKIE = 'blob_storage_lab_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function getSessionSecret() {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) {
    throw new Error('Missing APP_SESSION_SECRET in environment');
  }
  return secret;
}

function signPayload(payload) {
  return crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

export function createSessionCookieValue(session) {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = signPayload(payload);
  return `${payload}.${signature}`;
}

export function readSessionCookieValue(value) {
  if (!value || !value.includes('.')) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;

  const expected = signPayload(payload);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session?.userId || !session?.username || !session?.expiresAt) {
      return null;
    }
    if (Date.now() > Number(session.expiresAt)) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function buildSession(user) {
  return {
    userId: user.id,
    username: user.username,
    userType: user.userType || '',
    expiresAt: Date.now() + SESSION_TTL_MS
  };
}

export function setSessionCookie(response, session) {
  response.cookies.set(SESSION_COOKIE, createSessionCookieValue(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    expires: new Date(session.expiresAt)
  });
  return response;
}

export function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    expires: new Date(0)
  });
  return response;
}

export function getRequestSession(request) {
  const value = request.cookies.get(SESSION_COOKIE)?.value;
  return readSessionCookieValue(value);
}

export function requireSession(request) {
  const session = getRequestSession(request);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    };
  }

  return { ok: true, session };
}

export function normalizeBlobPrefix(prefix = '') {
  const trimmed = String(prefix || '').replace(/^\/+|\/+$/g, '');
  return trimmed ? `${trimmed}/` : '';
}

export function isBlobPathAllowed(path, allowedPrefixes = []) {
  if (!allowedPrefixes.length) return false;
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  return allowedPrefixes.some((prefix) => normalizedPath.startsWith(prefix));
}

export function canBrowsePrefix(prefix, allowedPrefixes = []) {
  const normalizedPrefix = normalizeBlobPrefix(prefix);
  if (!normalizedPrefix) return true;
  return allowedPrefixes.some(
    (allowedPrefix) => normalizedPrefix.startsWith(allowedPrefix) || allowedPrefix.startsWith(normalizedPrefix)
  );
}

export async function getBlobAccessContext(request) {
  const auth = requireSession(request);
  if (!auth.ok) return auth;

  const session = auth.session;
  if (session.userType === 'admin') {
    return {
      ok: true,
      session,
      userType: session.userType,
      allowedPrefixes: [],
      isAdmin: true
    };
  }

  const result = await query(
    `select fp.folder_prefix
     from folder_permissions fp
     where fp.user_id = $1
     order by fp.folder_prefix`,
    [session.userId]
  );

  const allowedPrefixes = result.rows
    .map((row) => normalizeBlobPrefix(row.folder_prefix))
    .filter(Boolean);

  return {
    ok: true,
    session,
    userType: session.userType,
    allowedPrefixes,
    isAdmin: false
  };
}

export async function recordLoginEvent(userId, username, success, request, message = '') {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ipAddress = forwardedFor ? forwardedFor.split(',')[0].trim() : 'unknown';
  const userAgent = request.headers.get('user-agent') || '';

  await query(
    `insert into login_events (user_id, username, success, ip_address, user_agent, message)
     values ($1, $2, $3, $4, $5, $6)`,
    [userId, username, success, ipAddress, userAgent, message]
  );
}
