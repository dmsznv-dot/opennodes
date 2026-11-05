import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from '../src/index.js';
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '@localflow/workflow-schema';

const port = (id: string, direction: 'input' | 'output', extra = {}) => ({
  id,
  name: id,
  type: 'any' as const,
  direction,
  required: false,
  ...extra,
});
const node = (id: string, type = 'test.step', config = {}): WorkflowNode => ({
  id,
  type,
  data: { label: id, config },
  inputs: [port('main', 'input')],
  outputs: [port('main', 'output')],
});
const edge = (
  source: string,
  target: string,
  targetHandle = 'main',
  sourceHandle = 'main'
): WorkflowEdge => ({
  id: `${source}-${target}-${targetHandle}`,
  source,
  target,
  sourceHandle,
  targetHandle,
});
const graph = (nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDefinition => ({
  id: 'wf',
  workspaceId: 'ws',
  name: 'Named ports',
  schemaVersion: '1.0',
  executionPolicy: { executionTimeoutMs: 300000, maxConcurrency: 1 },
  nodes,
  edges,
});

describe('actual named input execution', () => {
  it('does not let a forged context kind bypass inactive data control', async () => {
    const source = node('source', 'test.branch');
    source.outputs = [port('yes', 'output'), port('no', 'output')];
    const target = node('target');
    const engine = new WorkflowEngine({
      nodeExecutors: {
        'test.branch': {
          async execute() {
            return { output: {}, activeOutputs: ['no'] };
          },
        },
      },
    });
    const run = await engine.executeWorkflow(
      graph([source, target], [{ ...edge('source', 'target', 'main', 'yes'), kind: 'context' }])
    );
    expect(run.skippedNodes.has('target')).toBe(true);
    expect(run.nodeOutputs.has('target')).toBe(false);
  });
  it('fails when a configured required named input evaluates to no value', async () => {
    const target = node('target', 'test.step', { input: '{{ $trigger.missing }}' });
    target.inputs[0] = port('main', 'input', { binding: 'input', required: true });
    const run = await new WorkflowEngine().executeWorkflow(graph([target], []));
    expect(run.execution.status).toBe('FAILED');
    expect(run.execution.errorMessage).toMatch(/input.*required|required.*input/i);
  });
  it('selects an output field and overrides a stale expression without re-evaluating source payload', async () => {
    const source = node('source', 'test.source');
    source.outputs.push(port('text', 'output', { valuePath: 'article.text' }));
    const target = node('target', 'test.step', { input: '{{ missing() }}' });
    target.inputs.push(port('content', 'input', { binding: 'input', required: true }));
    const engine = new WorkflowEngine({
      nodeExecutors: {
        'test.source': {
          async execute() {
            return { output: { article: { text: '{{ literal }}' } } };
          },
        },
      },
    });
    const run = await engine.executeWorkflow(
      graph([source, target], [edge('source', 'target', 'content', 'text')])
    );
    expect(run.execution.status).toBe('SUCCEEDED');
    expect(run.nodeOutputs.get('target')).toEqual({ input: '{{ literal }}' });
  });
  it('passes voice, prompt and model objects as actual config values', async () => {
    const writer = node('writer', 'ai.process');
    writer.inputs.push(
      ...['voice', 'prompt', 'modelConfig'].map((binding) => port(binding, 'input', { binding }))
    );
    const voice = node('voice', 'context.voice');
    const prompt = node('prompt', 'context.prompt');
    const model = node('model', 'context.model');
    const values = {
      voice: { voice: 'Warm', version: 3 },
      prompt: { template: 'Use {{ $item.title }}', version: 2 },
      model: { model: 'local-model' },
    };
    const engine = new WorkflowEngine({
      nodeExecutors: Object.fromEntries(
        Object.entries(values).map(([id, output]) => [
          `context.${id}`,
          {
            async execute() {
              return { output };
            },
          },
        ])
      ),
    });
    const run = await engine.executeWorkflow(
      graph(
        [writer, voice, prompt, model],
        [
          edge('voice', 'writer', 'voice'),
          edge('prompt', 'writer', 'prompt'),
          edge('model', 'writer', 'modelConfig'),
        ]
      )
    );
    expect(run.nodeOutputs.get('writer')).toEqual({
      voice: values.voice,
      prompt: values.prompt,
      modelConfig: values.model,
    });
  });
  for (const valuePath of [
    'article.missing',
    'article.toString',
    'article.__proto__',
    'article.constructor',
  ]) {
    it(`fails clearly for missing or unsafe selected field ${valuePath}`, async () => {
      const source = node('source', 'test.source');
      source.outputs[0] = port('main', 'output', { valuePath });
      const target = node('target');
      target.inputs[0] = port('main', 'input', { binding: 'input', required: true });
      const engine = new WorkflowEngine({
        nodeExecutors: {
          'test.source': {
            async execute() {
              return { output: { article: {} } };
            },
          },
        },
      });
      const run = await engine.executeWorkflow(graph([source, target], [edge('source', 'target')]));
      expect(run.execution.status).toBe('FAILED');
      expect(run.execution.errorMessage).toMatch(/input|path/i);
      expect(run.nodeOutputs.has('target')).toBe(false);
    });
  }
  it('fails a linked required input from a disabled source instead of using stale config', async () => {
    const source = node('source');
    source.data.disabled = true;
    const target = node('target', 'test.step', { input: 'stale' });
    target.inputs[0] = port('main', 'input', { binding: 'input', required: true });
    const run = await new WorkflowEngine().executeWorkflow(
      graph([source, target], [edge('source', 'target')])
    );
    expect(run.execution.status).toBe('FAILED');
    expect(run.execution.errorMessage).toMatch(/source.*input|input.*source/i);
  });
  it('does not let named context activate an inactive data branch', async () => {
    const branch = node('branch', 'test.branch');
    branch.outputs = [port('yes', 'output'), port('no', 'output')];
    const writer = node('writer');
    writer.inputs.push(port('voice', 'input', { binding: 'voice' }));
    const voice = node('voice', 'context.voice');
    const engine = new WorkflowEngine({
      nodeExecutors: {
        'test.branch': {
          async execute() {
            return { output: {}, activeOutputs: ['no'] };
          },
        },
      },
    });
    const run = await engine.executeWorkflow(
      graph(
        [branch, writer, voice],
        [
          edge('branch', 'writer', 'main', 'yes'),
          { ...edge('voice', 'writer', 'voice'), kind: 'context' },
        ]
      )
    );
    expect(run.skippedNodes.has('writer')).toBe(true);
  });
  it('rejects duplicate named connections even when execution bypasses graph validation', async () => {
    const target = node('target');
    target.inputs[0] = port('main', 'input', { binding: 'input' });
    const run = await new WorkflowEngine().executeWorkflow(
      graph([node('a'), node('b'), target], [edge('a', 'target'), edge('b', 'target')])
    );
    expect(run.execution.status).toBe('FAILED');
    expect(run.execution.errorMessage).toContain('ERR_INPUT_ALREADY_CONNECTED');
  });
  it('requires every explicitly bound input when a separate active control source runs the target', async () => {
    const source = node('source', 'test.branch');
    source.outputs = [port('yes', 'output'), port('no', 'output')];
    const target = node('target', 'test.step', { input: 'stale' });
    target.inputs.push(port('content', 'input', { binding: 'input', required: true }));
    const engine = new WorkflowEngine({
      nodeExecutors: {
        'test.branch': {
          async execute() {
            return { output: {}, activeOutputs: ['no'] };
          },
        },
      },
    });
    const run = await engine.executeWorkflow(
      graph(
        [source, node('control'), target],
        [edge('control', 'target'), edge('source', 'target', 'content', 'yes')]
      )
    );
    expect(run.execution.status).toBe('FAILED');
    expect(run.execution.errorMessage).toMatch(/source.*active output/);
  });
  it('supports selecting an array item using dot path segments', async () => {
    const source = node('source', 'test.source');
    source.outputs[0] = port('main', 'output', { valuePath: 'items.0.title' });
    const target = node('target');
    target.inputs[0] = port('main', 'input', { binding: 'input' });
    const engine = new WorkflowEngine({
      nodeExecutors: {
        'test.source': {
          async execute() {
            return { output: { items: [{ title: 'First' }] } };
          },
        },
      },
    });
    const run = await engine.executeWorkflow(graph([source, target], [edge('source', 'target')]));
    expect(run.nodeOutputs.get('target')).toEqual({ input: 'First' });
  });
  for (const getter of [false, true]) {
    it(`does not traverse ${getter ? 'getter' : 'inherited'} source properties`, async () => {
      let reads = 0;
      const article = getter
        ? Object.defineProperty({}, 'text', {
            get() {
              reads++;
              return 'unsafe';
            },
          })
        : Object.create({ text: 'inherited' });
      const source = node('source', 'test.source');
      source.outputs[0] = port('main', 'output', { valuePath: 'article.text' });
      const target = node('target');
      target.inputs[0] = port('main', 'input', { binding: 'input' });
      const engine = new WorkflowEngine({
        nodeExecutors: {
          'test.source': {
            async execute() {
              return { output: { article } };
            },
          },
        },
      });
      const run = await engine.executeWorkflow(graph([source, target], [edge('source', 'target')]));
      expect(run.execution.status).toBe('FAILED');
      expect(reads).toBe(0);
    });
  }
  it('leaves legacy main ports and expressions unchanged', async () => {
    const run = await new WorkflowEngine().executeWorkflow(
      graph(
        [
          node('source', 'test.step', { text: 'old' }),
          node('target', 'test.step', { text: '{{ $nodes.source.output.text }}' }),
        ],
        [edge('source', 'target')]
      )
    );
    expect(run.nodeOutputs.get('target')).toEqual({ text: 'old' });
  });
});
