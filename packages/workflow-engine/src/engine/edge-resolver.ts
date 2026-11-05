import type { WorkflowEdge, WorkflowNode } from '@localflow/workflow-schema';
import { isSafePortBinding, isSafePortValuePath } from '@localflow/workflow-schema';
import type { ExecutionContext } from './execution-context.js';

export class EdgeResolver {
  private isActive(
    edge: WorkflowEdge,
    context: ExecutionContext,
    nodes: readonly WorkflowNode[]
  ): boolean {
    if (context.isSkipped(edge.source)) return false;
    const active = context.getActivePorts(edge.source);
    const handle = edge.sourceHandle || 'main';
    const selected = nodes.find((n) => n.id === edge.source)?.outputs.find((p) => p.id === handle);
    return Boolean(
      active &&
      (active.has(handle) ||
        (active.has('main') && (handle === 'default' || selected?.valuePath !== undefined)))
    );
  }

  /** Resolve object values directly, before evaluating the remaining configured expressions. */
  resolveBindings(
    node: WorkflowNode,
    edges: WorkflowEdge[],
    context: ExecutionContext,
    nodes: readonly WorkflowNode[]
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const incoming = this.getIncomingEdges(node.id, edges);
    for (const port of node.inputs) {
      if (port.binding === undefined) continue;
      const fail = (reason: string): never => {
        throw new Error(`Input '${node.id}:${port.id}' (${port.binding}): ${reason}`);
      };
      if (!isSafePortBinding(port.binding)) fail('unsafe config binding');
      const links = incoming.filter(
        (e) => node.inputs.find((p) => p.id === e.targetHandle)?.binding === port.binding
      );
      if (links.length > 1) fail('ERR_INPUT_ALREADY_CONNECTED: accepts only one connection');
      const edge = links[0];
      if (!edge) {
        const value = node.data.config[port.binding];
        if (
          port.required &&
          (!Object.prototype.hasOwnProperty.call(node.data.config, port.binding) ||
            value === undefined ||
            value === null ||
            value === '')
        )
          fail('connect a source or configure a value');
        continue;
      }
      const source =
        nodes.find((n) => n.id === edge.source) ?? fail(`source '${edge.source}' does not exist`);
      const sourcePort =
        source.outputs.find((p) => p.id === edge.sourceHandle) ??
        fail(`source '${edge.source}:${edge.sourceHandle}' does not exist`);
      if (
        source.data.disabled ||
        !this.isActive(edge, context, nodes) ||
        !context.nodeOutputs.has(edge.source)
      )
        fail(`source '${edge.source}' has no active output; enable it or connect an active source`);
      let value = context.nodeOutputs.get(edge.source);
      if (sourcePort.valuePath !== undefined) {
        if (!isSafePortValuePath(sourcePort.valuePath))
          fail(`unsafe output path '${sourcePort.valuePath}'`);
        for (const segment of sourcePort.valuePath.split('.')) {
          if (
            value === null ||
            typeof value !== 'object' ||
            !Object.prototype.hasOwnProperty.call(value, segment)
          )
            fail(
              `source '${edge.source}' has no own property at output path '${sourcePort.valuePath}'`
            );
          const descriptor = Object.getOwnPropertyDescriptor(value, segment);
          if (!descriptor || !('value' in descriptor))
            return fail(`output path '${sourcePort.valuePath}' must select a data property`);
          value = descriptor.value;
        }
      }
      if (value === undefined || (port.required && (value === null || value === '')))
        fail(`source '${edge.source}' provides no value`);
      result[port.binding] = value;
    }
    return result;
  }

  getIncomingEdges(nodeId: string, edges: WorkflowEdge[]): WorkflowEdge[] {
    return edges.filter((edge) => edge.target === nodeId);
  }

  shouldExecuteNode(
    node: WorkflowNode,
    edges: WorkflowEdge[],
    context: ExecutionContext,
    nodes: readonly WorkflowNode[] = []
  ): boolean {
    // Context steps supply settings. They cannot make an inactive data branch run.
    // Infer old links too: published 1.0 snapshots must keep their original checksum.
    // Trust the source type, not an edge's claim to be context; validation rejects forgeries.
    const incoming = this.getIncomingEdges(node.id, edges).filter(
      (edge) => !nodes.find((n) => n.id === edge.source)?.type.startsWith('context.')
    );
    if (incoming.length === 0) {
      return true;
    }

    // Merge primitive executes if at least one incoming branch has completed and is active
    const isMerge = node.type === 'primitive.merge';

    let anyActiveIncoming = false;
    for (const edge of incoming) {
      if (this.isActive(edge, context, nodes)) {
        anyActiveIncoming = true;
        break;
      }
    }

    if (isMerge) {
      return anyActiveIncoming;
    }

    return anyActiveIncoming;
  }
}
