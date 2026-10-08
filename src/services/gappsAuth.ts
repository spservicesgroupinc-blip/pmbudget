import gappsConfig from '../../env/gapps-config.json';

/**
 * VITE_GAPPS_WEB_APP_URL overrides the URL bundled from gapps-config.json.
 * Authentication uses individual account sessions; shared setup/app keys
 * are no longer required by the Apps Script backend.
 */
const gapps = {
  webAppUrl: import.meta.env.VITE_GAPPS_WEB_APP_URL || gappsConfig.webAppUrl,
};

export interface GappsUser {
  email: string;
  name: string;
  role: string;
}

export interface GappsSession {
  token: string;
  user: GappsUser;
  expiresAt: string;
}

interface GappsEnvelope {
  ok?: boolean;
  data?: unknown;
  error?: string;
}

const SESSION_KEY = 'hays.sons.gapps.session.v1';

/** True once the deployed Apps Script URL is present. */
export const isGappsConfigured = (): boolean =>
  gapps.webAppUrl.length > 0 &&
  !gapps.webAppUrl.includes('REPLACE_WITH');

const isLocalDev = (): boolean =>
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

function readSession(): GappsSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const session = parsed as Partial<GappsSession>;
    if (
      typeof session.token !== 'string' ||
      session.token.length === 0 ||
      typeof session.expiresAt !== 'string' ||
      !session.user ||
      typeof session.user !== 'object' ||
      typeof (session.user as GappsUser).email !== 'string'
    ) {
      return null;
    }
    return session as GappsSession;
  } catch {
    return null;
  }
}

const isExpired = (session: GappsSession | null): boolean => {
  if (!session) return true;
  const expiry = Date.parse(session.expiresAt);
  return Number.isNaN(expiry) || expiry <= Date.now();
};

/**
 * POST an action to the Google Workspace backend and unwrap its
 * `{ ok, data, error }` envelope. When the backend is not configured yet,
 * local dev falls back to a built-in mock endpoint so the whole flow can be
 * exercised before the Apps Script project is deployed.
 */
export async function gappsFetch<T>(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  let url: string;
  if (isGappsConfigured()) {
    url = gapps.webAppUrl;
  } else if (isLocalDev()) {
    url = '/api/gapps-mock';
  } else {
    throw new Error(
      'Google Workspace backend is not configured. Deploy the Apps Script project and update env/gapps-config.json.'
    );
  }

  const session = readSession();
  const includeToken = action !== 'login' && action !== 'ping' && action !== 'addUser';
  const body: Record<string, unknown> = {
    action,
    ...payload,
  };
  if (includeToken && session && !isExpired(session)) {
    body.token = session.token;
  }

  let res: Response;
  try {
    // NOTE: Apps Script web apps do not answer CORS preflights, so the body
    // MUST use a "simple" content type (text/plain, no custom headers). The
    // backend JSON.parses e.postData.contents regardless of content type.
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the Google Workspace backend.');
  }

  let envelope: GappsEnvelope;
  try {
    envelope = (await res.json()) as GappsEnvelope;
  } catch {
    throw new Error(`Workspace backend returned an invalid response (${res.status}).`);
  }

  if (envelope.ok === true) {
    return envelope.data as T;
  }
  throw new Error(envelope.error || 'Workspace backend error.');
}

/** Signs in against the Users sheet and persists the session locally. */
export async function login(email: string, password: string): Promise<GappsUser> {
  const data = await gappsFetch<{
    token: string;
    user: GappsUser;
    expiresAt: string;
  }>('login', { email, password });

  if (!data || !data.token || !data.user) {
    throw new Error('Workspace backend returned an invalid session.');
  }
  const session: GappsSession = {
    token: data.token,
    user: data.user,
    expiresAt: data.expiresAt || new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
  };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable — the session simply won't survive a reload.
  }
  return session.user;
}

/** Returns the locally stored user when the session is still valid. */
export function getCurrentUser(): GappsUser | null {
  const session = readSession();
  if (!session || isExpired(session)) return null;
  return session.user;
}

/** Returns the stored session token when still valid. */
export function getSessionToken(): string | null {
  const session = readSession();
  if (!session || isExpired(session)) return null;
  return session.token;
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

/** Server-side session validation; clears the local session on failure. */
export async function verifySession(): Promise<GappsUser | null> {
  const session = readSession();
  if (!session || isExpired(session)) {
    clearSession();
    return null;
  }
  try {
    const data = await gappsFetch<{ user: GappsUser; expiresAt?: string }>('session', {});
    if (!data || !data.user) {
      clearSession();
      return null;
    }
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          token: session.token,
          user: data.user,
          expiresAt: data.expiresAt || session.expiresAt,
        })
      );
    } catch {
      // ignore
    }
    return data.user;
  } catch {
    clearSession();
    return null;
  }
}

/** Signs out server-side (best effort) and clears the local session. */
export async function logout(): Promise<void> {
  try {
    await gappsFetch<{ ok: boolean }>('logout', {});
  } catch {
    // Best effort — always clear locally.
  }
  clearSession();
}

/**
 * Creates a new staff account through self-service sign-up.
 */
export async function createAccount(input: {
  email: string;
  name: string;
  password: string;
}): Promise<GappsUser> {
  const data = await gappsFetch<{ user: GappsUser }>('addUser', {
    email: input.email,
    name: input.name,
    password: input.password,
  });
  if (!data || !data.user || !data.user.email) {
    throw new Error('Workspace backend returned an invalid response.');
  }
  return data.user;
}
