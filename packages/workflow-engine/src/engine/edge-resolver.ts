import type { WorkflowEdge, WorkflowNode } from '@localflow/workflow-schema';
import type { ExecutionContext } from './execution-context.js';

export class EdgeResolver {
  getIncomingEdges(nodeId: string, edges: WorkflowEdge[]): WorkflowEdge[] {
    return edges.filter((edge) => edge.target === nodeId);
  }

  shouldExecuteNode(
    node: WorkflowNode,
    edges: WorkflowEdge[],
    context: ExecutionContext,
    nodes: readonly WorkflowNode[] = []
  ): boolean {
    // A voice/prompt supplies settings. It cannot make an inactive data branch run.
    // Infer old links too: published 1.0 snapshots must keep their original checksum.
    const incoming = this.getIncomingEdges(node.id, edges).filter((edge) =>
      edge.kind !== 'context' && !nodes.find((n) => n.id === edge.source)?.type.startsWith('context.')
    );
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
