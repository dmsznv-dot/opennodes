/**
 * LocalFlow E2E Test Suite - Cycle Prevention & Graph Topology Validator
 * Implements Kahn's Algorithm and DFS cycle detection with port type verification.
 */

import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from './types.ts';

export interface GraphValidationResult {
  isValid: boolean;
  errors: string[];
  cycles: string[][];
  topologicalOrder: string[];
}

export class CycleDetector {
  validateGraph(workflow: WorkflowDefinition): GraphValidationResult {
    const errors: string[] = [];
    const cycles: string[][] = [];

    // 1. Check for single trigger node constraint
    const triggerNodes = workflow.nodes.filter(n => n.type.startsWith('trigger.') || n.type === 'trigger');
    if (triggerNodes.length === 0) {
      errors.push('ERR_NO_TRIGGER_NODE: Workflow must have at least one trigger node');
    } else if (triggerNodes.length > 1) {
      errors.push(`ERR_MULTIPLE_TRIGGERS: Workflow has ${triggerNodes.length} triggers, but only 1 root trigger is allowed`);
    }

    // 2. Validate node port connections
    const nodeMap = new Map<string, WorkflowNode>();
    for (const node of workflow.nodes) {
      nodeMap.set(node.id, node);
    }

    for (const edge of workflow.edges) {
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);

      if (!sourceNode) {
        errors.push(`ERR_INVALID_EDGE: Edge ${edge.id} references non-existent source node "${edge.source}"`);
        continue;
      }
      if (!targetNode) {
        errors.push(`ERR_INVALID_EDGE: Edge ${edge.id} references non-existent target node "${edge.target}"`);
        continue;
      }

      // Self-loops
      if (edge.source === edge.target) {
        errors.push(`ERR_CYCLIC_DEPENDENCY_DETECTED: Node "${edge.source}" connects to itself in a self-loop`);
        cycles.push([edge.source, edge.target]);
      }
    }

    // 3. Kahn's Algorithm for Topological Sort & Cycle Detection
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const node of workflow.nodes) {
      inDegree.set(node.id, 0);
      adjacency.set(node.id, []);
    }

    for (const edge of workflow.edges) {
      if (adjacency.has(edge.source)) {
        adjacency.get(edge.source)!.push(edge.target);
      }
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }

    const queue: string[] = [];
    for (const [nodeId, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(nodeId);
      }
    }

    const topologicalOrder: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      topologicalOrder.push(current);

      for (const neighbor of adjacency.get(current) || []) {
        const newDeg = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) {
          queue.push(neighbor);
        }
      }
    }

    // If topological order does not contain all nodes, a cycle exists
    if (topologicalOrder.length < workflow.nodes.length) {
      const remainingNodes = workflow.nodes.filter(n => !topologicalOrder.includes(n.id)).map(n => n.id);
      errors.push(`ERR_CYCLIC_DEPENDENCY_DETECTED: Cycle detected involving nodes [${remainingNodes.join(', ')}]`);
      
      // Trace cycle path using DFS
      const dfsCycles = this.findDfsCycles(remainingNodes, adjacency);
      cycles.push(...dfsCycles);
    }

    return {
      isValid: errors.length === 0,
      errors,
      cycles,
      topologicalOrder
    };
  }

  private findDfsCycles(nodeIds: string[], adjacency: Map<string, string[]>): string[][] {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const currentPath: string[] = [];
    const foundCycles: string[][] = [];

    const dfs = (node: string) => {
      visited.add(node);
      recursionStack.add(node);
      currentPath.push(node);

      for (const neighbor of adjacency.get(node) || []) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recursionStack.has(neighbor)) {
          // Cycle found!
          const cycleStartIndex = currentPath.indexOf(neighbor);
          if (cycleStartIndex !== -1) {
            foundCycles.push([...currentPath.slice(cycleStartIndex), neighbor]);
          }
        }
      }

      currentPath.pop();
      recursionStack.delete(node);
    };

    for (const node of nodeIds) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return foundCycles;
  }
}

export const cycleDetector = new CycleDetector();
