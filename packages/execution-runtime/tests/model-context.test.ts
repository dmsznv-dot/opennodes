import { describe, it, expect } from 'vitest';
import { WorkflowEngine, type NodeExecutor } from '@localflow/workflow-engine';
import type { WorkflowDefinition, WorkflowNode } from '@localflow/workflow-schema';
import type { SafeHttpClient } from '@localflow/shared';
import { buildContextExecutors } from '../src/context.js';
import { buildProcessExecutor } from '../src/process.js';
import { buildReviewExecutor } from '../src/review.js';

const port = (id: string, direction: 'input' | 'output', extra = {}) => ({
  id,
  name: id,
  type: 'any' as const,
  direction,
  required: false,
  ...extra,
});
const node = (id: string, type: string, config = {}): WorkflowNode => ({
  id,
  type,
  data: { label: id, config },
  inputs: [],
  outputs: [port('main', 'output')],
});
const httpClient = {
  async request() {
    throw new Error('context must make no external request');
  },
} as unknown as SafeHttpClient;

async function runModel(
  config: Record<string, unknown>,
  taskConfig: Record<string, unknown> = {},
  review = false
) {
  const model = node('model', 'context.model', config);
  const task = node('task', review ? 'ai.review' : 'ai.process', {
    instruction: 'Summarize',
    text: 'Review this',
    ...taskConfig,
  });
  task.inputs = [port('model', 'input', { binding: 'modelConfig' })];
  const captured: Record<string, unknown>[] = [];
  const chat: NodeExecutor = {
    async execute(_node, config) {
      captured.push(config);
      return { output: { text: review ? '{"score":9,"issues":[]}' : 'Done' } };
    },
  };
  const engine = new WorkflowEngine({
    strictNodeTypes: true,
    nodeExecutors: {
      ...buildContextExecutors(),
      'ai.process': buildProcessExecutor(chat, { httpClient }),
      'ai.review': buildReviewExecutor(chat),
    },
  });
  const workflow: WorkflowDefinition = {
    id: 'wf',
    workspaceId: 'ws',
    name: 'Model context',
    schemaVersion: '1.1',
    executionPolicy: { executionTimeoutMs: 300000, maxConcurrency: 1 },
    nodes: [task, model],
    edges: [
      {
        id: 'model-task',
        source: 'model',
        target: 'task',
        sourceHandle: 'main',
        targetHandle: 'model',
        kind: 'context',
      },
    ],
  };
  const run = await engine.executeWorkflow(workflow);
  return { run, captured };
}

describe('Model Config context reaches chat execution', () => {
  it('outputs only nonsecret settings and applies them in ai.process', async () => {
    const { run, captured } = await runModel({
      model: 'local-model',
      name: 'Writing',
      presetVersion: 4,
      temperature: 0.6,
      maxTokens: 700,
      apiKey: 'secret',
      baseUrl: 'https://untrusted.invalid',
    });
    expect(run.execution.status).toBe('SUCCEEDED');
    expect(run.nodeOutputs.get('model')).toEqual({
      model: 'local-model',
      name: 'Writing',
      version: 4,
      temperature: 0.6,
      maxTokens: 700,
    });
    expect(captured[0]).toMatchObject({ model: 'local-model', temperature: 0.6, maxTokens: 700 });
    expect(captured[0]).not.toHaveProperty('apiKey');
    expect(captured[0]).not.toHaveProperty('baseUrl');
  });
  it('honors explicit task model and zero temperature over linked defaults', async () => {
    const { run, captured } = await runModel(
      { model: 'default-model', temperature: 0.6, maxTokens: 700 },
      { model: 'task-model', temperature: 0, maxTokens: 100 }
    );
    expect(run.execution.status).toBe('SUCCEEDED');
    expect(captured[0]).toMatchObject({ model: 'task-model', temperature: 0, maxTokens: 100 });
  });
  it('treats a blank task model as no override', async () => {
    const { captured } = await runModel({ model: 'default-model' }, { model: '' });
    expect(captured[0]).toHaveProperty('model', 'default-model');
  });
  it('also applies model context when reviewing', async () => {
    const { run, captured } = await runModel({ model: 'review-model', temperature: 0 }, {}, true);
    expect(run.execution.status).toBe('SUCCEEDED');
    expect(captured[0]).toMatchObject({ model: 'review-model', temperature: 0 });
  });
  for (const config of [
    {},
    { model: 'x', temperature: 'bad' },
    { model: 'x', maxTokens: -1 },
    { model: 'x', temperature: 3 },
  ]) {
    it(`fails an invalid model configuration ${JSON.stringify(config)}`, async () => {
      const { run, captured } = await runModel(config);
      expect(run.execution.status).toBe('FAILED');
      expect(run.execution.errorMessage).toContain('Model Config:');
      expect(captured).toEqual([]);
    });
  }
});
