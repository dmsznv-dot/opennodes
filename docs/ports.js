/** Declarative workflow ports. The engine keeps the full schema; the canvas may simplify its display. */
import { ACTIONS } from './catalog.js';

const label = (ru, en) => ({ ru, en });
const make = (id, type, direction, name, extra = {}) => ({ id, name, type, direction, required: false, ...extra });
const contextTypes = new Set(['context', 'prompt', 'modelConfig']);

export function categoryOf(node) {
  const a = ACTIONS[node?.action];
  if (['trigger', 'context', 'logic'].includes(a?.kind)) return a.kind;
  if (['ai', 'ollama'].includes(a?.service)) return 'ai';
  if (['telegram', 'email', 'slack', 'discord'].includes(a?.service)) return 'message';
  return 'data';
}

export function portsFor(node) {
  const a = ACTIONS[node?.action] ?? {};
  const settings = a.kind === 'context';
  const contextType = a.contextField === 'voice' ? 'context' : a.contextField === 'prompt' ? 'prompt' : 'modelConfig';
  const inputs = a.kind === 'trigger' || a.noInputs ? [] : [make('main', 'any', 'input', label('Поток', 'Flow'))];
  const outputs = [make('main', settings ? contextType : 'json', 'output', settings ? a.name : label('Все данные', 'All data'))];
  if (!settings) {
    for (const f of a.fields ?? []) {
      if (!f.acceptsData && !['voice', 'prompt'].includes(f.type)) continue;
      if (['connections', 'connection', 'select', 'checkbox'].includes(f.type)) continue;
      const id = f.key === 'input' ? 'content' : f.key;
      const type = f.type === 'voice' ? 'context' : f.type === 'prompt' ? 'prompt' : f.key === 'input' ? 'any' : 'text';
      inputs.push(make(id, type, 'input', f.key === 'input' ? label('Текст / данные', 'Content / data') : f.label, { binding: f.key }));
    }
    if (['ai.process', 'ai.review'].includes(node?.action))
      inputs.push(make('model', 'modelConfig', 'input', label('Модель', 'Model'), { binding: 'modelConfig' }));
    // Keep the useful semantic outputs visible without turning a feed into 25 dots.
    const keys = ['text', 'posts', 'items', 'result', 'body', 'image'];
    for (const key of keys.filter((key) => a.outputs?.some((f) => f.key === key)).slice(0, 4)) {
      const f = a.outputs.find((f) => f.key === key);
      outputs.push(make(key, key === 'items' ? 'json' : 'text', 'output', f.label, { valuePath: key }));
    }
  }
  return { inputs, outputs };
}

/** Ports visible on the canvas; data fields remain available through the data picker. */
export function canvasPortsFor(node, automation = null) {
  const ports = portsFor(node);
  if (ACTIONS[node?.action]?.type === 'core.rss') {
    // RSS is a single feed. The named values belong in the data picker, not six dots.
    return { ...ports, outputs: ports.outputs.filter((port) => port.id === 'main') };
  }
  if (['ai.process', 'ai.review'].includes(node?.action)) {
    // The AI step's instruction and data are edited as fields; only semantic context
    // connections (template and brand voice) need their own canvas sockets.
    return {
      ...ports,
      inputs: ports.inputs.filter((port) =>
        ['main', 'prompt', 'voice'].includes(port.id) ||
        (port.id === 'model' && automation?.nodes?.some((item) => item.action === 'context.model'))
      ),
    };
  }
  return ports;
}

/** Infer only absent handles. Explicit legacy main handles stay explicit. */
export function resolvedHandles(a, edge) {
  const source = a.nodes.find((n) => n.id === edge.source);
  const action = ACTIONS[source?.action];
  const contextInput = ['model', 'modelConfig'].includes(action?.contextField) ? 'model' : action?.contextField;
  const target = a.nodes.find((n) => n.id === edge.target);
  const inferred = contextInput && portsFor(target).inputs.some((p) => p.id === contextInput) ? contextInput : 'main';
  return { sourceHandle: edge.sourceHandle ?? 'main', targetHandle: edge.targetHandle ?? inferred };
}

export function portPosition(node, direction, handle, width, height, automation = null) {
  const ports = canvasPortsFor(node, automation)[direction === 'input' ? 'inputs' : 'outputs'];
  const index = Math.max(0, ports.findIndex((p) => p.id === handle));
  return { x: node.position.x + width * (index + 1) / (ports.length + 1), y: node.position.y + (direction === 'output' ? height : 0) };
}

export function compatibleTypes(source, target) {
  // Settings can only attach to their matching semantic slot, not to a flow port.
  if (contextTypes.has(source) || contextTypes.has(target)) return source === target;
  if (source === 'any' || target === 'any' || source === target) return true;
  if (['text', 'string'].includes(source) && ['text', 'string'].includes(target)) return true;
  return target === 'json' && ['text', 'string', 'boolean', 'number'].includes(source);
}

/** Error keys are also used for drag affordances: glow and validation cannot disagree. */
export function connectionProblem(a, sourceId, sourceHandle, targetId, targetHandle) {
  if (!targetId || sourceId === targetId) return 'port.self';
  const source = a.nodes.find((n) => n.id === sourceId);
  const target = a.nodes.find((n) => n.id === targetId);
  const out = portsFor(source).outputs.find((p) => p.id === sourceHandle);
  const input = portsFor(target).inputs.find((p) => p.id === targetHandle);
  if (!source || !target || !out || !input) return 'port.missing';
  if (!compatibleTypes(out.type, input.type)) return 'port.incompatible';
  if (input.binding && a.edges.some((e) => e.target === targetId && resolvedHandles(a, e).targetHandle === targetHandle)) return 'port.occupied';
  if (a.edges.some((e) => e.source === sourceId && e.target === targetId && resolvedHandles(a, e).sourceHandle === sourceHandle && resolvedHandles(a, e).targetHandle === targetHandle)) return 'port.occupied';
  const seen = new Set(); const queue = [targetId];
  while (queue.length) {
    const id = queue.shift(); if (id === sourceId) return 'port.cycle';
    if (seen.has(id)) continue; seen.add(id);
    queue.push(...a.edges.filter((e) => e.source === id).map((e) => e.target));
  }
  return null;
}

export function enginePorts(node) {
  const toSchema = (p) => ({ ...p, name: typeof p.name === 'string' ? p.name : p.name?.en ?? p.id });
  const ports = portsFor(node);
  return { inputs: ports.inputs.map(toSchema), outputs: ports.outputs.map(toSchema) };
}

/** The canvas binding wins over a literal field, just as it does in the engine. */
export function boundField(a, node, field) {
  const input = portsFor(node).inputs.find((p) => p.binding === field);
  if (!input) return null;
  const edge = a.edges.find((e) => e.target === node.id && resolvedHandles(a, e).targetHandle === input.id);
  const source = edge && a.nodes.find((n) => n.id === edge.source);
  if (!source) return null;
  const output = portsFor(source).outputs.find((p) => p.id === resolvedHandles(a, edge).sourceHandle);
  if (!output) return null;
  return { source, input, output, expression: `{{ $nodes.${source.id}.output${output.valuePath ? '.' + output.valuePath : ''} }}` };
}
