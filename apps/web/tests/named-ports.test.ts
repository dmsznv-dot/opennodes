import { describe, it, expect } from 'vitest';
// @ts-expect-error plain browser module
import { portsFor, resolvedHandles, connectionProblem, categoryOf, portPosition, boundField } from '../../../docs/ports.js';
// @ts-expect-error plain browser module
import { nodeIssues } from '../../../docs/engine.js';

const node = (id: string, action: string) => ({ id, action, config: {}, position: { x: 100, y: 200 } });
describe('named canvas ports', () => {
  it('AI Writer has separate content, voice, instruction and model inputs', () => {
    const ports = portsFor(node('a', 'ai.process'));
    expect(ports.inputs.map((p: any) => p.id)).toEqual(expect.arrayContaining(['main', 'content', 'voice', 'prompt', 'model']));
    expect(ports.inputs.find((p: any) => p.id === 'content').binding).toBe('input');
    expect(ports.inputs.find((p: any) => p.id === 'voice').type).toBe('context');
    expect(ports.outputs.find((p: any) => p.id === 'text').valuePath).toBe('text');
  });
  it('legacy context links resolve to the matching input', () => {
    const a = { nodes: [node('v', 'context.voice'), node('a', 'ai.process')], edges: [] };
    expect(resolvedHandles(a, { source: 'v', target: 'a' })).toEqual({ sourceHandle: 'main', targetHandle: 'voice' });
    expect(resolvedHandles(a, { source: 'v', target: 'a', sourceHandle: 'main', targetHandle: 'main' })).toEqual({ sourceHandle: 'main', targetHandle: 'main' });
  });
  it('compatibility includes types, already connected inputs and cycle prevention', () => {
    const a = { nodes: [node('v', 'context.voice'), node('a', 'ai.process'), node('b', 'ai.process')], edges: [] as any[] };
    expect(connectionProblem(a, 'v', 'main', 'a', 'voice')).toBeNull();
    expect(connectionProblem(a, 'v', 'main', 'a', 'content')).toBeTruthy();
    a.edges.push({ id: 'e', source: 'v', target: 'a', sourceHandle: 'main', targetHandle: 'voice' });
    expect(connectionProblem(a, 'v', 'main', 'a', 'voice')).toBeTruthy();
    a.edges.push({ id: 'ab', source: 'a', target: 'b' });
    expect(connectionProblem(a, 'b', 'main', 'a', 'main')).toBeTruthy();
  });
  it('port coordinates distribute targets rather than overlap them', () => {
    const a = node('a', 'ai.process');
    const voice = portPosition(a, 'input', 'voice', 296, 112);
    const prompt = portPosition(a, 'input', 'prompt', 296, 112);
    expect(voice.y).toBe(200);
    expect(voice.x).not.toBe(prompt.x);
    expect(portPosition(a, 'output', 'text', 296, 112).y).toBe(312);
    expect(categoryOf(a)).toBe('ai');
    expect(categoryOf(node('v', 'context.voice'))).toBe('context');
  });
  it('a named connection supplies required fields and overrides stale references in readiness checks', () => {
    const source = node('a', 'ai.process');
    const target = { ...node('b', 'ai.process'), config: { input: '{{ $nodes.deleted.output.text }}', instruction: 'Write' }, connectionId: 'c' };
    const a = { nodes: [source, target], edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'text', targetHandle: 'content' }] };
    expect(boundField(a, target, 'input').expression).toBe('{{ $nodes.a.output.text }}');
    expect(nodeIssues(a, target, [{ id: 'c', service: 'ai' }])).toEqual([]);
    a.edges = [];
    expect(boundField(a, target, 'input')).toBeNull();
    expect(nodeIssues(a, target, [{ id: 'c', service: 'ai' }])).not.toEqual([]);
  });
});
