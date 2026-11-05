import { describe, it, expect } from 'vitest';
import { validateWorkflowGraph } from '../src/validation/graph-validator.js';
import type { WorkflowNode, WorkflowEdge } from '../src/types.js';

const port = (direction: 'input' | 'output') => [
  { id: 'main', name: 'main', type: 'any' as const, direction, required: false },
];
const node = (id: string, type: string, inputs = true): WorkflowNode => ({
  id,
  type,
  data: { label: id, config: {} },
  inputs: inputs ? port('input') : [],
  outputs: port('output'),
});
const edge = (source: string, target: string): WorkflowEdge => ({
  id: `${source}-${target}`,
  source,
  sourceHandle: 'main',
  target,
  targetHandle: 'main',
});

const nodes = [
  node('t', 'trigger.manual', false),
  node('rss', 'rss.read'),
  node('voice', 'context.voice'),
  node('tpl', 'context.prompt'),
  node('ai', 'ai.process'),
  node('tg', 'telegram.sendMessage'),
];
const codes = (edges: WorkflowEdge[]) =>
  validateWorkflowGraph(nodes, edges).errors.map((e) => e.code);
const base = [edge('t', 'rss'), edge('rss', 'ai'), edge('ai', 'tg')];

describe('context steps — which links are allowed', () => {
  it('a voice and a template lead into the AI step; the template takes data from earlier steps', () => {
    expect(codes([...base, edge('voice', 'ai'), edge('rss', 'tpl'), edge('tpl', 'ai')])).toEqual(
      []
    );
  });

  it('a voice takes nothing from other steps', () => {
    expect(codes([...base, edge('t', 'voice'), edge('voice', 'ai')])).toEqual(['ERR_CONTEXT_LINK']);
  });

  it('a context step leads only into a step that uses it', () => {
    expect(codes([...base, edge('voice', 'tg')])).toEqual(['ERR_CONTEXT_LINK']);
    expect(codes([...base, edge('rss', 'tpl'), edge('tpl', 'tg')])).toEqual(['ERR_CONTEXT_LINK']);
  });

  it('a context step does not lead into another one', () => {
    const errors = validateWorkflowGraph(nodes, [...base, edge('voice', 'tpl')]).errors;
    expect(errors.map((e) => e.code)).toContain('ERR_CONTEXT_LINK');
    expect(errors[0]!.message).toMatch(/another context step/);
  });

  it('workflows without context steps are checked as before', () => {
    expect(codes(base)).toEqual([]);
  });
});
