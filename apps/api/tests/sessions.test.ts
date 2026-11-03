import { describe, it, expect, afterEach } from 'vitest';
import { LocalFlowApiServer } from '../src/index.js';
import { parseCookies } from '../src/cookies.js';

const servers: LocalFlowApiServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const OWNER = { email: 'owner@localflow.dev', password: 'StrongPassword123!' };

/** The cookies a browser would keep from Set-Cookie headers. */
function jar(setCookie: string | string[] | undefined): Record<string, string> {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return Object.fromEntries(
    list.map((c) => Object.entries(parseCookies(c.split(';')[0]))[0]!).filter(Boolean)
  );
}
const cookieHeader = (c: Record<string, string>) =>
  Object.entries(c)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('; ');

async function signedIn() {
  const api = new LocalFlowApiServer({ databaseUrl: 'pglite://memory' });
  servers.push(api);
  const setup = await api.inject<{ workspaceId: string; token: string }>({
    method: 'POST',
    url: '/api/v1/setup',
    body: { ...OWNER, workspaceName: 'Team' },
  });
  const login = await api.inject<{ token: string }>({
    method: 'POST',
    url: '/api/v1/auth/login',
    body: OWNER,
  });
  return {
    api,
    workspaceId: setup.body.workspaceId,
    login,
    cookies: jar(login.headers['set-cookie']),
  };
}

describe('@localflow/api — browser sessions (HttpOnly cookie + CSRF)', () => {
  it('sign-in sets an HttpOnly session cookie and a readable CSRF cookie', async () => {
    const { login, cookies } = await signedIn();
    const set = login.headers['set-cookie'] as string[];
    expect(set).toHaveLength(2);
    const session = set.find((c) => c.startsWith('on_session='))!;
    const csrf = set.find((c) => c.startsWith('on_csrf='))!;
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(session).not.toMatch(/Secure/); // plain http on localhost
    expect(csrf).not.toMatch(/HttpOnly/); // the page reads it to echo it back
    expect(cookies.on_session).toBe(login.body.token);
    expect(cookies.on_csrf.length).toBeGreaterThan(20);
  });

  it('reads with the cookie alone; changes need the CSRF header that matches the cookie', async () => {
    const { api, workspaceId, cookies } = await signedIn();
    const cookie = cookieHeader(cookies);

    const me = await api.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);

    const url = `/api/v1/workspaces/${workspaceId}/workflows`;
    const body = { name: 'w', nodes: [], edges: [] };
    const forged = await api.inject<{ code: string }>({
      method: 'POST',
      url,
      headers: { cookie },
      body,
    });
    expect(forged.statusCode).toBe(403);
    expect(forged.body.code).toBe('ERR_CSRF_INVALID');

    const wrong = await api.inject({
      method: 'POST',
      url,
      headers: { cookie, 'x-csrf-token': 'guess' },
      body,
    });
    expect(wrong.statusCode).toBe(403);

    const ok = await api.inject({
      method: 'POST',
      url,
      headers: { cookie, 'x-csrf-token': cookies.on_csrf! },
      body,
    });
    expect(ok.statusCode).toBe(201);
  });

  it('API clients keep using Bearer tokens without CSRF', async () => {
    const { api, workspaceId, login } = await signedIn();
    const res = await api.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/workflows`,
      headers: { Authorization: `Bearer ${login.body.token}` },
      body: { name: 'w', nodes: [], edges: [] },
    });
    expect(res.statusCode).toBe(201);
  });

  it('sign-out ends the cookie session and clears both cookies', async () => {
    const { api, cookies } = await signedIn();
    const cookie = cookieHeader(cookies);
    const out = await api.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, 'x-csrf-token': cookies.on_csrf! },
    });
    expect(out.statusCode).toBe(200);
    const cleared = out.headers['set-cookie'] as string[];
    expect(cleared.every((c) => /Max-Age=0/.test(c))).toBe(true);
    const me = await api.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('marks cookies Secure behind an HTTPS proxy', async () => {
    const api = new LocalFlowApiServer({ databaseUrl: 'pglite://memory' });
    servers.push(api);
    const res = await api.inject({
      method: 'POST',
      url: '/api/v1/setup',
      headers: { 'x-forwarded-proto': 'https' },
      body: { ...OWNER, workspaceName: 'Team' },
    });
    for (const c of res.headers['set-cookie'] as string[]) expect(c).toMatch(/; Secure/);
  });
});
