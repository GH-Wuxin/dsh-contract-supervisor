/**
 * Single source of truth for the exact audited S5 worker-tool universe.
 *
 * This module is intentionally pure metadata/constants only. It imports
 * nothing from the worker or fs runtime layers so both worker configuration
 * validation and S5 tool registration can derive from the same frozen list
 * without creating a circular dependency.
 */
export const SLICE_FS_TOOL_NAMES = Object.freeze([
  'slice_read',
  'slice_search',
  'slice_write',
  'slice_edit',
] as const);

export type SliceFsToolName = (typeof SLICE_FS_TOOL_NAMES)[number];

export function isSliceFsToolName(value: string): value is SliceFsToolName {
  return (SLICE_FS_TOOL_NAMES as readonly string[]).includes(value);
}

export function isUniqueSubsetOfSliceFsTools(
  value: readonly string[],
): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  const seen = new Set<string>();
  for (const name of value) {
    if (typeof name !== 'string' || !isSliceFsToolName(name)) {
      return false;
    }
    if (seen.has(name)) {
      return false;
    }
    seen.add(name);
  }
  return true;
}
