import type { WorkflowDefinition } from '../types.js';

/** Opt-in draft migration. Never apply this to an immutable published snapshot. */
export function migrateWorkflowToV11(graph: WorkflowDefinition): WorkflowDefinition {
  const { checksum: _oldChecksum, ...copy } = structuredClone(graph) as WorkflowDefinition & { checksum?: string };
  const contexts = new Set(copy.nodes.filter((n) => n.type.startsWith('context.')).map((n) => n.id));
  return {
    ...copy,
    schemaVersion: '1.1',
    edges: copy.edges.map((edge) => ({ ...edge, kind: contexts.has(edge.source) ? 'context' : (edge.kind ?? 'data') })),
  };
}
