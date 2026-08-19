/**
 * Single source of truth for the exact audited S5 worker-tool universe.
 *
 * This module is intentionally pure metadata/constants only. It imports
 * nothing from the worker or fs runtime layers so both worker configuration
 * validation and S5 tool registration can derive from the same frozen list
 * without creating a circular dependency.
 */
export declare const SLICE_FS_TOOL_NAMES: readonly ["slice_read", "slice_search", "slice_write", "slice_edit"];
export type SliceFsToolName = (typeof SLICE_FS_TOOL_NAMES)[number];
export declare function isSliceFsToolName(value: string): value is SliceFsToolName;
export declare function isUniqueSubsetOfSliceFsTools(value: readonly string[]): boolean;
//# sourceMappingURL=toolNames.d.ts.map