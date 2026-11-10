import { describe, expect, it } from 'vitest';
import { WorkflowDefinitionSchema, validateWorkflowGraph } from '@localflow/workflow-schema';
import { WorkflowEngine } from '../../../packages/workflow-engine/src/index.js';
import { toEngineGraph, fromEngineGraph } from '../../../docs/live.js';
import {
  contextConsumers,
  danglingRefs,
  graphSha256,
  nodeIssues,
  resolveValue,
  simulate,
} from '../../../docs/engine.js';

const credential = '00000000-0000-4000-8000-000000000001';
const node = (id: string, action: string, config = {}) => ({
  id,
  action,
  config,
  label: '',
  disabled: false,
  connectionId: action.startsWith('ai.') ? credential : null,
});
function pipeline(whole = false) {
  return {
    id: 'frontend',
    name: 'Named inputs',
    nodes: [
      node('start', 'manual.run', { sampleText: 'fresh text' }),
      node('settings', 'context.model', { name: 'Fast', model: 'test-model', temperature: 0.2 }),
      node('writer', 'ai.process', {
        input: '{{ $nodes.deleted.output.text }}',
        instruction: 'Summarize',
      }),
    ],
    edges: [
      {
        id: 'content',
        source: 'start',
        sourceHandle: whole ? 'main' : 'text',
        target: 'writer',
        targetHandle: 'content',
      },
      {
        id: 'settings',
        source: 'settings',
        sourceHandle: 'main',
        target: 'writer',
        targetHandle: 'model',
      },
    ],
  };
}

describe('editor semantic graph and preview', () => {
  it('preserves explicit semantic and legacy main handles through a saved draft', () => {
    const editor = pipeline();
    const graph = toEngineGraph(editor);
    expect(fromEngineGraph(graph.nodes, graph.edges)).toEqual({
      nodes: editor.nodes,
      edges: editor.edges,
    });
    expect(graph.nodes[0].outputs).toContainEqual(
      expect.objectContaining({ id: 'text', valuePath: 'text' })
    );
    expect(graph.nodes[2].inputs).toContainEqual(
      expect.objectContaining({ id: 'content', binding: 'input' })
    );
    const old = { ...editor, edges: [{ id: 'old', source: 'settings', target: 'writer' }] };
    expect(toEngineGraph(old).edges[0].targetHandle).toBe('model');
    expect(
      toEngineGraph({ ...old, edges: [{ ...old.edges[0], targetHandle: 'main' }] }).edges[0]
        .targetHandle
    ).toBe('main');
    expect(
      fromEngineGraph([], [{ id: 'e', source: 'a', target: 'b' }]).edges[0]
    ).not.toHaveProperty('targetHandle');
  });

  it('treats wired required fields as supplied and ignores their stale field expressions', () => {
    const editor = pipeline();
    const writer = editor.nodes[2];
    expect(nodeIssues(editor, writer, [{ id: credential }])).toEqual([]);
    expect(danglingRefs(editor, writer)).toEqual([]);
    const empty = { ...writer, config: { instruction: 'Summarize' } };
    expect(nodeIssues(editor, empty, [{ id: credential }])).toEqual([]);
    editor.edges = editor.edges.filter((e) => e.id !== 'content');
    expect(danglingRefs(editor, writer)).toEqual(['{{ $nodes.deleted.output.text }}']);
    expect(nodeIssues(editor, empty, [{ id: credential }])).toContainEqual(
      expect.objectContaining({ field: 'input' })
    );
    expect(contextConsumers('context.model')).toEqual(['ai.process', 'ai.review']);
  });

  for (const whole of [false, true]) {
    it(`uses ${whole ? 'whole outputs' : 'selected output paths'} in simulation and real execution`, async () => {
      const editor = pipeline(whole);
      const expected = whole ? { text: 'fresh text' } : 'fresh text';
      const preview = simulate(editor, [{ id: credential }]);
      expect(preview.result).toBe('ok');
      expect(preview.steps.find((s) => s.nodeId === 'writer').input.config).toMatchObject({
        input: expected,
        modelConfig: { model: 'test-model', temperature: 0.2 },
      });
      // Parse the actual frontend payload through the persistence schema: metadata must survive.
      const graph = WorkflowDefinitionSchema.parse({
        id: 'wf',
        workspaceId: 'ws',
        name: 'Frontend serialized graph',
        ...toEngineGraph(editor),
      });
      expect(validateWorkflowGraph(graph.nodes, graph.edges).errors).toEqual([]);
      let config: Record<string, unknown> | undefined;
      const engine = new WorkflowEngine({
        nodeExecutors: {
          'trigger.manual': { execute: () => ({ output: { text: 'fresh text' } }) },
          'context.model': {
            execute: () => ({ output: { model: 'test-model', temperature: 0.2 } }),
          },
          'ai.process': {
            execute: (_node, evaluated) => {
              config = evaluated;
              return { output: { text: 'done' } };
            },
          },
        },
      });
      const run = await engine.executeWorkflow(graph);
      expect(run.execution.status).toBe('SUCCEEDED');
      expect(config).toMatchObject({
        input: expected,
        modelConfig: { model: 'test-model', temperature: 0.2 },
      });
    });
  }

  it('changes the graph checksum when a wire selects a different output', async () => {
    const editor = pipeline();
    const before = await graphSha256(editor);
    editor.edges[0].sourceHandle = 'main';
    expect(await graphSha256(editor)).not.toBe(before);
  });

  it('resolves whole-object expressions without stringifying the value', () => {
    const output = { voice: 'Friendly', name: 'Voice' };
    expect(resolveValue('{{ $nodes.voice.output }}', { nodes: { voice: output } })).toBe(output);
    expect(resolveValue('{{ $trigger }}', { trigger: output })).toBe(output);
  });
});
