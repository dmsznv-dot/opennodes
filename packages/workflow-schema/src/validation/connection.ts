export interface ProposedConnection {
  source: string;
  target: string;
}

/**
 * Evaluates whether adding a proposed connection would introduce a cycle.
 * Used on React Flow canvas in `onConnect` or `isValidConnection`.
 *
 * Logic: Adding an edge (source -> target) creates a cycle if and only if
 * there already exists a directed path from `target` to `source`.
 *
 * Complexity: O(V + E) BFS traversal.
 */
export function wouldCreateCycle(
  existingEdges: readonly { source: string; target: string }[],
  newConnection: ProposedConnection
): boolean {
  const { source, target } = newConnection;

  // Immediate self-loop
  if (source === target) {
    return true;
  }

  // Build adjacency list for existing edges
  const adjacency = new Map<string, string[]>();
  for (const edge of existingEdges) {
    let list = adjacency.get(edge.source);
    if (!list) {
      list = [];
      adjacency.set(edge.source, list);
    }
    list.push(edge.target);
  }

  // BFS check: can we reach `source` starting from `target`?
  const visited = new Set<string>();
  const queue: string[] = [target];
  visited.add(target);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === source) {
      return true; // Cycle detected!
    }

    const neighbors = adjacency.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  return false;
}
