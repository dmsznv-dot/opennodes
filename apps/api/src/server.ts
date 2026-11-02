import http from 'node:http';
import crypto from 'node:crypto';
import {
  AesGcmEncryptionService,
  AlreadyBootstrappedError,
  BootstrapService,
  EnvKeyProvider,
  ForbiddenError,
  MemorySessionStore,
  PERMISSIONS,
  RbacPolicyEngine,
  ScryptPasswordHasher,
  sanitizeCredentialEntity,
  type EncryptedData,
  type Permission,
  type Role,
} from '@localflow/auth';
import { redact } from '@localflow/observability';
import {
  computeWorkflowChecksum,
  validateWorkflowGraph,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from '@localflow/workflow-schema';
import {
  InMemoryExecutionJournal,
  SimpleCancellationToken,
  WorkflowEngine,
  type WorkflowExecutionSummary,
  type JournalNodeExecutionRecord,
} from '@localflow/workflow-engine';
import { verifyWebhookHmac } from '@localflow/connectors-core';
import { loadApiConfig, type ApiConfig } from './config.js';

export interface InjectRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface InjectResponse<T = unknown> {
  statusCode: number;
  headers: Record<string, string>;
  body: T;
  rawBody: string;
}

export interface WorkflowVersionSnapshot {
  version: number;
  workflowId: string;
  checksum: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  publishedAt: string;
  publishedBy: string;
}

export interface StoredWorkflow {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  webhookSecret?: string;
  draft: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    updatedAt: string;
  };
  activeVersion: number | null;
  versions: WorkflowVersionSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface StoredCredential {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  encryptedPayload: EncryptedData;
  maskedHint: string;
  createdAt: string;
  updatedAt: string;
}

export interface SseEventMessage {
  event: string;
  data: Record<string, unknown>;
}

export class LocalFlowApiServer {
  private readonly config: ApiConfig;
  private readonly hasher = new ScryptPasswordHasher();
  private readonly sessionStore = new MemorySessionStore();
  private readonly encryptionService: AesGcmEncryptionService;
  private readonly bootstrapService: BootstrapService;
  private readonly journal = new InMemoryExecutionJournal();
  private readonly engine: WorkflowEngine;

  private bootstrapped = false;
  private readonly users = new Map<
    string,
    { id: string; email: string; passwordHash: string; fullName?: string }
  >();
  private readonly workspaces = new Map<string, { id: string; name: string; slug: string }>();
  private readonly memberships = new Map<string, Map<string, Role>>(); // workspaceId -> (userId -> Role)
  private readonly workflows = new Map<string, StoredWorkflow>();
  private readonly credentials = new Map<string, StoredCredential>();
  private readonly webhookIdempotencyKeys = new Map<string, string>(); // key -> executionId
  private readonly cancellationTokens = new Map<string, SimpleCancellationToken>();
  private readonly executionEvents = new Map<string, SseEventMessage[]>();
  private httpServer?: http.Server;

  constructor(config?: Partial<ApiConfig>) {
    this.config = { ...loadApiConfig(), ...config };
    const keyProvider = new EnvKeyProvider(this.config.encryptionKey, 1);
    this.encryptionService = new AesGcmEncryptionService(keyProvider);

    this.bootstrapService = new BootstrapService(
      {
        isSystemBootstrapped: async () => this.bootstrapped,
        createOwnerAndWorkspace: async (input) => {
          const userId = `usr_${crypto.randomUUID().slice(0, 8)}`;
          const workspaceId = `ws_${crypto.randomUUID().slice(0, 8)}`;
          const slug =
            input.workspaceName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '') || 'primary';

          this.users.set(userId, {
            id: userId,
            email: input.email,
            passwordHash: input.passwordHash,
            fullName: input.fullName,
          });
          this.workspaces.set(workspaceId, {
            id: workspaceId,
            name: input.workspaceName,
            slug,
          });
          const wsMembers = new Map<string, Role>();
          wsMembers.set(userId, 'OWNER');
          this.memberships.set(workspaceId, wsMembers);
          this.bootstrapped = true;

          return {
            userId,
            email: input.email,
            workspaceId,
            workspaceName: input.workspaceName,
            role: 'OWNER',
          };
        },
      },
      this.hasher
    );

    this.engine = new WorkflowEngine({ journal: this.journal });
  }

  public grantWorkspaceRole(workspaceId: string, userId: string, role: Role): void {
    let wsMembers = this.memberships.get(workspaceId);
    if (!wsMembers) {
      wsMembers = new Map<string, Role>();
      this.memberships.set(workspaceId, wsMembers);
    }
    wsMembers.set(userId, role);
  }

  public async createTestUser(
    email: string,
    password: string
  ): Promise<{ userId: string; token: string }> {
    const userId = `usr_${crypto.randomUUID().slice(0, 8)}`;
    const passwordHash = await this.hasher.hash(password);
    this.users.set(userId, { id: userId, email: email.toLowerCase(), passwordHash });
    const { token } = await this.sessionStore.createSession(userId);
    return { userId, token };
  }

  public getRawEncryptedCredential(credentialId: string): EncryptedData | undefined {
    return this.credentials.get(credentialId)?.encryptedPayload;
  }

  public static formatSseStream(events: SseEventMessage[]): string {
    return events
      .map((evt) => `event: ${evt.event}\ndata: ${JSON.stringify(redact(evt.data))}\n\n`)
      .join('');
  }

  private async authenticate(headers: Record<string, string>): Promise<{ userId: string } | null> {
    const authHeader = headers['authorization'] ?? headers['Authorization'];
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice('Bearer '.length).trim();
    const session = await this.sessionStore.validateSession(token);
    if (!session) return null;
    return { userId: session.userId };
  }

  private requireWorkspacePermission(
    workspaceId: string,
    userId: string,
    permission: Permission
  ): Role {
    const role = this.memberships.get(workspaceId)?.get(userId);
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
      customHeaders?: Record<string, string>
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
      if (req.method === 'GET' && pathname === '/health/ready') {
        return respond(200, {
          status: 'ready',
          checks: { database: 'healthy', redis: 'healthy' },
          bootstrapped: this.bootstrapped,
        });
      }

      // 2. Setup & Bootstrap
      if (req.method === 'GET' && pathname === '/api/v1/setup/status') {
        return respond(200, { bootstrapped: await this.bootstrapService.isBootstrapped() });
      }
      if (req.method === 'POST' && pathname === '/api/v1/setup') {
        const payload = (req.body ?? {}) as {
          email?: string;
          password?: string;
          fullName?: string;
          workspaceName?: string;
        };
        const result = await this.bootstrapService.bootstrapOwner({
          email: payload.email ?? '',
          password: payload.password ?? '',
          fullName: payload.fullName,
          workspaceName: payload.workspaceName,
        });
        const { token } = await this.sessionStore.createSession(result.userId);
        return respond(201, { ...result, token });
      }

      // 3. Auth Login
      if (req.method === 'POST' && pathname === '/api/v1/auth/login') {
        const payload = (req.body ?? {}) as { email?: string; password?: string };
        const email = (payload.email ?? '').trim().toLowerCase();
        const user = [...this.users.values()].find((u) => u.email === email);
        if (!user || !(await this.hasher.verify(payload.password ?? '', user.passwordHash))) {
          return respond(401, {
            code: 'ERR_INVALID_CREDENTIALS',
            message: 'Invalid email or password.',
          });
        }
        const { token } = await this.sessionStore.createSession(user.id);
        return respond(200, { userId: user.id, email: user.email, token });
      }

      // 4. Public Webhook Ingress (HMAC + Idempotency)
      const webhookMatch = pathname.match(/^\/api\/v1\/webhooks\/([^/]+)$/);
      if (req.method === 'POST' && webhookMatch) {
        const workflowId = webhookMatch[1]!;
        const wf = this.workflows.get(workflowId);
        if (!wf || wf.activeVersion === null) {
          return respond(404, {
            code: 'ERR_WORKFLOW_NOT_PUBLISHED',
            message: 'Published workflow not found.',
          });
        }

        const idempotencyKey = reqHeaders['x-idempotency-key'];
        if (idempotencyKey) {
          const dedupKey = `${workflowId}:${idempotencyKey}`;
          const existingExecId = this.webhookIdempotencyKeys.get(dedupKey);
          if (existingExecId) {
            return respond(200, {
              executionId: existingExecId,
              deduplicated: true,
              status: 'SUCCEEDED',
            });
          }
        }

        if (wf.webhookSecret) {
          const rawSig =
            reqHeaders['x-hub-signature-256'] ?? reqHeaders['x-localflow-signature'] ?? '';
          const signature = rawSig.startsWith('sha256=') ? rawSig.slice('sha256='.length) : rawSig;
          const rawPayload =
            typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
          if (!verifyWebhookHmac(rawPayload, wf.webhookSecret, signature)) {
            return respond(401, {
              code: 'ERR_WEBHOOK_HMAC_INVALID',
              message: 'Invalid webhook HMAC signature.',
            });
          }
        }

        const execRecord = await this.runPublishedWorkflow(
          wf,
          'webhook',
          (req.body as Record<string, unknown>) ?? {}
        );
        if (idempotencyKey) {
          this.webhookIdempotencyKeys.set(`${workflowId}:${idempotencyKey}`, execRecord.id);
        }
        return respond(202, {
          executionId: execRecord.id,
          deduplicated: false,
          status: execRecord.status,
        });
      }

      // Authenticated routes below
      const auth = await this.authenticate(reqHeaders);
      if (!auth) {
        return respond(401, { code: 'ERR_UNAUTHORIZED', message: 'Authentication required.' });
      }

      // 5. Workspace Credentials Vault
      const credsMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/credentials$/);
      if (credsMatch) {
        const workspaceId = credsMatch[1]!;
        if (req.method === 'GET') {
          this.requireWorkspacePermission(
            workspaceId,
            auth.userId,
            PERMISSIONS.CREDENTIAL_VIEW_METADATA
          );
          const list = [...this.credentials.values()]
            .filter((c) => c.workspaceId === workspaceId)
            .map((c) => ({
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
          this.requireWorkspacePermission(workspaceId, auth.userId, PERMISSIONS.CREDENTIAL_CREATE);
          const body = (req.body ?? {}) as {
            name: string;
            type: string;
            secrets: Record<string, string>;
          };
          const id = `cred_${crypto.randomUUID().slice(0, 8)}`;
          const now = new Date().toISOString();
          const encryptedPayload = await this.encryptionService.encryptJson(
            body.secrets ?? {},
            workspaceId
          );
          const firstSecretVal = Object.values(body.secrets ?? {})[0] ?? '';
          const sanitized = sanitizeCredentialEntity(
            { id, workspaceId, name: body.name, type: body.type, createdAt: now, updatedAt: now },
            firstSecretVal
          );
          this.credentials.set(id, {
            id,
            workspaceId,
            name: body.name,
            type: body.type,
            encryptedPayload,
            maskedHint: sanitized.maskedHint,
            createdAt: now,
            updatedAt: now,
          });
          return respond(201, sanitized);
        }
      }

      // 6. Workspace Workflows Collection
      const wsWorkflowsMatch = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/workflows$/);
      if (wsWorkflowsMatch) {
        const workspaceId = wsWorkflowsMatch[1]!;
        if (req.method === 'GET') {
          this.requireWorkspacePermission(workspaceId, auth.userId, PERMISSIONS.WORKFLOW_VIEW);
          const list = [...this.workflows.values()].filter((w) => w.workspaceId === workspaceId);
          return respond(200, { workflows: list });
        }
        if (req.method === 'POST') {
          this.requireWorkspacePermission(workspaceId, auth.userId, PERMISSIONS.WORKFLOW_CREATE);
          const body = (req.body ?? {}) as {
            name: string;
            description?: string;
            webhookSecret?: string;
            nodes?: WorkflowNode[];
            edges?: WorkflowEdge[];
          };
          const id = `wf_${crypto.randomUUID().slice(0, 8)}`;
          const now = new Date().toISOString();
          const wf: StoredWorkflow = {
            id,
            workspaceId,
            name: body.name ?? 'Untitled Workflow',
            description: body.description ?? '',
            webhookSecret: body.webhookSecret,
            draft: {
              nodes: body.nodes ?? [],
              edges: body.edges ?? [],
              updatedAt: now,
            },
            activeVersion: null,
            versions: [],
            createdAt: now,
            updatedAt: now,
          };
          this.workflows.set(id, wf);
          return respond(201, wf);
        }
      }

      // 7. Single Workflow Operations (Draft Update, Publish, Rollback, Execute)
      const wfDraftMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/draft$/);
      if (req.method === 'PUT' && wfDraftMatch) {
        const wf = this.workflows.get(wfDraftMatch[1]!);
        if (!wf) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Workflow not found.' });
        this.requireWorkspacePermission(wf.workspaceId, auth.userId, PERMISSIONS.WORKFLOW_EDIT);
        const body = (req.body ?? {}) as { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
        const now = new Date().toISOString();
        wf.draft = {
          nodes: structuredClone(body.nodes ?? []),
          edges: structuredClone(body.edges ?? []),
          updatedAt: now,
        };
        wf.updatedAt = now;
        return respond(200, wf);
      }

      const wfPublishMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/publish$/);
      if (req.method === 'POST' && wfPublishMatch) {
        const wf = this.workflows.get(wfPublishMatch[1]!);
        if (!wf) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Workflow not found.' });
        this.requireWorkspacePermission(wf.workspaceId, auth.userId, PERMISSIONS.WORKFLOW_PUBLISH);

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

        const nextVersion = wf.versions.length + 1;
        const snapshotNodes = structuredClone(wf.draft.nodes);
        const snapshotEdges = structuredClone(wf.draft.edges);
        const checksum = computeWorkflowChecksum({ nodes: snapshotNodes, edges: snapshotEdges });
        const versionSnapshot: WorkflowVersionSnapshot = {
          version: nextVersion,
          workflowId: wf.id,
          checksum,
          nodes: snapshotNodes,
          edges: snapshotEdges,
          publishedAt: new Date().toISOString(),
          publishedBy: auth.userId,
        };
        wf.versions.push(versionSnapshot);
        wf.activeVersion = nextVersion;
        wf.updatedAt = versionSnapshot.publishedAt;
        return respond(201, versionSnapshot);
      }

      const wfRollbackMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/rollback$/);
      if (req.method === 'POST' && wfRollbackMatch) {
        const wf = this.workflows.get(wfRollbackMatch[1]!);
        if (!wf) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Workflow not found.' });
        this.requireWorkspacePermission(wf.workspaceId, auth.userId, PERMISSIONS.WORKFLOW_ROLLBACK);
        const body = (req.body ?? {}) as { version: number };
        const targetSnap = wf.versions.find((v) => v.version === body.version);
        if (!targetSnap) {
          return respond(404, {
            code: 'ERR_VERSION_NOT_FOUND',
            message: 'Target version not found.',
          });
        }
        wf.activeVersion = targetSnap.version;
        wf.updatedAt = new Date().toISOString();
        return respond(200, {
          workflowId: wf.id,
          activeVersion: wf.activeVersion,
          snapshot: targetSnap,
        });
      }

      const wfExecuteMatch = pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/execute$/);
      if (req.method === 'POST' && wfExecuteMatch) {
        const wf = this.workflows.get(wfExecuteMatch[1]!);
        if (!wf) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Workflow not found.' });
        this.requireWorkspacePermission(wf.workspaceId, auth.userId, PERMISSIONS.WORKFLOW_EXECUTE);
        if (wf.activeVersion === null) {
          return respond(400, {
            code: 'ERR_WORKFLOW_NOT_PUBLISHED',
            message: 'Publish the workflow before executing.',
          });
        }
        const body = (req.body ?? {}) as { payload?: Record<string, unknown> };
        const record = await this.runPublishedWorkflow(wf, 'manual', body.payload ?? {});
        const steps = await this.journal.findNodeExecutions(record.id);
        return respond(200, { execution: record, steps });
      }

      // 8. Execution Inspection, Cancellation & SSE Stream
      const execEventsMatch = pathname.match(/^\/api\/v1\/executions\/([^/]+)\/events$/);
      if (req.method === 'GET' && execEventsMatch) {
        const executionId = execEventsMatch[1]!;
        const events = this.executionEvents.get(executionId) ?? [];
        const sseBody = LocalFlowApiServer.formatSseStream(events);
        return respond(200, sseBody, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
      }

      const execCancelMatch = pathname.match(/^\/api\/v1\/executions\/([^/]+)\/cancel$/);
      if (req.method === 'POST' && execCancelMatch) {
        const executionId = execCancelMatch[1]!;
        const exec = await this.journal.findExecutionById(executionId);
        if (!exec) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Execution not found.' });
        this.requireWorkspacePermission(exec.workspaceId, auth.userId, PERMISSIONS.WORKFLOW_CANCEL);
        this.cancellationTokens.get(executionId)?.cancel();
        const updated = await this.journal.updateExecution(executionId, { status: 'CANCELLED' });
        return respond(200, { execution: updated });
      }

      const execGetMatch = pathname.match(/^\/api\/v1\/executions\/([^/]+)$/);
      if (req.method === 'GET' && execGetMatch) {
        const executionId = execGetMatch[1]!;
        const exec = await this.journal.findExecutionById(executionId);
        if (!exec) return respond(404, { code: 'ERR_NOT_FOUND', message: 'Execution not found.' });
        this.requireWorkspacePermission(exec.workspaceId, auth.userId, PERMISSIONS.EXECUTION_VIEW);
        const steps = await this.journal.findNodeExecutions(executionId);
        return respond(200, { execution: exec, steps });
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
      const message = err instanceof Error ? err.message : String(err);
      return respond(500, { code: 'ERR_INTERNAL', message });
    }
  }

  private async runPublishedWorkflow(
    wf: StoredWorkflow,
    triggerType: 'manual' | 'cron' | 'webhook' | 'telegram_polling',
    triggerPayload: Record<string, unknown>
  ): Promise<WorkflowExecutionSummary> {
    const versionSnap = wf.versions.find((v) => v.version === wf.activeVersion);
    if (!versionSnap) {
      throw new Error(`Published version ${wf.activeVersion} not found.`);
    }

    const definition: WorkflowDefinition = {
      id: wf.id,
      workspaceId: wf.workspaceId,
      name: wf.name,
      schemaVersion: '1.0',
      nodes: versionSnap.nodes,
      edges: versionSnap.edges,
      executionPolicy: { executionTimeoutMs: 60_000, maxConcurrency: 10 },
    };

    const token = new SimpleCancellationToken();
    const runResult = await this.engine.executeWorkflow(definition, {
      workflowVersionId: `${wf.id}_v${versionSnap.version}`,
      triggerType,
      triggerPayload,
      cancellationToken: token,
      journal: this.journal,
    });

    const record = runResult.execution;
    this.cancellationTokens.set(record.id, token);

    const steps: JournalNodeExecutionRecord[] = await this.journal.findNodeExecutions(record.id);
    const sseEvents: SseEventMessage[] = [
      {
        event: 'execution.started',
        data: { executionId: record.id, workflowId: wf.id, version: versionSnap.version },
      },
      ...steps.map((s) => ({
        event: `step.${s.status.toLowerCase()}`,
        data: {
          executionId: record.id,
          nodeId: s.nodeId,
          status: s.status,
          outputPayload: s.outputPayload,
          errorMessage: s.errorMessage,
        },
      })),
      {
        event: `execution.${record.status.toLowerCase()}`,
        data: { executionId: record.id, status: record.status },
      },
    ];
    this.executionEvents.set(record.id, sseEvents);

    return record;
  }

  public async listen(port = this.config.port, host = this.config.host): Promise<number> {
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
    if (!this.httpServer) return;
    return new Promise((resolve, reject) => {
      this.httpServer!.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
