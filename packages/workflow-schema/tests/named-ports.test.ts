import { describe, it, expect } from 'vitest';
import { NodePortSchema, validateWorkflowGraph } from '../src/index.js';
import type { WorkflowNode, WorkflowEdge } from '../src/index.js';

const port = (id: string, direction: 'input' | 'output', extra = {}) => ({
  id,
  name: id,
  direction,
  type: 'any' as const,
  required: false,
  ...extra,
});
const source: WorkflowNode = {
  id: 'source',
  type: 'trigger.manual',
  data: { label: 'Source', config: {} },
  inputs: [],
  outputs: [port('main', 'output')],
};
const target: WorkflowNode = {
  id: 'target',
  type: 'ai.process',
  data: { label: 'Target', config: {} },
  inputs: [port('content', 'input', { binding: 'input', required: true })],
  outputs: [],
};
const edge: WorkflowEdge = {
  id: 'one',
  source: 'source',
  sourceHandle: 'main',
  target: 'target',
  targetHandle: 'content',
};

describe('named port contracts', () => {
  it('retains binding and selection metadata without adding fields to legacy ports', () => {
    expect(NodePortSchema.parse(port('content', 'input', { binding: 'input' }))).toHaveProperty(
      'binding',
      'input'
    );
    expect(
      NodePortSchema.parse(port('text', 'output', { valuePath: 'article.text' }))
    ).toHaveProperty('valuePath', 'article.text');
    expect(NodePortSchema.parse(port('main', 'output'))).not.toHaveProperty('valuePath');
  });
  for (const binding of [
    '__proto__',
    'constructor',
    'prototype',
    'input.text',
    'x y',
    'toString',
  ]) {
    it(`rejects unsafe config binding ${binding}`, () => {
      expect(NodePortSchema.safeParse(port('x', 'input', { binding })).success).toBe(false);
    });
  }
  for (const valuePath of [
    '__proto__.x',
    'article.constructor',
    'prototype',
    'a..b',
    'items[0]',
    '',
  ]) {
    it(`rejects unsafe output path ${valuePath}`, () => {
      expect(NodePortSchema.safeParse(port('x', 'output', { valuePath })).success).toBe(false);
    });
  }
  it('rejects two links into a named input', () => {
    expect(
      validateWorkflowGraph([source, target], [edge, { ...edge, id: 'two' }]).errors.map(
        (e) => e.code
      )
    ).toContain('ERR_INPUT_ALREADY_CONNECTED');
  });
  it('requires a named required input to be linked or configured', () => {
    expect(validateWorkflowGraph([source, target], []).errors.map((e) => e.code)).toContain(
      'ERR_REQUIRED_INPUT_MISSING'
    );
    expect(
      validateWorkflowGraph(
        [source, { ...target, data: { ...target.data, config: { input: 'manual' } } }],
        []
      ).valid
    ).toBe(true);
    expect(validateWorkflowGraph([source, target], [edge]).valid).toBe(true);
  });
  it('rejects a non-context source marked as a context dependency', () => {
    expect(
      validateWorkflowGraph([source, target], [{ ...edge, kind: 'context' }]).errors.map(
        (e) => e.code
      )
    ).toContain('ERR_CONTEXT_LINK');
  });
  it('allows a model context only into supported consumers and takes no inputs', () => {
    const model: WorkflowNode = { ...source, id: 'model', type: 'context.model' };
    expect(
      validateWorkflowGraph(
        [source, model, target],
        [{ ...edge, source: 'model', kind: 'context' }]
      ).valid
    ).toBe(true);
    const other = { ...target, type: 'telegram.sendMessage' };
    expect(
      validateWorkflowGraph([source, model, other], [{ ...edge, source: 'model' }]).errors.map(
        (e) => e.code
      )
    ).toContain('ERR_CONTEXT_LINK');
  });
});
