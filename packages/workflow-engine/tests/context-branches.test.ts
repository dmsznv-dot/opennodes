import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from '../src/index.js';
import type { WorkflowDefinition, WorkflowNode } from '@localflow/workflow-schema';

const port = (id: string, direction: 'input' | 'output') => ({
  id, name: id, type: 'any' as const, direction, required: false,
});
const node = (id: string, type: string): WorkflowNode => ({
  id, type, data: { label: id, config: {} },
  inputs: type.startsWith('trigger.') ? [] : [port('main', 'input')],
  outputs: [port('main', 'output')],
});

describe('context dependencies and data branches', () => {
  for (const explicit of [false, true]) {
    it(`does not activate a skipped data branch (${explicit ? 'explicit' : 'legacy'} context)`, async () => {
      let calls = 0;
      const trigger = node('start', 'trigger.manual');
      const branch = node('branch', 'test.branch');
      branch.outputs = [port('yes', 'output'), port('no', 'output')];
      const voice = node('voice', 'context.voice');
      voice.inputs = [];
      const writer = node('writer', 'ai.process');
      const edge = (source: string, target: string, sourceHandle = 'main') => ({
        id: `${source}-${target}`, source, target, sourceHandle, targetHandle: 'main',
      });
      const graph: WorkflowDefinition = {
        id: 'wf', workspaceId: 'ws', name: 'Context must not bypass branching',
        schemaVersion: '1.0', executionPolicy: { executionTimeoutMs: 300000, maxConcurrency: 1 },
        nodes: [trigger, branch, voice, writer],
        edges: [edge('start', 'branch'), edge('branch', 'writer', 'yes'), {
          ...edge('voice', 'writer'), ...(explicit ? { kind: 'context' as const } : {}),
        }],
      };
      const engine = new WorkflowEngine({ nodeExecutors: {
        'test.branch': { async execute() { return { output: {}, activeOutputs: ['no'] }; } },
        'context.voice': { async execute() { return { output: { voice: 'Friendly' } }; } },
        'ai.process': { async execute() { calls++; return { output: { text: 'sent' } }; } },
      } });
      const run = await engine.executeWorkflow(graph);
      expect(run.execution.status).toBe('SUCCEEDED');
      expect(calls).toBe(0);
      expect(run.skippedNodes.has('writer')).toBe(true);
    });
  }
});
