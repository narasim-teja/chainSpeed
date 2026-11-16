/**
 * How long checkpoint record bundles (the raw records behind each Merkle root) are kept (F20).
 *
 * Evidence and privacy pull in opposite directions: a contested ticket can arrive weeks after a
 * drive, but every day of retained GPS trace is a privacy cost. 30 days is the compromise; the
 * bundles are encrypted at rest, and anything older (or orphaned) is deleted along with its tree.
 */
export const CHECKPOINT_RETENTION_DAYS = 30;
export const CHECKPOINT_RETENTION_MS = CHECKPOINT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const BUNDLE_PREFIXES = ['records_', 'merkle_tree_'] as const;

/** Storage keys of record bundles and trees whose checkpoint is no longer retained. */
export function staleBundleKeys(allKeys: readonly string[], retainedRoots: ReadonlySet<string>): string[] {
  return allKeys.filter((key) => {
    const prefix = BUNDLE_PREFIXES.find((p) => key.startsWith(p));
    return prefix !== undefined && !retainedRoots.has(key.slice(prefix.length));
  });
}
