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
]);
export function isSliceFsToolName(value) {
    return SLICE_FS_TOOL_NAMES.includes(value);
}
export function isUniqueSubsetOfSliceFsTools(value) {
    if (!Array.isArray(value)) {
        return false;
    }
    const seen = new Set();
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
//# sourceMappingURL=toolNames.js.map