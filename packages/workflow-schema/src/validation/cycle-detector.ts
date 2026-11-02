export interface CycleDetectionResult {
  hasCycle: boolean;
  topologicalOrder: string[]; // Valid linear evaluation order if hasCycle is false
  cycleNodes: string[]; // Node IDs involved in or downstream of cycle
  cyclePath: string[]; // Specific directed cycle path, e.g. ["A", "B", "C", "A"]
}

/**
 * Detects cycles in a directed workflow graph using Kahn's Algorithm (Topological Sort).
 * Complexity: O(V + E) time, O(V + E) space.
 *
 * If a cycle exists, uses DFS from candidate nodes to extract the exact cycle loop path.
 */
export function detectCycles(
  nodes: readonly { id: string }[],
  edges: readonly { source: string; target: string }[]
): CycleDetectionResult {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize data structures for all nodes
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  // Populate adjacency and in-degrees (ignoring edges referencing non-existent nodes)
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      adjacency.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  // Kahn's Algorithm: Initialize queue with all nodes having in-degree 0
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  const topologicalOrder: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    topologicalOrder.push(current);

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      const updatedDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, updatedDegree);
      if (updatedDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If all unique nodes were visited, graph is a DAG (no cycles)
  if (topologicalOrder.length === inDegree.size) {
    return {
      hasCycle: false,
      topologicalOrder,
      cycleNodes: [],
      cyclePath: [],
    };
  }

  // Graph has one or more cycles! Identify all nodes that could not be resolved
  const cycleNodes: string[] = [];
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree > 0) {
      cycleNodes.push(nodeId);
    }
  }

  // Extract a specific cycle path using DFS
  const cyclePath = extractCyclePath(cycleNodes, adjacency);

  return {
    hasCycle: true,
    topologicalOrder: [],
    cycleNodes,
    cyclePath,
  };
}

/**
 * Traces a directed cycle loop from the set of candidate cycle nodes
 */
function extractCyclePath(
  cycleCandidates: string[],
  adjacency: Map<string, string[]>
): string[] {
  const candidateSet = new Set(cycleCandidates);
  const visited = new Set<string>();
  const recursionStack: string[] = [];
  const stackSet = new Set<string>();

  function dfs(nodeId: string): string[] | null {
    visited.add(nodeId);
    recursionStack.push(nodeId);
    stackSet.add(nodeId);

    const neighbors = adjacency.get(nodeId) ?? [];
    for (const neighbor of neighbors) {
      if (!candidateSet.has(neighbor)) continue;

      if (!visited.has(neighbor)) {
        const found = dfs(neighbor);
        if (found) return found;
      } else if (stackSet.has(neighbor)) {
        // Found back-edge! Reconstruct the cycle from neighbor to neighbor
        const cycleStartIndex = recursionStack.indexOf(neighbor);
        if (cycleStartIndex !== -1) {
          const path = recursionStack.slice(cycleStartIndex);
          path.push(neighbor); // Close the loop
          return path;
        }
      }
    }

    recursionStack.pop();
    stackSet.delete(nodeId);
    return null;
  }

  for (const candidate of cycleCandidates) {
    if (!visited.has(candidate)) {
      const cycle = dfs(candidate);
      if (cycle) return cycle;
    }
  }

  return [];
}
