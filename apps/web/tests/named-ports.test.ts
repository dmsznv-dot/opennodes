import { describe, it, expect } from 'vitest';
// @ts-expect-error browser module
import {
  portsFor,
  resolvedHandles,
  connectionProblem,
  categoryOf,
  portPosition,
  boundField,
} from '../../../docs/ports.js';
// @ts-expect-error browser module
import { nodeIssues } from '../../../docs/engine.js';
const node = (id: string, action: string) => ({
  id,
  action,
  config: {},
  position: { x: 100, y: 200 },
});
describe('named canvas ports', () => {
  it('separates AI content, voice, prompt and model settings', () => {
    const ports = portsFor(node('a', 'ai.process'));
    expect(ports.inputs.map((p: any) => p.id)).toEqual(
      expect.arrayContaining(['main', 'content', 'voice', 'prompt', 'model'])
    );
    expect(ports.inputs.find((p: any) => p.id === 'content').binding).toBe('input');
    expect(ports.inputs.find((p: any) => p.id === 'voice').type).toBe('context');
    expect(ports.outputs.find((p: any) => p.id === 'text').valuePath).toBe('text');
  });
  it('infers absent legacy context handles while preserving explicit main handles', () => {
    const a = { nodes: [node('v', 'context.voice'), node('a', 'ai.process')], edges: [] };
    expect(resolvedHandles(a, { source: 'v', target: 'a' })).toEqual({
      sourceHandle: 'main',
      targetHandle: 'voice',
    });
    expect(
      resolvedHandles(a, { source: 'v', target: 'a', sourceHandle: 'main', targetHandle: 'main' })
    ).toEqual({ sourceHandle: 'main', targetHandle: 'main' });
  });
  it('rejects incompatible slots, occupied bindings and cycles with the same rules as glow', () => {
    const a = {
      nodes: [node('v', 'context.voice'), node('a', 'ai.process'), node('b', 'ai.process')],
      edges: [] as any[],
    };
    expect(connectionProblem(a, 'v', 'main', 'a', 'voice')).toBeNull();
    expect(connectionProblem(a, 'v', 'main', 'a', 'content')).toBe('port.incompatible');
    a.edges.push({ id: 'e', source: 'v', target: 'a', targetHandle: 'voice' });
    expect(connectionProblem(a, 'v', 'main', 'a', 'voice')).toBe('port.occupied');
    a.edges.push({ id: 'ab', source: 'a', target: 'b' });
    expect(connectionProblem(a, 'b', 'main', 'a', 'main')).toBe('port.cycle');
  });
  it('positions ports separately and classifies node categories', () => {
    const a = node('a', 'ai.process');
    const voice = portPosition(a, 'input', 'voice', 296, 112),
      prompt = portPosition(a, 'input', 'prompt', 296, 112);
    expect(voice.y).toBe(200);
    expect(voice.x).not.toBe(prompt.x);
    expect(portPosition(a, 'output', 'text', 296, 112).y).toBe(312);
    expect(categoryOf(a)).toBe('ai');
    expect(categoryOf(node('v', 'context.voice'))).toBe('context');
  });
  it('uses actual bindings for readiness and ignores superseded config expressions', () => {
    const target = {
      ...node('b', 'ai.process'),
      config: { input: '{{ $nodes.deleted.output.text }}', instruction: 'Write' },
      connectionId: 'c',
    };
    const a = {
      nodes: [node('a', 'ai.process'), target],
      edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'text', targetHandle: 'content' }],
    };
    expect(boundField(a, target, 'input').expression).toBe('{{ $nodes.a.output.text }}');
    expect(nodeIssues(a, target, [{ id: 'c', service: 'ai' }])).toEqual([]);
    a.edges = [];
    expect(boundField(a, target, 'input')).toBeNull();
    expect(nodeIssues(a, target, [{ id: 'c', service: 'ai' }])).not.toEqual([]);
  });
});
