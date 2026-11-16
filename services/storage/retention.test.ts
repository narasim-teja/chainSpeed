// Run with: bun test services
import { describe, expect, test } from 'bun:test';
import { staleBundleKeys } from './retention';

describe('staleBundleKeys', () => {
  test('selects bundles and trees whose checkpoint is no longer retained, and nothing else', () => {
    const keys = ['records_0xaa', 'merkle_tree_0xaa', 'records_0xbb', 'merkle_tree_0xbb', 'merkle_tree_0xcc', 'speed_records', 'merkle_checkpoints'];
    expect(staleBundleKeys(keys, new Set(['0xaa'])).sort()).toEqual(['merkle_tree_0xbb', 'merkle_tree_0xcc', 'records_0xbb']);
  });

  test('keeps everything when every root is retained', () => {
    expect(staleBundleKeys(['records_0xaa', 'merkle_tree_0xaa'], new Set(['0xaa']))).toEqual([]);
  });
});
