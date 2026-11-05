import http from 'node:http';
import crypto from 'node:crypto';
import {
  AesGcmEncryptionService,
  AlreadyBootstrappedError,
  BootstrapService,
  type BootstrapResult,
  EnvKeyProvider,
  ForbiddenError,
  PERMISSIONS,
  RbacPolicyEngine,
  ScryptPasswordHasher,
  sanitizeCredentialEntity,
  type EncryptedData,
  type Permission,
  type Role,
} from '@localflow/auth';
import { closeDb, type DatabaseInstance } from '@localflow/db';
import { z } from 'zod';
import { redact } from '@localflow/observability';
import {
  WorkflowEdgeSchema,
  WorkflowNodeSchema,
  computeWorkflowChecksum,
  validateWorkflowGraph,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from '@localflow/workflow-schema';
import {
  BullMQQueueManager,
  type IWorkflowQueueManager,
  type JournalExecutionRecord,
  type JournalNodeExecutionRecord,
} from '@localflow/workflow-engine';
import {
  ExecutionRuntime,
  ExecutionWorker,
  LocalQueueManager,
  assertWorkflowTrigger,
  listConnectionModels,
  listMcpTools,
  listWorkflowTriggers,
  resetRssMemory,
  rssMemory,
  setWorkflowTriggersEnabled,
  syncWorkflowTriggers,
  decideApproval,
  resumeDecidedRun,
} from '@localflow/execution-runtime';
import { verifyWebhookHmac } from '@localflow/connectors-core';
import { LocalFlowError, SafeHttpClient, slugifyWorkspaceName } from '@localflow/shared';
import { loadApiConfig, type ApiConfig } from './config.js';
import { openDatabase } from './store/database.js';
import { ApiRepository, isUuid, type StoredWorkflow } from './store/repository.js';
import { PgSessionStore } from './store/session-store.js';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  clearedCookies,
  csrfMatches,
  needsCsrf,
  parseCookies,
  sessionCookies,
} from './cookies.js';

export type { StoredWorkflow, WorkflowVersionSnapshot } from './store/repository.js';

/**
 * What a webhook run sees as $trigger: JSON as is, an HTML form's fields
 * (application/x-www-form-urlencoded), and anything else as { body: "<text>" }.
 */
export function webhookPayload(
  body: unknown,
  contentType: string | undefined,
  raw: string | undefined
): Record<string, unknown> {
  const text = raw ?? (typeof body === 'string' ? body : undefined);
  if (/application\/x-www-form-urlencoded/i.test(contentType ?? '') && text !== undefined) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of new URLSearchParams(text)) {
      // A repeated field (checkboxes) becomes a list.
      out[k] = k in out ? [...(Array.isArray(out[k]) ? (out[k] as unknown[]) : [out[k]]), v] : v;
    }
    return out;
  }
  if (body && typeof body === 'object' && !Array.isArray(body))
    return body as Record<string, unknown>;
  if (Array.isArray(body)) return { items: body };
  if (body === undefined || body === null || body === '') return {};
  return { body: typeof body === 'string' ? body : JSON.stringify(body) };
}

export interface InjectRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Exact request bytes as received; webhook signatures are verified against these. */
  rawBody?: string;
}

/** Draft graph accepted by PUT /draft and POST /workflows. */
const DraftGraphSchema = z.object({
  nodes: z.array(WorkflowNodeSchema).default([]),
  edges: z.array(WorkflowEdgeSchema).default([]),
});

/** Runs that can still be stopped; finished runs keep their final status. */
const CANCELLABLE_STATUSES = new Set(['QUEUED', 'RUNNING', 'WAITING']);

export interface InjectResponse<T = unknown> {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: T;
  rawBody: string;
}

export interface SseEventMessage {
  event: string;
  data: Record<string, unknown>;
}

/** Run states after which nothing changes until someone acts (resume, retry, edit). */
const SETTLED_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'WAITING']);

interface ApiRuntime {
  db: DatabaseInstance;
  repo: ApiRepository;
  sessions: PgSessionStore;
  execution: ExecutionRuntime;
  queue: IWorkflowQueueManager;
  /** Only in embedded mode: the in-process consumer of the queue. */
  worker?: ExecutionWorker;
  bootstrap: BootstrapService;
}

/**
 * Control-plane REST API. All state (users, sessions, workspaces, memberships,
 * credentials, workflows, versions, executions) lives in PostgreSQL — or embedded
 * PGlite for tests and single-process local runs — so it survives restarts.
 */
export class LocalFlowApiServer {
  private readonly config: ApiConfig;
  private readonly hasher = new ScryptPasswordHasher();
  private readonly encryptionService: AesGcmEncryptionService;
  private runtime?: ApiRuntime;
  private initPromise?: Promise<ApiRuntime>;
  private httpServer?: http.Server;

  constructor(config?: Partial<ApiConfig>) {
    this.config = { ...loadApiConfig(), ...config };
    const keyProvider = new EnvKeyProvider(this.config.encryptionKey, 1);
    this.encryptionService = new AesGcmEncryptionService(keyProvider);
  }

  /**
   * Opens the database and applies migrations. Called lazily by `inject`/`listen`;
   * a failed attempt is retried on the next call (e.g. Postgres still starting).
   */
  public async ready(): Promise<void> {
    await this.getRuntime();
  }

  private getRuntime(): Promise<ApiRuntime> {
    if (this.runtime) return Promise.resolve(this.runtime);
    this.initPromise ??= this.initRuntime().then(
      (rt) => (this.runtime = rt),
      (err) => {
        this.initPromise = undefined;
        throw err;
      }
    );
    return this.initPromise;
  }

  private async initRuntime(): Promise<ApiRuntime> {
    const db = await openDatabase(this.config.databaseUrl);
    const repo = new ApiRepository(db);
    const bootstrap = new BootstrapService(
      {
        isSystemBootstrapped: () => repo.isBootstrapped(),
        createOwnerAndWorkspace: async (input) => {
          const workspaceSlug = slugifyWorkspaceName(
            input.workspaceName,
            await repo.listWorkspaceSlugs()
          );
          const { userId, workspaceId } = await repo.createOwnerAndWorkspace({
            ...input,
            workspaceSlug,
          });
          const result: BootstrapResult & { workspaceSlug: string } = {
            userId,
            email: input.email,
            workspaceId,
            workspaceName: input.workspaceName,
            workspaceSlug,
            role: 'OWNER',
          };
          return result;
        },
      },
      this.hasher
    );
    const execution = new ExecutionRuntime({
      db,
      encryptionKey: this.config.encryptionKey,
      ssrfAllowlist: this.config.ssrfAllowlist,
      telegramApiBase: this.config.telegramApiBase,
      allowedFsRoot: this.config.allowedFsRoot,
      inlineDelayMaxMs: this.config.inlineDelayMaxMs,
      forEachPauseMs: this.config.forEachPauseMs,
      staleMs: this.config.recoveryStaleMs,
      heartbeatMs: this.config.heartbeatMs,
    });
    // queue: runs go to Redis and the separate worker process executes them.
    // embedded: no Redis — an in-process queue and worker run the same code.
    const queue: IWorkflowQueueManager =
      this.config.executionMode === 'queue'
        ? new BullMQQueueManager({ url: this.config.redisUrl })
        : new LocalQueueManager();
    let worker: ExecutionWorker | undefined;
    if (this.config.executionMode === 'embedded') {
      worker = new ExecutionWorker({
        runtime: execution,
        queue,
        db,
        concurrency: this.config.workerConcurrency,
        recoveryIntervalMs: this.config.recoveryIntervalMs,
        retentionDays: this.config.runRetentionDays,
        triggers: {
          tickMs: this.config.triggerTickMs,
          approvalPollMs: this.config.approvalPollMs,
          telegramApiBase: this.config.telegramApiBase,
          telegramPollTimeoutSec: this.config.telegramPollTimeoutSec,
          telegramMinPollIntervalMs: this.config.telegramMinPollIntervalMs,
          telegramRetryMs: this.config.telegramRetryMs,
        },
      });
      await worker.start();
    }
    return {
      db,
      repo,
      sessions: new PgSessionStore(db),
      execution,
      queue,
      worker,
      bootstrap,
    };
  }

  /** Test hook: adds or changes a member's role. */
  public async grantWorkspaceRole(workspaceId: string, userId: string, role: Role): Promise<void> {
    const { repo } = await this.getRuntime();
    await repo.upsertMembership(workspaceId, userId, role);
  }

  /** Test hook: creates a non-owner user and signs them in. */
  public async createTestUser(
    email: string,
    password: string
  ): Promise<{ userId: string; token: string }> {
    const { repo, sessions } = await this.getRuntime();
    const passwordHash = await this.hasher.hash(password);
    const userId = await repo.createUser(email.trim().toLowerCase(), passwordHash);
    const { token } = await sessions.createSession(userId);
    return { userId, token };
  }

  /** Test hook: the database, e.g. to move a schedule's next run into the past. */
  public async database(): Promise<DatabaseInstance> {
    return (await this.getRuntime()).db;
  }

  /** Test hook: one scheduler pass (due schedules, polled bots) without waiting for the timer. */
  public async tickTriggers(): Promise<void> {
    await (await this.getRuntime()).worker?.scheduler?.tick();
  }

  /** Test hook: the ciphertext envelope exactly as stored in the database. */
  public async getRawEncryptedCredential(credentialId: string): Promise<EncryptedData | undefined> {
    const { repo } = await this.getRuntime();
    return (await repo.findCredential(credentialId))?.encryptedPayload;
  }

  public static formatSseStream(events: SseEventMessage[]): string {
    return events
      .map((evt) => `event: ${evt.event}\ndata: ${JSON.stringify(redact(evt.data))}\n\n`)
      .join('');
  }

  /** Bearer token (API clients) or the session cookie (the browser). */
  private async authenticate(
    rt: ApiRuntime,
    headers: Record<string, string>
  ): Promise<{ userId: string; token: string; viaCookie: boolean } | null> {
    const authHeader = headers['authorization'] ?? headers['Authorization'];
    const bearer = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';
    const token = bearer || parseCookies(headers['cookie'])[SESSION_COOKIE] || '';
    if (!token) return null;
    const session = await rt.sessions.validateSession(token);
    if (!session) return null;
    return { userId: session.userId, token, viaCookie: !bearer };
  }

  /** Secure cookies behind HTTPS (directly or via a proxy that says so). */
  private secureCookies(headers: Record<string, string>): boolean {
    return this.config.cookieSecure || headers['x-forwarded-proto'] === 'https';
  }

  private async requireWorkspacePermission(
    rt: ApiRuntime,
    workspaceId: string,
    userId: string,
    permission: Permission
  ): Promise<Role> {
    const role = await rt.repo.getRole(workspaceId, userId);
    if (!role) {
      throw new ForbiddenError(`User '${userId}' is not a member of workspace '${workspaceId}'.`);
    }
    RbacPolicyEngine.assertPermission(role, permission);
    return role;
  }

  public async inject<T = unknown>(req: InjectRequest): Promise<InjectResponse<T>> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const reqHeaders = Object.fromEntries(
      Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
    );

    const respond = (
      statusCode: number,
      body: unknown,
      customHeaders?: Record<string, string | string[]>
    ): InjectResponse<T> => {
      const mergedHeaders = { ...headers, ...customHeaders };
      const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
      return {
        statusCode,
        headers: mergedHeaders,
        body: body as T,
        rawBody,
      };
    };

    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const pathname = urlObj.pathname;

      // 1. Health Checks
      if (req.method === 'GET' && pathname === '/health/live') {
        return respond(200, {
          status: 'ok',
          service: 'localflow-api',
          timestamp: new Date().toISOString(),
        });
      }

      let rt: ApiRuntime;
      try {
        rt = await this.getRuntime();
      } catch (err) {
        return respond(503, {
          code: 'ERR_DATABASE_UNAVAILABLE',
          message: 'Database is not reachable yet.',
          ...(pathname === '/health/ready'
            ? { status: 'not_ready', checks: { database: 'unhealthy' } }
            : {}),
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      if (req.method === 'GET' && pathname === '/health/ready') {
        const dbOk = await rt.repo.ping();
        return respond(dbOk ? 200 : 503, {
          status: dbOk ? 'ready' : 'not_ready',
          checks: { database: dbOk ? 'healthy' : 'unhealthy' },
          bootstrapped: dbOk ? await rt.bootstrap.isBootstrapped() : undefined,
        });
      }

      // 2. Setup & Bootstrap
      if (req.method === 'GET' && pathname === '/api/v1/setup/status') {
        return respond(200, { bootstrapped: await rt.bootstrap.isBootstrapped() });
      }
      if (req.method === 'POST' && pathname === '/api/v1/setup') {
        const payload = (req.body ?? {}) as {
          email?: string;
          password?: string;
          fullName?: string;
          workspaceName?: string;
        };
        const result = await rt.bootstrap.bootstrapOwner({
          email: payload.email ?? '',
          password: payload.password ?? '',
          fullName: payload.fullName,
          workspaceName: payload.workspaceName,
        });
        const { token } = await rt.sessions.createSession(result.userId, SESSION_TTL_MS);
        return respond(
          201,
          { ...result, token },
          { 'set-cookie': sessionCookies(token, this.secureCookies(reqHeaders)) }
        );
      }

      // 3. Auth Login
      if (req.method === 'POST' && pathname === '/api/v1/auth/login') {
        const payload = (req.body ?? {}) as { email?: string; password?: string };
        const email = (payload.email ?? '').trim().toLowerCase();
        const user = await rt.repo.findUserByEmail(email);
        if (!user || !(await this.hasher.verify(payload.password ?? '', user.passwordHash))) {
          return respond(401, {
            code: 'ERR_INVALID_CREDENTIALS',
            message: 'Invalid email or password.',
          });
        }
        const { token } = await rt.sessions.createSession(user.id, SESSION_TTL_MS);
        return respond(
          200,
          { userId: user.id, email: user.email, token },
          { 'set-cookie': sessionCookies(token, this.secureCookies(reqHeaders)) }
        );
      }

      // 4. Public Webhook Ingress (HMAC + Idempotency)
      const webhookMatch = pathname.match(/^\/api\/v1\/webhooks\/([^/]+)$/);
      if (req.method === 'POST' && webhookMatch) {
        const wf = await rt.repo.findWorkflow(webhookMatch[1]!);
        if (!wf || wf.activeVersion === null) {
          return respond(404, {
            code: 'ERR_WORKFLOW_NOT_PUBLISHED',
            message: 'Published workflow not found.',
          });
        }
        if (!wf.isActive) {
          return respond(409, {
            code: 'ERR_WORKFLOW_INACTIVE',
            message: 'This automation is turned off.',
          });
        }

        const idempotencyKey = reqHeaders['x-idempotency-key'];
        if (idempotencyKey) {
          const existing = await rt.execution.journal.findExecutionByIdempotencyKey(
            wf.workspaceId,
            wf.id,
            idempotencyKey
          );
          if (existing) {
            return respond(200, {
              executionId: existing.id,
              deduplicated: true,
              status: existing.status,
            });
          }
        }

        const encryptedSecret = await rt.repo.getWebhookSecret(wf.id);
        if (encryptedSecret) {
          const webhookSecret = await this.encryptionService.decrypt(encryptedSecret, wf.id);
          const rawSig =
            reqHeaders['x-hub-signature-256'] ?? reqHeaders['x-localflow-signature'] ?? '';
          const signature = rawSig.startsWith('sha256=') ? rawSig.slice('sha256='.length) : rawSig;
          const rawPayload =
            req.rawBody ??
            (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
          if (!verifyWebhookHmac(rawPayload, webhookSecret, signature)) {
            return respond(401, {
              code: 'ERR_WEBHOOK_HMAC_INVALID',
              message: 'Invalid webhook HMAC signature.',
            });
          }
        }

        const queued = await this.enqueueRun(
          rt,
          wf,
          'webhook',
          webhookPayload(req.body, reqHeaders['content-type'], req.rawBody),
          idempotencyKey
        );
        return respond(202, {
          executionId: queued.id,
          deduplicated: false,
          status: queued.status,
        });
      }

      // Authenticated routes below
      const auth = await this.authenticate(rt, reqHeaders);
      if (!auth) {
        return respond(401, { code: 'ERR_UNAUTHORIZED', message: 'Authentication required.' });
      }
      // A cookie is sent by the browser on its own, even for a request another site
      // started: changes must prove they come from our page (double-submit token).
      if (
        auth.viaCookie &&
        needsCsrf(req.method) &&
        !csrfMatches(parseCookies(reqHeaders['cookie'])[CSRF_COOKIE], reqHeaders[CSRF_HEADER])
      ) {
        return respond(403, {
          code: 'ERR_CSRF_INVALID',
          message: 'Missing or wrong CSRF token. Reload the page and try again.',
        });
      }
      if (typeof req.body === 'string') {
        return respond(400, {
          code: 'ERR_INVALID_JSON',
          message: 'Request body must be a JSON object.',
        });
      }

      // 4b. Who am I, sign out, what the server can run
      if (req.method === 'GET' && pathname === '/api/v1/me') {
        return respond(200, await rt.repo.getProfile(auth.userId));
      }
      if (req.method === 'POST' && pathname === '/api/v1/auth/logout') {
        await rt.sessions.deleteSession(auth.token);
        return respond(
          200,
          { ok: true },
          { 'set-cookie': clearedCookies(this.secureCookies(reqHeaders)) }
        );
      }
      if (req.method === 'GET' && pathname === '/api/v1/catalog') {
        return respond(200, rt.execution.catalog());
      }

      // 4c. Run history of a workspace (optionally one workflow), with steps
      const wsRunsMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/executions$/);
      if (req.method === 'GET' && wsRunsMatch) {
        const workspaceId = wsRunsMatch[1]!;
        await this.requireWorkspacePermission(
          rt,
          workspaceId,
          auth.userId,
          PERMISSIONS.EXECUTION_VIEW
        );
        const workflowId = urlObj.searchParams.get('workflowId') ?? undefined;
        if (workflowId && !isUuid(workflowId)) return respond(200, { executions: [] });
        const runs = await rt.repo.listRunsWithSteps(workspaceId, {
          workflowId,
          limit: Number(urlObj.searchParams.get('limit')) || 30,
        });
        return respond(200, { executions: redact(runs) });
      }

      // 4d. Remove a connection; check that a connection works
      const credItemMatch = pathname.match(
        /^\/api\/v1\/workspaces\/([^/]+)\/credentials\/([^/]+)(\/check)?$/
      );
      if (
        credItemMatch &&
        ((req.method === 'DELETE' && !credItemMatch[3]) ||
          (req.method === 'GET' && credItemMatch[3]))
      ) {
        const workspaceId = credItemMatch[1]!;
        await this.requireWorkspacePermission(
          rt,
          workspaceId,
          auth.userId,
          req.method === 'DELETE' ? PERMISSIONS.CREDENTIAL_DELETE : PERMISSIONS.CREDENTIAL_REFERENCE
        );
        const cred = await rt.repo.findCredential(credItemMatch[2]!);
        if (!cred || cred.workspaceId !== workspaceId) {
          return respond(404, { code: 'ERR_NOT_FOUND', message: 'Connection not found.' });
        }
        if (req.method === 'DELETE') {
          await rt.repo.deleteCredential(cred.id);
          return respond(200, { ok: true });
        }
        const secrets = await this.encryptionService.decryptJson<Record<string, unknown>>(
          cred.encryptedPayload,
          workspaceId
        );
        return respond(200, await this.checkConnection(cred.type, secrets));
      }

      // 5. Workspace Credentials Vault
      const credsMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/credentials$/);
      if (credsMatch) {
        const workspaceId = credsMatch[1]!;
        if (req.method === 'GET') {
          await this.requireWorkspacePermission(
            rt,
            workspaceId,
            auth.userId,
            PERMISSIONS.CREDENTIAL_VIEW_METADATA
          );
          const list = (await rt.repo.listCredentials(workspaceId)).map((c) => ({
            id: c.id,
            workspaceId: c.workspaceId,
            name: c.name,
            type: c.type,
            maskedHint: c.maskedHint,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
          }));
          return respond(200, { credentials: list });
        }
        if (req.method === 'POST') {
          await this.requireWorkspacePermission(
            rt,
            workspaceId,
            auth.userId,
            PERMISSIONS.CREDENTIAL_CREATE
          );
          const body = (req.body ?? {}) as {
            name?: unknown;
            type?: unknown;
            secrets?: Record<string, string>;
          };
          if (
            typeof body.name !== 'string' ||
            !body.name.trim() ||
            typeof body.type !== 'string' ||
            !body.type.trim()
          ) {
            return respond(400, {
              code: 'ERR_VALIDATION',
              message: 'Credential name and type are required.',
            });
          }
          const encrypted = await this.encryptionService.encryptJson(
            body.secrets ?? {},
            workspaceId
          );
          const firstSecretVal = Object.values(body.secrets ?? {})[0] ?? '';
          const now = new Date().toISOString();
          const { maskedHint } = sanitizeCredentialEntity(
            {
              id: '',
              workspaceId,
              name: body.name,
              type: body.type,
              createdAt: now,
              updatedAt: now,
            },
            firstSecretVal
          );
          const stored = await rt.repo.createCredential({
            workspaceId,
            name: body.name.trim(),
            type: body.type.trim(),
            encrypted,
            maskedHint,
            createdBy: auth.userId,
          });
          return respond(
            201,
            sanitizeCredentialEntity(
              {
                id: stored.id,
                workspaceId,
                name: stored.name,
                type: stored.type,
                createdAt: stored.createdAt,
                updatedAt: stored.updatedAt,
              },
              firstSecretVal
            )
          );
        }
      }

      // 5b. Connection check: which models a (local) model server can serve
      const credModelsMatch = pathname.match(
        /^\/api\/v1\/workspaces\/([^/]+)\/credentials\/([^/]+)\/models$/
      );
      if (req.method === 'GET' && credModelsMatch) {
        const [, workspaceId, credentialId] = credModelsMatch as unknown as [
          string,
          string,
          string,
        ];
        await this.requireWorkspacePermission(
          rt,
          workspaceId,
          auth.userId,
          PERMISSIONS.CREDENTIAL_REFERENCE
        );
        const cred = await rt.repo.findCredential(credentialId);
        if (!cred || cred.workspaceId !== workspaceId) {
          return respond(404, { code: 'ERR_NOT_FOUND', message: 'Connection not found.' });
        }
        const secrets = await this.encryptionService.decryptJson<Record<string, unknown>>(
          cred.encryptedPayload,
          workspaceId
        );
        try {
          const models = await listConnectionModels(cred.type, secrets, {
            httpClient: new SafeHttpClient(),
            ssrfAllowlist: this.config.ssrfAllowlist,
          });
          return respond(200, { ok: true, models });
        } catch (err) {
          return respond(502, {
            ok: false,
            code: 'ERR_CONNECTION_CHECK_FAILED',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 6. Workspace Workflows Collection
      const wsWorkflowsMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/workflows$/);
      if (wsWorkflowsMatch) {
        const workspaceId = wsWorkflowsMatch[1]!;
        if (req.method === 'GET') {
          await this.requireWorkspacePermission(
            rt,
            workspaceId,
            auth.userId,
            PERMISSIONS.WORKFLOW_VIEW
          );
          return respond(200, { workflows: await rt.repo.listWorkflows(workspaceId) });
        }
        if (req.method === 'POST') {
          await this.requireWorkspacePermission(
            rt,
            workspaceId,
            auth.userId,
            PERMISSIONS.WORKFLOW_CREATE
          );
          const body = (req.body ?? {}) as {
            name: string;
            description?: string;
            webhookSecret?: string;
            nodes?: WorkflowNode[];
            edges?: WorkflowEdge[];
          };
          const graph = DraftGraphSchema.safeParse({ nodes: body.nodes, edges: body.edges });
          if (!graph.success) return respond(400, this.graphValidationError(graph.error));
          const clientId = (body as { id?: unknown }).id;
          if (clientId !== undefined && (typeof clientId !== 'string' || !isUuid(clientId))) {
            return respond(400, {
              code: 'ERR_VALIDATION',
              message: 'A workflow id chosen by the client must be a UUID.',
              details: { field: 'id' },
            });
          }
          if (clientId && (await rt.repo.findWorkflow(clientId))) {
            return respond(409, { code: 'ERR_CONFLICT', message: 'This workflow id is taken.' });
          }
          const wf = await rt.repo.createWorkflow({
            id: clientId,
            workspaceId,
            name: body.name ?? 'Untitled Workflow',
            description: body.description ?? '',
            nodes: graph.data.nodes,
            edges: graph.data.edges,
            createdBy: auth.userId,
          });
          if (body.webhookSecret) {
            // Encrypted with the workflow id as AAD, so it is bound to this workflow.
            const encrypted = await this.encryptionService.encrypt(body.webhookSecret, wf.id);
            await rt.repo.setWebhookSecret(wf.id, encrypted);
            wf.hasWebhookSecret = true;
          }
          return respond(201, wf);
        }
      }

      // 7. Single Workflow Operations (Draft Update, Publish, Rollback, Execute)
      // What the RSS steps remember as already handed on; DELETE forgets it (all or ?nodeId=).
      const wfRssMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/rss-memory$/);
      if ((req.method === 'GET' || req.method === 'DELETE') && wfRssMatch) {
        const wf = await rt.repo.findWorkflow(wfRssMatch[1]!);
        if (!wf) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Workflow not found.' });
        await this.requireWorkspacePermission(
          rt,
          wf.workspaceId,
          auth.userId,
          req.method === 'GET' ? PERMISSIONS.WORKFLOW_VIEW : PERMISSIONS.WORKFLOW_EDIT
        );
        if (req.method === 'DELETE') {
          const nodeId = urlObj.searchParams.get('nodeId') || undefined;
          const removed = await resetRssMemory(rt.db, wf.id, nodeId);
          return respond(200, { removed, nodes: await rssMemory(rt.db, wf.id) });
        }
        return respond(200, { nodes: await rssMemory(rt.db, wf.id) });
      }

      const wfDraftMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/draft$/);
      if (req.method === 'PUT' && wfDraftMatch) {
        const wf = await rt.repo.findWorkflow(wfDraftMatch[1]!);
        if (!wf) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Workflow not found.' });
        await this.requireWorkspacePermission(
          rt,
          wf.workspaceId,
          auth.userId,
          PERMISSIONS.WORKFLOW_EDIT
        );
        const body = (req.body ?? {}) as { nodes?: unknown; edges?: unknown };
        if (!Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
          return respond(400, {
            code: 'ERR_VALIDATION',
            message: 'A draft must contain "nodes" and "edges" arrays; the saved draft was kept.',
          });
        }
        const graph = DraftGraphSchema.safeParse(body);
        if (!graph.success) return respond(400, this.graphValidationError(graph.error));
        const name = (req.body as { name?: unknown }).name;
        const updated = await rt.repo.updateDraft(
          wf.id,
          graph.data.nodes,
          graph.data.edges,
          typeof name === 'string' && name.trim() ? name.trim().slice(0, 255) : undefined
        );
        return respond(200, updated);
      }

      const wfPublishMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/publish$/);
      if (req.method === 'POST' && wfPublishMatch) {
        const wf = await rt.repo.findWorkflow(wfPublishMatch[1]!);
        if (!wf) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Workflow not found.' });
        await this.requireWorkspacePermission(
          rt,
          wf.workspaceId,
          auth.userId,
          PERMISSIONS.WORKFLOW_PUBLISH
        );

        const validation = validateWorkflowGraph(wf.draft.nodes, wf.draft.edges, {
          requireSingleTrigger: true,
        });
        if (!validation.valid) {
          return respond(422, {
            code: validation.errors[0]?.code ?? 'ERR_GRAPH_INVALID',
            message: validation.errors[0]?.message ?? 'Workflow graph validation failed.',
            errors: validation.errors,
          });
        }

        // A schedule or bot trigger that cannot work refuses the publish (422).
        await assertWorkflowTrigger(rt.db, wf.workspaceId, wf.draft.nodes);
        const snapshotNodes = structuredClone(wf.draft.nodes);
        const snapshotEdges = structuredClone(wf.draft.edges);
        const checksum = computeWorkflowChecksum({ nodes: snapshotNodes, edges: snapshotEdges });
        const versionSnapshot = await rt.repo.publishVersion({
          workflowId: wf.id,
          nodes: snapshotNodes,
          edges: snapshotEdges,
          checksum,
          publishedBy: auth.userId,
        });
        await syncWorkflowTriggers(rt.db, {
          workspaceId: wf.workspaceId,
          workflowId: wf.id,
          workflowVersionId: versionSnapshot.id,
          nodes: snapshotNodes,
          name: wf.name,
        });
        // Publishing is "turn on with this version" (also after a pause).
        await rt.repo.setWorkflowActive(wf.id, true);
        await setWorkflowTriggersEnabled(rt.db, wf.id, true);
        return respond(201, versionSnapshot);
      }

      const wfRollbackMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/rollback$/);
      if (req.method === 'POST' && wfRollbackMatch) {
        const wf = await rt.repo.findWorkflow(wfRollbackMatch[1]!);
        if (!wf) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Workflow not found.' });
        await this.requireWorkspacePermission(
          rt,
          wf.workspaceId,
          auth.userId,
          PERMISSIONS.WORKFLOW_ROLLBACK
        );
        const body = (req.body ?? {}) as { version: number };
        const targetSnap = wf.versions.find((v) => v.version === body.version);
        if (!targetSnap) {
          return respond(404, {
            code: 'ERR_VERSION_NOT_FOUND',
            message: 'Target version not found.',
          });
        }
        await assertWorkflowTrigger(rt.db, wf.workspaceId, targetSnap.nodes);
        await rt.repo.setActiveVersion(wf.id, targetSnap.id);
        await syncWorkflowTriggers(rt.db, {
          workspaceId: wf.workspaceId,
          workflowId: wf.id,
          workflowVersionId: targetSnap.id,
          nodes: targetSnap.nodes,
          name: wf.name,
        });
        return respond(200, {
          workflowId: wf.id,
          activeVersion: targetSnap.version,
          snapshot: targetSnap,
        });
      }

      // One workflow: read, delete
      const wfItemMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)$/);
      if (wfItemMatch && (req.method === 'GET' || req.method === 'DELETE')) {
        const wf = await rt.repo.findWorkflow(wfItemMatch[1]!);
        if (!wf) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Workflow not found.' });
        await this.requireWorkspacePermission(
          rt,
          wf.workspaceId,
          auth.userId,
          req.method === 'GET' ? PERMISSIONS.WORKFLOW_VIEW : PERMISSIONS.WORKFLOW_DELETE
        );
        if (req.method === 'DELETE') {
          await rt.repo.deleteWorkflow(wf.id);
          return respond(200, { ok: true });
        }
        return respond(200, { ...wf, triggers: await listWorkflowTriggers(rt.db, wf.id) });
      }

      // Turn a published workflow on or off (triggers and webhooks)
      const wfActiveMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/active$/);
      if (req.method === 'PUT' && wfActiveMatch) {
        const wf = await rt.repo.findWorkflow(wfActiveMatch[1]!);
        if (!wf) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Workflow not found.' });
        await this.requireWorkspacePermission(
          rt,
          wf.workspaceId,
          auth.userId,
          PERMISSIONS.WORKFLOW_PUBLISH
        );
        const active = (req.body as { active?: unknown }).active;
        if (typeof active !== 'boolean') {
          return respond(400, {
            code: 'ERR_VALIDATION',
            message: 'Send {"active": true} or {"active": false}.',
            details: { field: 'active' },
          });
        }
        if (active && wf.activeVersion === null) {
          return respond(400, {
            code: 'ERR_WORKFLOW_NOT_PUBLISHED',
            message: 'Publish the workflow to turn it on.',
          });
        }
        await rt.repo.setWorkflowActive(wf.id, active);
        await setWorkflowTriggersEnabled(rt.db, wf.id, active);
        return respond(200, { workflowId: wf.id, isActive: active });
      }

      // Test the draft (or a graph sent by the editor) with real steps, unrecorded
      const wfTestMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/test-run$/);
      if (req.method === 'POST' && wfTestMatch) {
        const wf = await rt.repo.findWorkflow(wfTestMatch[1]!);
        if (!wf) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Workflow not found.' });
        await this.requireWorkspacePermission(
          rt,
          wf.workspaceId,
          auth.userId,
          PERMISSIONS.WORKFLOW_EXECUTE
        );
        const body = (req.body ?? {}) as {
          nodes?: unknown;
          edges?: unknown;
          payload?: unknown;
          untilNodeId?: unknown;
        };
        const graph = DraftGraphSchema.safeParse(
          body.nodes !== undefined ? { nodes: body.nodes, edges: body.edges } : wf.draft
        );
        if (!graph.success) return respond(400, this.graphValidationError(graph.error));
        let { nodes, edges } = graph.data;
        const validation = validateWorkflowGraph(nodes, edges, { requireSingleTrigger: true });
        if (!validation.valid) {
          return respond(422, {
            code: validation.errors[0]?.code ?? 'ERR_GRAPH_INVALID',
            message: validation.errors[0]?.message ?? 'Workflow graph validation failed.',
            errors: validation.errors,
          });
        }
        if (typeof body.untilNodeId === 'string') {
          // Only that step and the steps it depends on.
          const keep = new Set([body.untilNodeId]);
          for (let grew = true; grew;) {
            grew = false;
            for (const e of edges) {
              if (keep.has(e.target) && !keep.has(e.source)) {
                keep.add(e.source);
                grew = true;
              }
            }
          }
          nodes = nodes.filter((n) => keep.has(n.id));
          edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
        }
        const result = await rt.execution.testRun(
          {
            id: wf.id,
            workspaceId: wf.workspaceId,
            name: wf.name,
            schemaVersion: '1.0',
            nodes,
            edges,
            executionPolicy: { executionTimeoutMs: 120_000, maxConcurrency: 1 },
          },
          body.payload ?? {}
        );
        return respond(200, {
          execution: redact({
            status: result.execution.status,
            errorMessage: result.execution.errorMessage ?? null,
            errorNodeId: result.execution.errorNodeId ?? null,
            durationMs: result.durationMs,
            resumeAt: result.suspension?.resumeAt.toISOString() ?? null,
          }),
          steps: redact(
            result.stepRecords.map((st) => ({
              nodeId: st.nodeId,
              nodeType: st.nodeType,
              status: st.status,
              inputPayload: st.inputPayload ?? null,
              outputPayload: st.outputPayload ?? null,
              errorMessage: st.errorMessage ?? null,
              durationMs: st.durationMs ?? null,
            }))
          ),
        });
      }

      // Schedule / Telegram trigger of the live version: next run, last run, errors, pause.
      const wfTriggersMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/triggers$/);
      if ((req.method === 'GET' || req.method === 'PUT') && wfTriggersMatch) {
        const wf = await rt.repo.findWorkflow(wfTriggersMatch[1]!);
        if (!wf) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Workflow not found.' });
        if (req.method === 'PUT') {
          await this.requireWorkspacePermission(
            rt,
            wf.workspaceId,
            auth.userId,
            PERMISSIONS.WORKFLOW_PUBLISH
          );
          const body = (req.body ?? {}) as { enabled?: unknown };
          if (typeof body.enabled !== 'boolean') {
            return respond(400, {
              code: 'ERR_VALIDATION',
              message: 'Send {"enabled": true} to resume or {"enabled": false} to pause.',
              details: { field: 'enabled' },
            });
          }
          await setWorkflowTriggersEnabled(rt.db, wf.id, body.enabled);
        } else {
          await this.requireWorkspacePermission(
            rt,
            wf.workspaceId,
            auth.userId,
            PERMISSIONS.WORKFLOW_VIEW
          );
        }
        return respond(200, { triggers: await listWorkflowTriggers(rt.db, wf.id) });
      }

      const wfExecuteMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/execute$/);
      if (req.method === 'POST' && wfExecuteMatch) {
        const wf = await rt.repo.findWorkflow(wfExecuteMatch[1]!);
        if (!wf) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Workflow not found.' });
        await this.requireWorkspacePermission(
          rt,
          wf.workspaceId,
          auth.userId,
          PERMISSIONS.WORKFLOW_EXECUTE
        );
        if (wf.activeVersion === null) {
          return respond(400, {
            code: 'ERR_WORKFLOW_NOT_PUBLISHED',
            message: 'Publish the workflow before executing.',
          });
        }
        const body = (req.body ?? {}) as {
          payload?: Record<string, unknown>;
          wait?: boolean;
          waitTimeoutMs?: number;
        };
        const queued = await this.enqueueRun(rt, wf, 'manual', body.payload ?? {});
        if (!body.wait) {
          return respond(202, { execution: queued, steps: [] });
        }
        // Test runs from the editor want the result; the run itself still goes through
        // the queue and the worker exactly like any other run.
        const settled = await this.waitForRun(
          rt,
          queued.id,
          Math.min(Math.max(Number(body.waitTimeoutMs) || 30_000, 0), 120_000)
        );
        const steps = await this.findSteps(rt, queued.id);
        return respond(SETTLED_STATUSES.has(settled.status) ? 200 : 202, {
          execution: settled,
          steps,
        });
      }

      // 8. Execution Inspection, Cancellation & SSE Stream
      const execEventsMatch = pathname.match(/^\/api\/v1\/executions\/([^/]+)\/events$/);
      if (req.method === 'GET' && execEventsMatch) {
        const exec = await this.findExecution(rt, execEventsMatch[1]!);
        if (!exec) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Execution not found.' });
        await this.requireWorkspacePermission(
          rt,
          exec.workspaceId,
          auth.userId,
          PERMISSIONS.EXECUTION_VIEW
        );
        const sseBody = LocalFlowApiServer.formatSseStream(await this.buildSseEvents(rt, exec));
        return respond(200, sseBody, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
      }

      const execCancelMatch = pathname.match(/^\/api\/v1\/executions\/([^/]+)\/cancel$/);
      if (req.method === 'POST' && execCancelMatch) {
        const executionId = execCancelMatch[1]!;
        const exec = await this.findExecution(rt, executionId);
        if (!exec) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Execution not found.' });
        await this.requireWorkspacePermission(
          rt,
          exec.workspaceId,
          auth.userId,
          PERMISSIONS.WORKFLOW_CANCEL
        );
        if (!CANCELLABLE_STATUSES.has(exec.status)) {
          return respond(409, {
            code: 'ERR_EXECUTION_FINISHED',
            message: `This run has already finished with status ${exec.status}; it cannot be cancelled.`,
            status: exec.status,
          });
        }
        // The worker running it sees this on its next heartbeat and stops between steps;
        // a WAITING or QUEUED run is simply never resumed.
        const updated = await rt.execution.journal.updateExecution(executionId, {
          status: 'CANCELLED',
        });
        return respond(200, { execution: updated });
      }

      // A person's answer to an “Approval” step: the run goes on (approved) or the steps
      // below it are skipped (rejected). Either way the run resumes now.
      const execApprovalMatch = pathname.match(/^\/api\/v1\/executions\/([^/]+)\/approval$/);
      if (req.method === 'POST' && execApprovalMatch) {
        const executionId = execApprovalMatch[1]!;
        const exec = await this.findExecution(rt, executionId);
        if (!exec) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Execution not found.' });
        await this.requireWorkspacePermission(
          rt,
          exec.workspaceId,
          auth.userId,
          PERMISSIONS.WORKFLOW_EXECUTE
        );
        const decision = (req.body as { decision?: unknown } | undefined)?.decision;
        if (decision !== 'approved' && decision !== 'rejected') {
          return respond(400, {
            code: 'ERR_VALIDATION',
            message: 'decision must be "approved" or "rejected".',
          });
        }
        const nodeId = exec.metadata?.waitingNodeId;
        const decided =
          exec.status === 'WAITING' &&
          typeof nodeId === 'string' &&
          (await decideApproval(rt.execution.journal, executionId, nodeId, decision, auth.userId));
        if (!decided) {
          return respond(409, {
            code: 'ERR_NOT_WAITING_FOR_APPROVAL',
            message: 'This run is not waiting for an approval (it was decided or has finished).',
            status: exec.status,
          });
        }
        await resumeDecidedRun(rt.queue, exec);
        return respond(202, { executionId, decision });
      }

      const execGetMatch = pathname.match(/^\/api\/v1\/executions\/([^/]+)$/);
      if (req.method === 'GET' && execGetMatch) {
        const executionId = execGetMatch[1]!;
        const exec = await this.findExecution(rt, executionId);
        if (!exec) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Execution not found.' });
        await this.requireWorkspacePermission(
          rt,
          exec.workspaceId,
          auth.userId,
          PERMISSIONS.EXECUTION_VIEW
        );
        return respond(200, { execution: exec, steps: await this.findSteps(rt, executionId) });
      }

      return respond(404, {
        code: 'ERR_ROUTE_NOT_FOUND',
        message: `Route ${req.method} ${pathname} not found.`,
      });
    } catch (err) {
      if (err instanceof AlreadyBootstrappedError) {
        return respond(409, { code: 'ERR_ALREADY_BOOTSTRAPPED', message: err.message });
      }
      if (err instanceof ForbiddenError) {
        return respond(403, { code: 'ERR_FORBIDDEN', message: err.message });
      }
      if (err instanceof LocalFlowError && err.statusCode >= 400 && err.statusCode < 500) {
        return respond(err.statusCode, {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        });
      }
      const message = err instanceof Error ? err.message : String(err);
      return respond(500, { code: 'ERR_INTERNAL', message });
    }
  }

  private graphValidationError(error: z.ZodError): Record<string, unknown> {
    const first = error.issues[0];
    return {
      code: 'ERR_VALIDATION',
      message: first
        ? `Invalid workflow graph at ${first.path.join('.') || 'body'}: ${first.message}`
        : 'Invalid workflow graph.',
      issues: error.issues
        .slice(0, 20)
        .map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }

  /** "Check connection": asks the service something harmless with the saved secrets. */
  private async checkConnection(
    type: string,
    secrets: Record<string, unknown>
  ): Promise<{ ok: boolean; message: string; models?: string[]; tools?: string[] }> {
    const http = new SafeHttpClient();
    try {
      if (type === 'telegram' || type === 'core.telegramBot') {
        const token = String(secrets.botToken ?? '');
        if (!token) return { ok: false, message: 'The connection has no bot token.' };
        const res = await http.request<{ ok?: boolean; result?: { username?: string } }>({
          url: `${this.config.telegramApiBase.replace(/\/+$/, '')}/bot${token}/getMe`,
          allowlist: this.config.ssrfAllowlist,
        });
        const body = typeof res.data === 'object' && res.data ? res.data : {};
        return body.ok && body.result?.username
          ? { ok: true, message: `@${body.result.username}` }
          : { ok: false, message: 'Telegram rejected the bot token.' };
      }
      if (type === 'mcp') {
        const tools = await listMcpTools(secrets, http, this.config.ssrfAllowlist);
        const names = tools.map((t) => t.name);
        return {
          ok: true,
          message: `${names.length} tools${names.length ? `: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ', …' : ''}` : ''}`,
          tools: names,
        };
      }
      if (['openai', 'ai.openai', 'ollama', 'ai.ollama', 'openai-compatible'].includes(type)) {
        const models = await listConnectionModels(type, secrets, {
          httpClient: http,
          ssrfAllowlist: this.config.ssrfAllowlist,
        });
        return { ok: true, message: `${models.length} models`, models };
      }
      return { ok: true, message: 'Saved. This kind of connection cannot be checked in advance.' };
    } catch (err) {
      // Secrets (and an MCP URL, which may carry a key) never come back in the message.
      let message = err instanceof Error ? err.message : String(err);
      for (const key of ['botToken', 'apiKey', 'token', 'url']) {
        const v = typeof secrets[key] === 'string' ? (secrets[key] as string) : '';
        if (v.length >= 6) message = message.split(v).join('***');
      }
      return { ok: false, message };
    }
  }

  private async findExecution(
    rt: ApiRuntime,
    executionId: string
  ): Promise<JournalExecutionRecord | undefined> {
    return isUuid(executionId) ? rt.execution.journal.findExecutionById(executionId) : undefined;
  }

  /** Steps in the order they ran (the journal returns them unordered). */
  private async findSteps(
    rt: ApiRuntime,
    executionId: string
  ): Promise<JournalNodeExecutionRecord[]> {
    const time = (d?: Date | null) => (d ? new Date(d).getTime() : Number.MAX_SAFE_INTEGER);
    return (await rt.execution.journal.findNodeExecutions(executionId)).sort(
      (a, b) => time(a.startedAt) - time(b.startedAt) || time(a.createdAt) - time(b.createdAt)
    );
  }

  /** Rebuilds the event stream from the persisted journal, so it survives restarts. */
  private async buildSseEvents(
    rt: ApiRuntime,
    exec: JournalExecutionRecord
  ): Promise<SseEventMessage[]> {
    const version = await rt.repo.findVersionById(exec.workflowVersionId);
    const steps = await this.findSteps(rt, exec.id);
    return [
      {
        event: 'execution.started',
        data: { executionId: exec.id, workflowId: exec.workflowId, version: version?.version },
      },
      ...steps.map((s) => ({
        event: `step.${s.status.toLowerCase()}`,
        data: {
          executionId: exec.id,
          nodeId: s.nodeId,
          status: s.status,
          outputPayload: s.outputPayload,
          errorMessage: s.errorMessage,
        },
      })),
      {
        event: `execution.${exec.status.toLowerCase()}`,
        data: { executionId: exec.id, status: exec.status },
      },
    ];
  }

  private async enqueueRun(
    rt: ApiRuntime,
    wf: StoredWorkflow,
    triggerType: 'manual' | 'cron' | 'webhook' | 'telegram_polling',
    triggerPayload: Record<string, unknown>,
    idempotencyKey?: string
  ): Promise<JournalExecutionRecord> {
    const versionSnap = wf.versions.find((v) => v.version === wf.activeVersion);
    if (!versionSnap) {
      throw new Error(`Published version ${wf.activeVersion} not found.`);
    }
    return rt.execution.enqueue(rt.queue, {
      workspaceId: wf.workspaceId,
      workflowId: wf.id,
      workflowVersionId: versionSnap.id,
      triggerType,
      triggerPayload,
      idempotencyKey,
    });
  }

  /** Polls the journal until the run settles or `timeoutMs` passes. */
  private async waitForRun(
    rt: ApiRuntime,
    executionId: string,
    timeoutMs: number
  ): Promise<JournalExecutionRecord> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const exec = (await rt.execution.journal.findExecutionById(executionId))!;
      if (SETTLED_STATUSES.has(exec.status) || Date.now() >= deadline) return exec;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  public async listen(port = this.config.port, host = this.config.host): Promise<number> {
    await this.ready();
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const rawBody = Buffer.concat(chunks).toString('utf8');
        let parsedBody: unknown = undefined;
        if (rawBody) {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            parsedBody = rawBody;
          }
        }
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string') headers[k] = v;
        }
        const response = await this.inject({
          method: (req.method ?? 'GET') as InjectRequest['method'],
          url: req.url ?? '/',
          headers,
          body: parsedBody,
          rawBody,
        });
        res.writeHead(response.statusCode, response.headers);
        res.end(response.rawBody);
      });
      this.httpServer.once('error', reject);
      this.httpServer.listen(port, host, () => {
        const addr = this.httpServer?.address();
        const boundPort = typeof addr === 'object' && addr ? addr.port : port;
        resolve(boundPort);
      });
    });
  }

  public async close(): Promise<void> {
    if (this.httpServer) {
      const server = this.httpServer;
      this.httpServer = undefined;
      // listen() can fail (occupied port, OS policy). Still stop the worker and
      // release the database below; close() on a non-listening server rejects.
      if (server.listening) {
        await new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve()))
        );
      }
    }
    const rt = this.runtime ?? (await this.initPromise?.catch(() => undefined));
    if (rt) {
      this.runtime = undefined;
      this.initPromise = undefined;
      await rt.worker?.stop();
      await rt.queue.closeAll();
      await closeDb(rt.db);
    }
  }
}
