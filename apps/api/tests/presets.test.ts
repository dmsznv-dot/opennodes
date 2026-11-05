import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { closeDb, createPgliteDb, getInitialMigrationSql, workspaces } from '@localflow/db';
import { LocalFlowApiServer } from '../src/index.js';

const servers: LocalFlowApiServer[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((api) => api.close()));
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});
const boot = (databaseUrl = 'pglite://memory') => {
  const api = new LocalFlowApiServer({ databaseUrl });
  servers.push(api);
  return api;
};
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const setup = async (api: LocalFlowApiServer) => {
  const response = await api.inject<{ workspaceId: string; token: string }>({
    method: 'POST',
    url: '/api/v1/setup',
    body: { email: 'presets@example.test', password: 'StrongPassword123!' },
  });
  expect(response.statusCode).toBe(201);
  return {
    url: `/api/v1/workspaces/${response.body.workspaceId}/presets`,
    headers: auth(response.body.token),
    ...response.body,
  };
};
const voice = () => ({
  id: 'vp_oldbrowser123',
  name: 'Brand voice',
  versions: [
    {
      version: 1,
      config: { name: 'Brand voice', language: 'ru', tone: 'Friendly', emoji: 'none' },
      savedAt: 1730000000000,
    },
  ],
});
const prompt = () => ({
  id: 'vp_legacy_prompt',
  name: 'Summary',
  versions: [
    {
      version: 1,
      config: { name: 'Summary', template: 'Summarize {{$input}}', description: 'Brief' },
      savedAt: 1730000000001,
    },
  ],
});
const library = () => ({ expectedRevision: 0, voicePresets: [voice()], promptPresets: [prompt()] });

describe('persistent workspace preset library', () => {
  it('adds the library when reopening an older database without changing existing workspace data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opennodes-presets-upgrade-'));
    dirs.push(dir);
    const oldDb = createPgliteDb(dir);
    await (oldDb as any).$client.exec(getInitialMigrationSql().split('-- 0005:')[0]);
    const existing = { id: randomUUID(), name: 'Existing workspace', slug: 'keep-existing' };
    await oldDb.insert(workspaces).values(existing);
    await closeDb(oldDb);
    const api = boot(`pglite://${dir}`);
    await api.ready();
    const db = await api.database();
    expect(
      await db
        .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
        .from(workspaces)
    ).toEqual([existing]);
    expect(
      await (db as any).$client.query('SELECT * FROM workspace_preset_libraries')
    ).toMatchObject({ rows: [] });
  });

  it('starts empty and persists both kinds, old browser IDs and version history after reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opennodes-presets-'));
    dirs.push(dir);
    const first = boot(`pglite://${dir}`);
    const context = await setup(first);
    expect((await first.inject({ method: 'GET', ...context })).body).toEqual({
      revision: 0,
      voicePresets: [],
      promptPresets: [],
    });
    const saved = await first.inject({ method: 'PUT', ...context, body: library() });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).toEqual({ revision: 1, voicePresets: [voice()], promptPresets: [prompt()] });
    const next = library();
    next.expectedRevision = 1;
    next.voicePresets[0]!.versions.push({
      version: 2,
      config: { ...voice().versions[0]!.config, tone: 'Direct' },
      savedAt: 1730000000010,
    });
    expect((await first.inject({ method: 'PUT', ...context, body: next })).statusCode).toBe(200);
    await first.close();
    const second = boot(`pglite://${dir}`);
    expect((await second.inject({ method: 'GET', ...context })).body).toEqual({
      revision: 2,
      voicePresets: next.voicePresets,
      promptPresets: next.promptPresets,
    });
  });

  it('uses membership and viewer/editor permissions without leaking another workspace', async () => {
    const api = boot();
    const context = await setup(api);
    expect((await api.inject({ method: 'GET', url: context.url })).statusCode).toBe(401);
    const member = await api.createTestUser('member@example.test', 'StrongPassword123!');
    const strangerHeaders = auth(member.token);
    for (const method of ['GET', 'PUT'] as const) {
      expect(
        (await api.inject({ method, url: context.url, headers: strangerHeaders, body: library() }))
          .statusCode
      ).toBe(403);
    }
    await api.grantWorkspaceRole(context.workspaceId, member.userId, 'VIEWER');
    expect(
      (await api.inject({ method: 'GET', url: context.url, headers: strangerHeaders })).statusCode
    ).toBe(200);
    expect(
      (
        await api.inject({
          method: 'PUT',
          url: context.url,
          headers: strangerHeaders,
          body: library(),
        })
      ).statusCode
    ).toBe(403);
    await api.grantWorkspaceRole(context.workspaceId, member.userId, 'EDITOR');
    expect(
      (
        await api.inject({
          method: 'PUT',
          url: context.url,
          headers: strangerHeaders,
          body: library(),
        })
      ).statusCode
    ).toBe(200);
    const other = randomUUID();
    await (
      await api.database()
    )
      .insert(workspaces)
      .values({ id: other, name: 'Other', slug: 'other' });
    expect(
      (
        await api.inject({
          method: 'GET',
          url: `/api/v1/workspaces/${other}/presets`,
          headers: context.headers,
        })
      ).statusCode
    ).toBe(403);
    await api.grantWorkspaceRole(other, member.userId, 'EDITOR');
    expect(
      (
        await api.inject({
          method: 'GET',
          url: `/api/v1/workspaces/${other}/presets`,
          headers: strangerHeaders,
        })
      ).body
    ).toEqual({ revision: 0, voicePresets: [], promptPresets: [] });
    expect(
      (
        await api.inject({
          method: 'GET',
          url: '/api/v1/workspaces/junk/presets',
          headers: context.headers,
        })
      ).statusCode
    ).toBe(403);
  });

  it('allows exactly one concurrent CAS write and leaves winner data intact after stale writes', async () => {
    const api = boot();
    const context = await setup(api);
    const alternatives = [library(), { ...library(), voicePresets: [], promptPresets: [] }];
    const responses = await Promise.all(
      alternatives.map((body) => api.inject({ method: 'PUT', ...context, body }))
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const winner = responses.find((r) => r.statusCode === 200)!;
    expect(responses.find((r) => r.statusCode === 409)!.body).toMatchObject({
      code: 'ERR_PRESET_REVISION_CONFLICT',
    });
    const stale = await api.inject({ method: 'PUT', ...context, body: library() });
    expect(stale.statusCode).toBe(409);
    expect((await api.inject({ method: 'GET', ...context })).body).toEqual(winner.body);
  });

  it('rejects rewriting, dropping, renumbering or moving immutable historical versions', async () => {
    const api = boot();
    const context = await setup(api);
    expect((await api.inject({ method: 'PUT', ...context, body: library() })).statusCode).toBe(200);
    const variants: any[] = [];
    let body: any = library();
    body.voicePresets[0].versions[0].config.tone = 'Changed';
    variants.push(body);
    body = library();
    body.voicePresets[0].versions[0].savedAt++;
    variants.push(body);
    body = library();
    body.voicePresets = [];
    variants.push(body);
    body = library();
    body.promptPresets = [];
    variants.push(body);
    body = library();
    body.voicePresets[0].id = 'vp_replacement';
    variants.push(body);
    for (const variant of variants) {
      const response = await api.inject({
        method: 'PUT',
        ...context,
        body: { ...variant, expectedRevision: 1 },
      });
      expect(response.statusCode).toBe(409);
      expect(response.body).toMatchObject({ code: 'ERR_PRESET_HISTORY_IMMUTABLE' });
    }
    const two: any = library();
    two.expectedRevision = 1;
    two.voicePresets[0].versions.push({
      ...voice().versions[0],
      version: 2,
      savedAt: 1730000000010,
    });
    expect((await api.inject({ method: 'PUT', ...context, body: two })).statusCode).toBe(200);
    expect(
      (await api.inject({ method: 'PUT', ...context, body: { ...library(), expectedRevision: 2 } }))
        .statusCode
    ).toBe(409);
    const reordered: any = two;
    reordered.expectedRevision = 2;
    reordered.voicePresets[0].versions[0].config = {
      emoji: 'none',
      tone: 'Friendly',
      language: 'ru',
      name: 'Brand voice',
    };
    expect((await api.inject({ method: 'PUT', ...context, body: reordered })).statusCode).toBe(200);
  });

  it('rejects unknown secret fields, malformed histories and bounded oversized libraries atomically', async () => {
    const api = boot();
    const context = await setup(api);
    const variants: any[] = [
      null,
      {},
      { ...library(), expectedRevision: -1 },
      { ...library(), expectedRevision: 0.5 },
    ];
    for (const key of ['apiKey', 'botToken', 'credentials', 'password']) {
      const body: any = library();
      body.voicePresets[0].versions[0].config[key] = 'MUST_NOT_PERSIST';
      variants.push(body);
      const p: any = library();
      p.promptPresets[0].versions[0].config[key] = 'MUST_NOT_PERSIST';
      variants.push(p);
    }
    let body: any = library();
    body.voicePresets[0].versions[0].config.tone = {};
    variants.push(body);
    body = library();
    body.voicePresets[0].versions = [];
    variants.push(body);
    body = library();
    body.voicePresets[0].versions[0].version = 2;
    variants.push(body);
    body = library();
    body.voicePresets.push(voice());
    variants.push(body);
    body = library();
    body.voicePresets[0].versions[0].savedAt = 'yesterday';
    variants.push(body);
    body = library();
    body.promptPresets[0].versions[0].config.template = 'x'.repeat(65537);
    variants.push(body);
    body = library();
    body.voicePresets = Array.from({ length: 101 }, (_, n) => ({ ...voice(), id: `vp_${n}` }));
    variants.push(body);
    body = library();
    body.voicePresets[0].versions = Array.from({ length: 101 }, (_, n) => ({
      ...voice().versions[0],
      version: n + 1,
    }));
    variants.push(body);
    body = library();
    body.extra = 'MUST_NOT_PERSIST';
    variants.push(body);
    body = library();
    body.voicePresets = Array.from({ length: 20 }, (_, n) => ({
      ...voice(),
      id: `vp_large_${n}`,
      versions: [
        {
          ...voice().versions[0],
          config: { examples: 'я'.repeat(16384), terms: 'я'.repeat(16384) },
        },
      ],
    }));
    variants.push(body);
    for (const variant of variants) {
      const response = await api.inject({ method: 'PUT', ...context, body: variant });
      expect(response.statusCode).toBe(400);
      expect(response.rawBody).not.toContain('MUST_NOT_PERSIST');
    }
    expect((await api.inject({ method: 'GET', ...context })).body).toEqual({
      revision: 0,
      voicePresets: [],
      promptPresets: [],
    });
  });
});
