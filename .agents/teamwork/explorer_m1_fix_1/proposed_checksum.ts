import { createHash } from 'node:crypto';

/**
 * Helper to deterministically sort array elements by ID or canonical string
 */
function sortById(a: unknown, b: unknown): number {
  const getId = (item: unknown): string => {
    if (item !== null && typeof item === 'object') {
      if ('id' in item && typeof (item as { id: unknown }).id === 'string') {
        return (item as { id: string }).id;
      }
      if ('id' in item && typeof (item as { id: unknown }).id === 'number') {
        return String((item as { id: number }).id);
      }
      if ('source' in item && 'target' in item) {
        return `${String((item as { source: unknown }).source)}->${String((item as { target: unknown }).target)}`;
      }
      return JSON.stringify(item);
    }
    return String(item);
  };
  return getId(a).localeCompare(getId(b));
}

/**
 * Deterministically sorts object keys recursively to produce canonical JSON.
 * Sorts 'nodes' and 'edges' arrays by ID for graph permutation invariance.
 */
function canonicalize(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(canonicalize);
  }

  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const result: Record<string, unknown> = {};

  for (const key of sortedKeys) {
    const value = (obj as Record<string, unknown>)[key];
    if ((key === 'nodes' || key === 'edges') && Array.isArray(value)) {
      result[key] = [...value].sort(sortById).map(canonicalize);
    } else {
      result[key] = canonicalize(value);
    }
  }

  return result;
}

/**
 * Computes deterministic SHA-256 hex digest of an object snapshot
 */
export function computeWorkflowChecksum(snapshot: unknown): string {
  const canonicalObj = canonicalize(snapshot);
  const jsonString = JSON.stringify(canonicalObj);
  return createHash('sha256').update(jsonString, 'utf8').digest('hex');
}
