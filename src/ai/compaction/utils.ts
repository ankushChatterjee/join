// ============================================================================
// Smart Context Compaction - Shared Utilities
// ============================================================================

/**
 * Estimate token count from text length.
 * Uses a heuristic of ~4 characters per token (rough approximation for English/mixed content).
 */
export function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compute Jaccard similarity between two sets.
 * Returns 0 for empty sets (no overlap possible).
 * Returns intersection / union otherwise.
 */
export function jaccardSimilarity<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}
