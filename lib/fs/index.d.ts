export { FS_ERROR_CODES, FsError, SliceFsError, TRUSTED_FS_VIOLATION_CODES, isTrustedFsViolationCode } from './errors.js';
export type { FsErrorCode } from './errors.js';
export { SLICE_FS_TOOL_NAMES, isSliceFsToolName, isUniqueSubsetOfSliceFsTools, } from './toolNames.js';
export type { SliceFsToolName } from './toolNames.js';
export { createSliceFsAuthority, hasWriteOperation, hasWritePath, isPreparedSliceFsAuthority, isReadPathAllowed, isReadSearchRootAllowed, pathKey, resolveAuthorityPath, } from './authority.js';
export type { PreparedReadRule, PreparedSliceFsAuthority, PreparedWriteRule, } from './authority.js';
export { assertInsideRoot, assertSameFileIdentity, canonicalizeRepositoryRoot, inspectPathNoSymlinks, inspectPathNoSymlinksWithOps, isInsideRoot, portableRelative, resolveRequestPath, validateRequestPath, } from './path.js';
export type { PathInspection, PathInspectionMode, PathInspectionOptions, PathLstat, RequestPathResolution, } from './path.js';
export { createSliceFsSessionRegistry, SliceFsSessionRegistry, } from './session.js';
export type { SliceFsSessionBinding } from './session.js';
export { createSliceFsRuntime, SliceFsRuntime, sliceEdit, sliceRead, sliceSearch, sliceWrite, } from './runtime.js';
export type { SliceFsRuntimeOptions } from './runtime.js';
export { createSliceFsToolDefinitions, resolveSliceFsSessionFromExecution, } from './definitions.js';
export type { SliceFsSessionResolver } from './definitions.js';
export type { SliceEditRequest, SliceFsAuthority, SliceFsEditResult, SliceFsReadResult, SliceFsSearchMatch, SliceFsSearchResult, SliceFsWriteResult, SliceReadRequest, SliceSearchRequest, SliceWriteRequest, } from './types.js';
//# sourceMappingURL=index.d.ts.map