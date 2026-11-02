import type { WorkflowEdge, WorkflowNode } from '@localflow/workflow-schema';
import type { ExecutionContext } from './execution-context.js';

export class EdgeResolver {
  getIncomingEdges(nodeId: string, edges: WorkflowEdge[]): WorkflowEdge[] {
    return edges.filter((edge) => edge.target === nodeId);
  }

  shouldExecuteNode(
    node: WorkflowNode,
    edges: WorkflowEdge[],
    context: ExecutionContext
  ): boolean {
    const incoming = this.getIncomingEdges(node.id, edges);
    if (incoming.length === 0) {
      return true;
    }

    // Merge primitive executes if at least one incoming branch has completed and is active
    const isMerge = node.type === 'primitive.merge';

    let anyActiveIncoming = false;
    for (const edge of incoming) {
      if (context.isSkipped(edge.source)) {
        continue;
      }
      const activePorts = context.getActivePorts(edge.source);
      if (!activePorts) {
        continue;
      }
      const handle = edge.sourceHandle || 'main';
      if (activePorts.has(handle) || activePorts.has('main') && handle === 'default') {
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
