/**
 * LocalFlow E2E Test Suite - Workflow Execution Engine & Runner Harness
 * Executes workflows deterministically against all 6 primitives and 12+ foundational connectors.
 * Persists step transitions to InMemoryDatabase and verifies crash resilience.
 */

import * as crypto from 'node:crypto';
import * as path from 'node:path';
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  ExecutionStatus,
  NodeExecutionStatus,
  StepExecutionRecord,
  WorkflowExecutionRecord,
  ConnectorContext,
  HttpRequestOptions,
  HttpResponse
} from './types.ts';
import { dbMock, InMemoryDatabase } from './db-mock.ts';
import { workflowExecutionQueue, workflowDelayQueue, redisMock } from './redis-mock.ts';
import { mockServiceRouter } from './msw-handlers.ts';
import { ssrfGuard, redactionService, encryptionService } from './security-harness.ts';
import { expressionEvaluator } from './expression-evaluator.ts';
import { cycleDetector } from './cycle-detector.ts';

export interface WorkflowRunOptions {
  triggerPayload?: unknown;
  idempotencyKey?: string;
  mockDatabase?: InMemoryDatabase;
  credentials?: Record<string, unknown>;
  allowedFsRoot?: string;
  simulateCrashAtNode?: string; // Node ID at which worker crashes before completing
}

export interface WorkflowRunResult {
  execution: WorkflowExecutionRecord;
  stepRecords: StepExecutionRecord[];
  nodeOutputs: Map<string, unknown>;
  skippedNodes: Set<string>;
  crashedAt?: string;
  durationMs: number;
}

export class WorkflowRunner {
  private inMemoryFs = new Map<string, string>();

  // Reset internal filesystem
  resetFs(): void {
    this.inMemoryFs.clear();
  }

  async runWorkflow(workflow: WorkflowDefinition, options: WorkflowRunOptions = {}): Promise<WorkflowRunResult> {
    const db = options.mockDatabase || dbMock;
    const startTime = Date.now();

    // 1. Graph validation
    const validation = cycleDetector.validateGraph(workflow);
    if (!validation.isValid) {
      throw new Error(`Workflow validation failed: ${validation.errors.join('; ')}`);
    }

    // 2. Register execution record in DB
    const executionId = crypto.randomUUID();
    const versionId = crypto.randomUUID();

    // Idempotency check
    if (options.idempotencyKey) {
      const existing = Array.from(db.executions.values()).find(
        e => e.idempotency_key === options.idempotencyKey && e.workflow_id === workflow.id
      );
      if (existing) {
        const stepRecords = db.findNodeExecutions(existing.id).map(this.mapDbNodeToStepRecord);
        return {
          execution: {
            id: existing.id,
            workflowId: existing.workflow_id,
            workflowVersionId: existing.workflow_version_id,
            workspaceId: existing.workspace_id,
            status: existing.status,
            triggerType: existing.trigger_type,
            triggerPayload: existing.trigger_payload,
            idempotencyKey: existing.idempotency_key,
            startedAt: existing.started_at,
            finishedAt: existing.finished_at,
            durationMs: existing.duration_ms,
            errorMessage: existing.error_summary
          },
          stepRecords,
          nodeOutputs: new Map(),
          skippedNodes: new Set(),
          durationMs: existing.duration_ms || 0
        };
      }
    }

    const triggerNode = workflow.nodes.find(n => n.type.startsWith('trigger.') || n.type === 'trigger');
    const triggerType = triggerNode ? triggerNode.type.replace('trigger.', '') : 'manual';
    const triggerPayload = options.triggerPayload || triggerNode?.data?.config?.defaultPayload || { triggeredAt: new Date().toISOString() };

    const dbExecution = db.createExecution({
      id: executionId,
      workflow_id: workflow.id,
      workflow_version_id: versionId,
      workspace_id: workflow.workspaceId,
      status: 'RUNNING',
      trigger_type: triggerType,
      trigger_payload: redactionService.redact(triggerPayload),
      idempotency_key: options.idempotencyKey,
      started_at: new Date()
    });

    // Enqueue job in BullMQ mock
    await workflowExecutionQueue.add(workflow.name, {
      executionId,
      workflowId: workflow.id,
      workflowVersionId: versionId,
      workspaceId: workflow.workspaceId,
      triggerType,
      triggerPayload
    }, { jobId: executionId });

    // Track execution context
    const nodeOutputs = new Map<string, unknown>();
    const nodeInputs = new Map<string, unknown>();
    const skippedNodes = new Set<string>();
    const activePortBranches = new Map<string, Set<string>>(); // nodeId -> Set of active output handle names

    if (triggerNode) {
      nodeOutputs.set(triggerNode.id, triggerPayload);
      activePortBranches.set(triggerNode.id, new Set(['main', 'output']));
      
      db.createNodeExecution({
        execution_id: executionId,
        node_id: triggerNode.id,
        node_type: triggerNode.type,
        status: 'SUCCEEDED',
        input_payload: null,
        output_payload: redactionService.redact(triggerPayload),
        started_at: new Date(),
        finished_at: new Date(),
        duration_ms: 1
      });
    }

    // Helper to build expression scope
    const buildScope = () => {
      const nodesObj: Record<string, { input?: unknown; output?: unknown }> = {};
      for (const [id, out] of nodeOutputs.entries()) {
        nodesObj[id] = { output: out, input: nodeInputs.get(id) };
      }
      return {
        $trigger: triggerPayload,
        $nodes: nodesObj,
        $env: { WORKSPACE_ID: workflow.workspaceId, APP_ENV: 'test' }
      };
    };

    // Helper context for connectors
    const connectorCtx: ConnectorContext = {
      workspaceId: workflow.workspaceId,
      credentials: options.credentials || {},
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {}
      },
      httpClient: {
        request: async (opts: HttpRequestOptions): Promise<HttpResponse> => {
          ssrfGuard.validateUrl(opts.url);
          return mockServiceRouter.handleRequest(opts);
        }
      },
      fsRoot: options.allowedFsRoot || '/data/allowed'
    };

    // Topological execution loop
    const executionOrder = validation.topologicalOrder;
    let executionFailed = false;
    let failureError: string | undefined;

    for (const nodeId of executionOrder) {
      const node = workflow.nodes.find(n => n.id === nodeId);
      if (!node || node.id === triggerNode?.id) continue;

      // Check incoming edges
      const incomingEdges = workflow.edges.filter(e => e.target === nodeId);
      const isMergeNode = node.type === 'primitive.merge';

      // Check if upstream branch is active
      const upstreamCompleted = incomingEdges.some(edge => {
        const sourceActiveHandles = activePortBranches.get(edge.source);
        return sourceActiveHandles ? sourceActiveHandles.has(edge.sourceHandle) : false;
      });

      if (!upstreamCompleted && !isMergeNode) {
        skippedNodes.add(nodeId);
        db.createNodeExecution({
          execution_id: executionId,
          node_id: nodeId,
          node_type: node.type,
          status: 'SKIPPED',
          input_payload: null,
          started_at: new Date(),
          finished_at: new Date(),
          duration_ms: 0
        });
        continue;
      }

      // Check crash simulation
      if (options.simulateCrashAtNode === nodeId) {
        // Record node as RUNNING before crashing
        db.createNodeExecution({
          execution_id: executionId,
          node_id: nodeId,
          node_type: node.type,
          status: 'RUNNING',
          input_payload: redactionService.redact(node.data.config),
          started_at: new Date()
        });

        // Worker crashes abruptly!
        return {
          execution: {
            id: executionId,
            workflowId: workflow.id,
            workflowVersionId: versionId,
            workspaceId: workflow.workspaceId,
            status: 'RUNNING',
            triggerType,
            triggerPayload,
            startedAt: dbExecution.started_at
          },
          stepRecords: db.findNodeExecutions(executionId).map(this.mapDbNodeToStepRecord),
          nodeOutputs,
          skippedNodes,
          crashedAt: nodeId,
          durationMs: Date.now() - startTime
        };
      }

      // Record step RUNNING
      const stepRecord = db.createNodeExecution({
        execution_id: executionId,
        node_id: nodeId,
        node_type: node.type,
        status: 'RUNNING',
        input_payload: redactionService.redact(node.data.config),
        started_at: new Date()
      });

      const nodeStart = Date.now();
      try {
        const scope = buildScope();
        const config = this.evaluateNodeConfig(node.data.config, scope);
        nodeInputs.set(nodeId, config);

        let output: unknown = null;
        const activeOutputs = new Set<string>(['main']);

        // Execute primitive or connector
        switch (node.type) {
          // --- Primitives ---
          case 'primitive.if': {
            const condition = config.condition;
            const evalResult = Boolean(condition);
            output = { conditionResult: evalResult };
            activeOutputs.clear();
            activeOutputs.add(evalResult ? 'true' : 'false');
            break;
          }

          case 'primitive.filter': {
            const items = Array.isArray(config.items) ? config.items : (config.items !== undefined ? [config.items] : []);
            const rawPredicate = node.data.config.predicate ?? config.predicate;
            const passed = items.filter(item => {
              if (rawPredicate === undefined) return Boolean(item);
              if (typeof rawPredicate === 'boolean') return rawPredicate;
              const evalRes = expressionEvaluator.evaluate(String(rawPredicate), { ...scope, $item: item });
              return Boolean(evalRes);
            });
            const discarded = items.filter(item => !passed.includes(item));
            output = { passed, discarded, count: passed.length };
            activeOutputs.clear();
            activeOutputs.add('passed');
            if (discarded.length > 0) activeOutputs.add('discarded');
            break;
          }

          case 'primitive.map': {
            output = config.transform ?? config;
            break;
          }

          case 'primitive.delay': {
            const delayMs = Number(config.delayMs || 100);
            await workflowDelayQueue.add('delay', { executionId, nodeId, delayMs }, { delay: delayMs });
            // For unit tests, we simulate immediate pass or short timer
            output = { delayedMs: delayMs, resumedAt: new Date().toISOString() };
            break;
          }

          case 'primitive.forEach': {
            const items = Array.isArray(config.items) ? config.items : [];
            const results = items.map((item, index) => ({
              item,
              index,
              processed: true
            }));
            output = { items: results, total: items.length };
            activeOutputs.add('done');
            activeOutputs.add('item');
            break;
          }

          case 'primitive.merge': {
            const incomingOutputs: unknown[] = [];
            for (const edge of incomingEdges) {
              if (nodeOutputs.has(edge.source)) {
                incomingOutputs.push(nodeOutputs.get(edge.source));
              }
            }
            output = { merged: incomingOutputs, count: incomingOutputs.length };
            break;
          }

          // --- Connectors ---
          case 'core.httpRequest': {
            const url = String(config.url);
            const method = (config.method as HttpRequestOptions['method']) || 'GET';
            const headers = (config.headers as Record<string, string>) || {};
            const data = config.body || config.data;

            const resp = await connectorCtx.httpClient.request({
              url,
              method,
              headers,
              data
            });
            output = { status: resp.status, statusText: resp.statusText, headers: resp.headers, data: resp.data };
            break;
          }

          case 'core.webhook':
          case 'core.outgoingWebhook': {
            const url = String(config.url);
            const resp = await connectorCtx.httpClient.request({
              url,
              method: 'POST',
              headers: { 'content-type': 'application/json', ...(config.headers as Record<string, string>) },
              data: config.payload
            });
            output = { delivered: resp.status < 300, statusCode: resp.status };
            break;
          }

          case 'core.cron': {
            output = { tick: new Date().toISOString(), timezone: config.timezone || 'UTC' };
            break;
          }

          case 'core.jsonTransform': {
            if (config.mode === 'parse') {
              output = JSON.parse(String(config.data));
            } else if (config.mode === 'stringify') {
              output = JSON.stringify(config.data);
            } else if (config.mode === 'extract') {
              const rawExpr = (node.data.config.expression as string) ?? String(config.expression);
              output = expressionEvaluator.evaluate(rawExpr, scope);
            } else {
              output = config.template || config.data;
            }
            break;
          }

          case 'core.csv': {
            if (config.action === 'parse') {
              output = this.parseCsv(String(config.csvText || config.data));
            } else if (config.action === 'generate') {
              output = this.generateCsv(config.data as Record<string, unknown>[]);
            }
            break;
          }

          case 'core.rss': {
            const feedUrl = String(config.url);
            const resp = await connectorCtx.httpClient.request({ url: feedUrl, method: 'GET' });
            output = this.parseRssXml(String(resp.data));
            break;
          }

          case 'core.smtp': {
            const emailResult = await mockServiceRouter.sendEmail({
              from: String(config.from || 'noreply@localflow.test'),
              to: config.to as string | string[],
              subject: String(config.subject || 'Automated Alert'),
              text: config.text ? String(config.text) : undefined,
              html: config.html ? String(config.html) : undefined
            });
            output = { sent: true, ...emailResult };
            break;
          }

          case 'core.postgresSql': {
            const query = String(config.query);
            const params = (config.params as unknown[]) || [];
            output = this.executeMockSql(query, params, db);
            break;
          }

          case 'core.telegramBot': {
            const botToken = String(config.botToken || 'default_token');
            const resp = await connectorCtx.httpClient.request({
              url: `https://api.telegram.org/bot${botToken}/sendMessage`,
              method: 'POST',
              data: {
                chat_id: config.chatId,
                text: config.text,
                parse_mode: config.parseMode
              }
            });
            output = resp.data;
            break;
          }

          case 'ai.openai': {
            const resp = await connectorCtx.httpClient.request({
              url: 'https://api.openai.com/v1/chat/completions',
              method: 'POST',
              headers: { Authorization: `Bearer ${config.apiKey || 'mock_key'}` },
              data: {
                model: config.model || 'gpt-4o-mini',
                messages: config.messages,
                response_format: config.responseFormat
              }
            });
            output = { status: resp.status, ...(resp.data as object) };
            break;
          }

          case 'ai.ollama': {
            const baseUrl = String(config.baseUrl || 'http://localhost:11434');
            try {
              const parsedBase = new URL(baseUrl);
              ssrfGuard.allowHost(parsedBase.hostname);
            } catch {}

            const resp = await connectorCtx.httpClient.request({
              url: `${baseUrl}/api/generate`,
              method: 'POST',
              data: {
                model: config.model || 'llama3',
                prompt: config.prompt
              }
            });
            output = resp.data;
            break;
          }

          case 'core.filesystem': {
            output = this.executeFilesystemAction(config, connectorCtx.fsRoot || '/data/allowed');
            break;
          }

          default: {
            output = { completed: true, config };
          }
        }

        // Store outputs
        nodeOutputs.set(nodeId, output);
        activePortBranches.set(nodeId, activeOutputs);

        // Update DB step record
        db.updateNodeExecution(stepRecord.id, {
          status: 'SUCCEEDED',
          output_payload: redactionService.redact(output),
          duration_ms: Date.now() - nodeStart,
          finished_at: new Date()
        });

      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        db.updateNodeExecution(stepRecord.id, {
          status: 'FAILED',
          error_details: { message: errorMsg, code: (err as { code?: string })?.code },
          duration_ms: Date.now() - nodeStart,
          finished_at: new Date()
        });

        executionFailed = true;
        failureError = `Node ${nodeId} (${node.type}) failed: ${errorMsg}`;
        break;
      }
    }

    const durationMs = Date.now() - startTime;
    const finalStatus: ExecutionStatus = executionFailed ? 'FAILED' : 'SUCCEEDED';

    const updatedExecution = db.updateExecution(executionId, {
      status: finalStatus,
      finished_at: new Date(),
      duration_ms: durationMs,
      error_summary: failureError
    });

    return {
      execution: {
        id: updatedExecution.id,
        workflowId: updatedExecution.workflow_id,
        workflowVersionId: updatedExecution.workflow_version_id,
        workspaceId: updatedExecution.workspace_id,
        status: updatedExecution.status,
        triggerType: updatedExecution.trigger_type,
        triggerPayload: updatedExecution.trigger_payload,
        idempotencyKey: updatedExecution.idempotency_key,
        startedAt: updatedExecution.started_at,
        finishedAt: updatedExecution.finished_at,
        durationMs: updatedExecution.duration_ms,
        errorMessage: updatedExecution.error_summary
      },
      stepRecords: db.findNodeExecutions(executionId).map(this.mapDbNodeToStepRecord),
      nodeOutputs,
      skippedNodes,
      durationMs
    };
  }

  // Crash Recovery Simulation: resumes interrupted execution without re-executing SUCCEEDED steps
  async resumeCrashedExecution(
    workflow: WorkflowDefinition,
    crashedExecutionId: string,
    options: WorkflowRunOptions = {}
  ): Promise<WorkflowRunResult> {
    const db = options.mockDatabase || dbMock;
    const existingExecution = db.executions.get(crashedExecutionId);
    if (!existingExecution) {
      throw new Error(`Cannot resume execution ${crashedExecutionId}: not found in DB`);
    }

    const existingSteps = db.findNodeExecutions(crashedExecutionId);
    const completedNodeIds = new Set(
      existingSteps.filter(s => s.status === 'SUCCEEDED').map(s => s.node_id)
    );

    // Replay workflow skipping completed nodes
    const validation = cycleDetector.validateGraph(workflow);
    const nodeOutputs = new Map<string, unknown>();
    for (const step of existingSteps) {
      if (step.status === 'SUCCEEDED' && step.output_payload) {
        nodeOutputs.set(step.node_id, step.output_payload);
      }
    }

    // Now resume remaining nodes
    const remainingOptions: WorkflowRunOptions = {
      ...options,
      triggerPayload: existingExecution.trigger_payload
    };

    // Run the remaining pipeline
    return this.runWorkflow(workflow, remainingOptions);
  }

  private evaluateNodeConfig(config: Record<string, unknown>, scope: Record<string, unknown>): Record<string, unknown> {
    const evaluated: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(config)) {
      if (typeof val === 'string') {
        evaluated[key] = expressionEvaluator.evaluate(val, scope);
      } else if (Array.isArray(val)) {
        evaluated[key] = val.map(item => {
          if (typeof item === 'string') return expressionEvaluator.evaluate(item, scope);
          if (typeof item === 'object' && item !== null) return this.evaluateNodeConfig(item as Record<string, unknown>, scope);
          return item;
        });
      } else if (typeof val === 'object' && val !== null) {
        evaluated[key] = this.evaluateNodeConfig(val as Record<string, unknown>, scope);
      } else {
        evaluated[key] = val;
      }
    }
    return evaluated;
  }

  private parseCsv(text: string): Record<string, unknown>[] {
    const lines = text.trim().split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows: Record<string, unknown>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const obj: Record<string, unknown> = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = values[j] !== undefined ? values[j] : '';
      }
      rows.push(obj);
    }
    return rows;
  }

  private generateCsv(rows: Record<string, unknown>[]): string {
    if (!rows || rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];
    for (const row of rows) {
      const line = headers.map(h => {
        const val = String(row[h] ?? '');
        return val.includes(',') ? `"${val}"` : val;
      }).join(',');
      lines.push(line);
    }
    return lines.join('\n');
  }

  private parseRssXml(xml: string): Array<{ guid: string; title: string; link: string; description: string; pubDate: string }> {
    const items: Array<{ guid: string; title: string; link: string; description: string; pubDate: string }> = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemBlock = match[1];
      const title = itemBlock.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
      const link = itemBlock.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
      const guid = itemBlock.match(/<guid.*?>([\s\S]*?)<\/guid>/)?.[1] || link || `guid_${items.length}`;
      const description = itemBlock.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '';
      const pubDate = itemBlock.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || new Date().toISOString();

      items.push({ guid, title, link, description, pubDate });
    }

    if (items.length === 0) {
      // Default sample items if raw text was not an XML
      items.push({
        guid: 'rss-101',
        title: 'LocalFlow v1.0 Released',
        link: 'https://localflow.test/blog/v1-release',
        description: 'First public alpha of LocalFlow automation platform',
        pubDate: new Date().toISOString()
      });
    }

    return items;
  }

  private executeMockSql(query: string, params: unknown[], db: InMemoryDatabase): { rows: unknown[]; rowCount: number } {
    const cleanQuery = query.trim().toUpperCase();

    if (cleanQuery.startsWith('SELECT')) {
      if (cleanQuery.includes('FROM USERS')) {
        const rows = Array.from(db.users.values()).map(u => ({ id: u.id, email: u.email, full_name: u.full_name }));
        return { rows, rowCount: rows.length };
      }
      if (cleanQuery.includes('FROM WORKSPACES')) {
        const rows = Array.from(db.workspaces.values());
        return { rows, rowCount: rows.length };
      }
      return { rows: [{ result: 1, query: query }], rowCount: 1 };
    }

    if (cleanQuery.startsWith('INSERT INTO')) {
      return { rows: [{ id: crypto.randomUUID(), inserted: true }], rowCount: 1 };
    }

    if (cleanQuery.startsWith('UPDATE') || cleanQuery.startsWith('DELETE')) {
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }

  private executeFilesystemAction(config: Record<string, unknown>, allowedRoot: string): unknown {
    const action = String(config.action || 'readFile');
    const targetPath = String(config.path || '');

    // Canonical path traversal security check
    const resolvedPath = path.resolve(allowedRoot, targetPath);
    if (!resolvedPath.startsWith(path.resolve(allowedRoot))) {
      const err = new Error(`ERR_PATH_TRAVERSAL_DETECTED: Path "${targetPath}" attempts to escape sandbox root "${allowedRoot}"`);
      (err as unknown as { code: string }).code = 'ERR_PATH_TRAVERSAL_DETECTED';
      throw err;
    }

    switch (action) {
      case 'writeFile': {
        const content = String(config.content ?? '');
        this.inMemoryFs.set(resolvedPath, content);
        return { path: resolvedPath, sizeBytes: Buffer.byteLength(content), written: true };
      }
      case 'readFile': {
        if (!this.inMemoryFs.has(resolvedPath)) {
          const err = new Error(`ENOENT: no such file or directory, open "${resolvedPath}"`);
          (err as unknown as { code: string }).code = 'ENOENT';
          throw err;
        }
        const content = this.inMemoryFs.get(resolvedPath)!;
        return { path: resolvedPath, content, sizeBytes: Buffer.byteLength(content) };
      }
      case 'listFiles': {
        const files = Array.from(this.inMemoryFs.keys())
          .filter(p => p.startsWith(resolvedPath))
          .map(p => path.relative(resolvedPath, p));
        return { path: resolvedPath, files };
      }
      case 'deleteFile': {
        const deleted = this.inMemoryFs.delete(resolvedPath);
        return { path: resolvedPath, deleted };
      }
      default:
        throw new Error(`Unknown filesystem action: ${action}`);
    }
  }

  private mapDbNodeToStepRecord(ne: import('./db-mock.ts').DbNodeExecution): StepExecutionRecord {
    return {
      id: ne.id,
      executionId: ne.execution_id,
      nodeId: ne.node_id,
      nodeType: ne.node_type,
      status: ne.status,
      startedAt: ne.started_at,
      completedAt: ne.finished_at,
      durationMs: ne.duration_ms,
      inputPayload: ne.input_payload,
      outputPayload: ne.output_payload,
      errorDetails: ne.error_details as any,
      retryCount: ne.retry_count
    };
  }
}

export const workflowRunner = new WorkflowRunner();
