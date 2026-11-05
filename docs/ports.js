/** Semantic ports shared by the editor and serialized execution graph. */
import { ACTIONS } from './catalog.js';
const label = (ru, en) => ({ ru, en });
const port = (id, type, direction, name, extra = {}) => ({
  id,
  name,
  type,
  direction,
  required: false,
  ...extra,
});
const settingsTypes = new Set(['context', 'prompt', 'modelConfig']);
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
  const type =
    a.contextField === 'voice' ? 'context' : a.contextField === 'prompt' ? 'prompt' : 'modelConfig';
  const inputs =
    a.kind === 'trigger' || a.noInputs
      ? []
      : [port('main', 'any', 'input', label('Поток', 'Flow'))];
  const outputs = [
    port(
      'main',
      settings ? type : 'json',
      'output',
      settings ? a.name : label('Все данные', 'All data')
    ),
  ];
  if (!settings) {
    for (const f of a.fields ?? []) {
      if (!f.acceptsData && !['voice', 'prompt'].includes(f.type)) continue;
      if (['connections', 'connection', 'select', 'checkbox'].includes(f.type)) continue;
      inputs.push(
        port(
          f.key === 'input' ? 'content' : f.key,
          f.type === 'voice'
            ? 'context'
            : f.type === 'prompt'
              ? 'prompt'
              : f.key === 'input'
                ? 'any'
                : 'text',
          'input',
          f.key === 'input' ? label('Текст / данные', 'Content / data') : f.label,
          { binding: f.key }
        )
      );
    }
    if (['ai.process', 'ai.review'].includes(node?.action))
      inputs.push(
        port('model', 'modelConfig', 'input', label('Модель', 'Model'), { binding: 'modelConfig' })
      );
    for (const key of ['text', 'posts', 'items', 'result', 'body', 'image']
      .filter((key) => a.outputs?.some((f) => f.key === key))
      .slice(0, 4)) {
      const f = a.outputs.find((f) => f.key === key);
      outputs.push(
        port(key, ['items', 'posts', 'result'].includes(key) ? 'json' : 'text', 'output', f.label, {
          valuePath: key,
        })
      );
    }
  }
  return { inputs, outputs };
}
export function resolvedHandles(a, edge) {
  const source = a.nodes.find((n) => n.id === edge.source);
  const target = a.nodes.find((n) => n.id === edge.target);
  const field = ACTIONS[source?.action]?.contextField;
  const id = ['model', 'modelConfig'].includes(field) ? 'model' : field;
  const inferred = id && portsFor(target).inputs.some((p) => p.id === id) ? id : 'main';
  return { sourceHandle: edge.sourceHandle ?? 'main', targetHandle: edge.targetHandle ?? inferred };
}
export function portPosition(node, direction, handle, width, height) {
  const ports = portsFor(node)[direction === 'input' ? 'inputs' : 'outputs'];
  const index = Math.max(
    0,
    ports.findIndex((p) => p.id === handle)
  );
  return {
    x: node.position.x + (width * (index + 1)) / (ports.length + 1),
    y: node.position.y + (direction === 'output' ? height : 0),
  };
}
export function compatibleTypes(source, target) {
  if (settingsTypes.has(source) || settingsTypes.has(target)) return source === target;
  if (source === 'any' || target === 'any' || source === target) return true;
  if (['text', 'string'].includes(source) && ['text', 'string'].includes(target)) return true;
  return target === 'json' && ['text', 'string', 'boolean', 'number'].includes(source);
}
export function connectionProblem(a, sourceId, sourceHandle, targetId, targetHandle) {
  if (!targetId || sourceId === targetId) return 'port.self';
  const source = a.nodes.find((n) => n.id === sourceId),
    target = a.nodes.find((n) => n.id === targetId);
  const out = portsFor(source).outputs.find((p) => p.id === sourceHandle),
    input = portsFor(target).inputs.find((p) => p.id === targetHandle);
  if (!source || !target || !out || !input) return 'port.missing';
  if (!compatibleTypes(out.type, input.type)) return 'port.incompatible';
  if (
    input.binding &&
    a.edges.some(
      (e) => e.target === targetId && resolvedHandles(a, e).targetHandle === targetHandle
    )
  )
    return 'port.occupied';
  if (
    a.edges.some(
      (e) =>
        e.source === sourceId &&
        e.target === targetId &&
        resolvedHandles(a, e).sourceHandle === sourceHandle &&
        resolvedHandles(a, e).targetHandle === targetHandle
    )
  )
    return 'port.occupied';
  const queue = [targetId],
    seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (id === sourceId) return 'port.cycle';
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...a.edges.filter((e) => e.source === id).map((e) => e.target));
  }
  return null;
}
export function enginePorts(node) {
  const normalize = (p) => ({
    ...p,
    name: typeof p.name === 'string' ? p.name : (p.name?.en ?? p.id),
  });
  const ports = portsFor(node);
  return { inputs: ports.inputs.map(normalize), outputs: ports.outputs.map(normalize) };
}
export function boundField(a, node, field) {
  const input = portsFor(node).inputs.find((p) => p.binding === field);
  if (!input) return null;
  const edge = a.edges.find(
    (e) => e.target === node.id && resolvedHandles(a, e).targetHandle === input.id
  );
  const source = edge && a.nodes.find((n) => n.id === edge.source);
  if (!source) return null;
  const output = portsFor(source).outputs.find(
    (p) => p.id === resolvedHandles(a, edge).sourceHandle
  );
  if (!output) return null;
  return {
    source,
    input,
    output,
    expression: `{{ $nodes.${source.id}.output${output.valuePath ? '.' + output.valuePath : ''} }}`,
  };
}
