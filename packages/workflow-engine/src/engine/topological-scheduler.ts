import { detectCycles, type WorkflowEdge, type WorkflowNode } from '@localflow/workflow-schema';
import { CycleDetectedError } from './errors.js';

export class TopologicalScheduler {
  schedule(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
    const result = detectCycles(nodes, edges);
    if (result.hasCycle) {
      throw new CycleDetectedError(result.cycleNodes, result.cyclePath);
    }

    const nodeById = new Map<string, WorkflowNode>();
    for (const node of nodes) {
      nodeById.set(node.id, node);
    }

    const ordered: WorkflowNode[] = [];
    for (const id of result.topologicalOrder) {
      const node = nodeById.get(id);
      if (node) {
        ordered.push(node);
      }
    }
    return ordered;
  }
}
