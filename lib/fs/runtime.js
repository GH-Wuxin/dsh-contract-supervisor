/**
 * Supervisor-owned audited filesystem runtime.
 *
 * Ordering: parse tool args -> trusted session binding -> path
 * canonicalization -> repo containment -> exact Slice authority ->
 * symlink/junction traversal check -> identity/hardlink check -> mutation.
 *
 * TOCTOU BOUNDARY (S5 MVP): a malicious concurrent local process racing the
 * filesystem between lstat/open and mutation is outside this Slice. The
 * implementation still avoids avoidable self-TOCTOU: no raw path is
 * authorized and later resolved, and lstat/open/mutation are tightly scoped
 * with identity re-verification on the opened handle. No staging/temp files
 * are used; mutation happens through the verified open handle.
 */
import { lstat, open, readdir, readFile, unlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { hasWriteOperation, hasWritePath, isReadPathAllowed, isReadSearchRootAllowed, } from './authority.js';
import { FsError, FS_ERROR_CODES, isTrustedFsViolationCode, } from './errors.js';
import { assertSameFileIdentity, inspectPathNoSymlinksWithOps, portableRelative, resolveRequestPath, } from './path.js';
import { createSliceFsSessionRegistry } from './session.js';
function invalidArgs(message) {
    return new FsError(FS_ERROR_CODES.FS_INVALID_ARGUMENT, message);
}
function readScopeViolation(path) {
    return new FsError(FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION, `Path '${path}' is outside this Slice's allowedReads authority`);
}
function writeScopeViolation(path, detail) {
    return new FsError(FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION, `Path '${path}' is outside this Slice's allowedWrites authority${detail ?? ''}`);
}
function operationFailure(message) {
    return new FsError(FS_ERROR_CODES.FILESYSTEM_OPERATION_FAILED, message);
}
function identityUnsafe(message) {
    return new FsError(FS_ERROR_CODES.TARGET_IDENTITY_UNSAFE, message);
}
function symlinkBlock(message) {
    return new FsError(FS_ERROR_CODES.SYMLINK_POLICY_BLOCK, message);
}
function editMismatch(message) {
    return new FsError(FS_ERROR_CODES.SLICE_EDIT_MISMATCH, message);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseExactArgs(toolName, args, allowedKeys) {
    if (!isRecord(args)) {
        throw invalidArgs(`${toolName} arguments must be an object`);
    }
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(args)) {
        if (!allowed.has(key)) {
            throw invalidArgs(`${toolName} does not accept field '${key}'; filesystem authority can never be supplied by tool arguments`);
        }
    }
    for (const key of allowedKeys) {
        if (!Object.prototype.hasOwnProperty.call(args, key)) {
            throw invalidArgs(`${toolName} requires field '${key}'`);
        }
    }
    return args;
}
function requireString(value, field) {
    if (typeof value !== 'string') {
        throw invalidArgs(`${field} must be a string`);
    }
    if (value.includes('\0')) {
        throw invalidArgs(`${field} must not contain NUL`);
    }
    return value;
}
function resolveReadPath(authority, rawPath) {
    const resolved = resolveRequestPath(authority.repoRoot, rawPath);
    if (!resolved.ok) {
        throw readScopeViolation(typeof rawPath === 'string' ? rawPath : String(rawPath));
    }
    if (resolved.relative === '') {
        throw invalidArgs('path resolves to the repository root itself');
    }
    if (!isReadPathAllowed(authority, resolved.relative)) {
        throw readScopeViolation(resolved.relative);
    }
    return resolved;
}
function resolveWritePath(authority, rawPath) {
    const resolved = resolveRequestPath(authority.repoRoot, rawPath);
    if (!resolved.ok) {
        throw writeScopeViolation(typeof rawPath === 'string' ? rawPath : String(rawPath));
    }
    if (resolved.relative === '') {
        throw invalidArgs('path resolves to the repository root itself');
    }
    if (!hasWritePath(authority, resolved.relative)) {
        throw writeScopeViolation(resolved.relative);
    }
    return resolved;
}
function resolveSearchRootPath(authority, rawPath) {
    const resolved = resolveRequestPath(authority.repoRoot, rawPath);
    if (!resolved.ok) {
        throw readScopeViolation(typeof rawPath === 'string' ? rawPath : String(rawPath));
    }
    if (resolved.relative === '') {
        throw invalidArgs('path resolves to the repository root itself');
    }
    if (!isReadSearchRootAllowed(authority, resolved.relative)) {
        throw readScopeViolation(resolved.relative);
    }
    return resolved;
}
function isErrno(error, code) {
    return (typeof error === 'object' &&
        error !== null &&
        error.code === code);
}
async function closeQuietly(handle) {
    try {
        await handle.close();
    }
    catch {
        // The operation already settled. A close failure on a read-only path is
        // non-authoritative and must not turn a successful audited read into a
        // fake violation.
    }
}
async function openVerifiedExistingFile(absolute, before) {
    if (!before.isFile()) {
        throw identityUnsafe(`Target '${absolute}' is not a regular file`);
    }
    if (!Number.isInteger(before.nlink) || before.nlink !== 1) {
        throw identityUnsafe(`Target '${absolute}' has hardlink count ${String(before.nlink)}; exactly 1 is required`);
    }
    let handle;
    try {
        handle = await open(absolute, 'r+');
    }
    catch (error) {
        throw operationFailure(`Cannot open target '${absolute}': ${error instanceof Error ? error.message : String(error)}`);
    }
    let after;
    try {
        after = await handle.stat();
    }
    catch (error) {
        await closeQuietly(handle);
        throw identityUnsafe(`Cannot obtain open-file identity for '${absolute}': ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!assertSameFileIdentity(before, after)) {
        await closeQuietly(handle);
        throw symlinkBlock(`Target '${absolute}' changed identity between lstat and open; symlink/alias mutation is blocked`);
    }
    if (!after.isFile()) {
        await closeQuietly(handle);
        throw identityUnsafe(`Open target '${absolute}' is not a regular file`);
    }
    if (!Number.isInteger(after.nlink) || after.nlink !== 1) {
        await closeQuietly(handle);
        throw identityUnsafe(`Open target '${absolute}' has hardlink count ${String(after.nlink)}; exactly 1 is required`);
    }
    return { handle, before, after };
}
async function mutateThroughHandle(handle, absolute, content) {
    try {
        // FileHandle.writeFile writes at the current file position. Reading
        // before an edit can leave that position at the previous EOF, so write
        // with an explicit offset after truncating.
        const buffer = Buffer.from(content, 'utf8');
        await handle.truncate(0);
        let written = 0;
        while (written < buffer.length) {
            const result = await handle.write(buffer, written, buffer.length - written, written);
            if (result.bytesWritten === 0) {
                throw new Error('zero-length write progress');
            }
            written += result.bytesWritten;
        }
        await handle.sync();
    }
    catch (error) {
        throw operationFailure(`Cannot write target '${absolute}': ${error instanceof Error ? error.message : String(error)}`);
    }
    return Buffer.byteLength(content, 'utf8');
}
async function createNewFile(absolute, relativePath, content) {
    let handle;
    try {
        handle = await open(absolute, 'wx');
    }
    catch (error) {
        if (isErrno(error, 'EEXIST')) {
            throw operationFailure(`Target '${relativePath}' appeared between authorization and create; no mutation was attempted`);
        }
        throw operationFailure(`Cannot create target '${relativePath}': ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        let after;
        try {
            after = await handle.stat();
        }
        catch (error) {
            throw identityUnsafe(`Cannot obtain identity metadata for newly created '${relativePath}': ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!after.isFile()) {
            throw identityUnsafe(`Newly created target '${relativePath}' is not a regular file`);
        }
        if (!Number.isInteger(after.nlink) || after.nlink !== 1) {
            throw identityUnsafe(`Newly created target '${relativePath}' has hardlink count ${String(after.nlink)}; exactly 1 is required`);
        }
        await handle.writeFile(content, 'utf8');
        await handle.sync();
        return {
            path: relativePath,
            written: true,
            bytes: Buffer.byteLength(content, 'utf8'),
            created: true,
        };
    }
    catch (error) {
        await closeQuietly(handle);
        // New-file policy: no unsafe or failed create may leave staging residue.
        try {
            await unlink(absolute);
        }
        catch {
            // Best effort cleanup. The original error remains authoritative.
        }
        if (error instanceof FsError) {
            throw error;
        }
        throw operationFailure(`Cannot write newly created target '${relativePath}': ${error instanceof Error ? error.message : String(error)}`);
    }
}
export class SliceFsRuntime {
    sessions;
    lstatImpl;
    constructor(sessions = createSliceFsSessionRegistry(), options = {}) {
        if (options.lstat !== undefined &&
            typeof options.lstat !== 'function') {
            throw invalidArgs('SliceFsRuntime options.lstat must be a function');
        }
        this.sessions = sessions;
        this.lstatImpl = options.lstat ?? lstat;
    }
    async audit(sessionId, operation) {
        const binding = this.sessions.requireBinding(sessionId);
        try {
            return await operation(binding);
        }
        catch (error) {
            if (error instanceof FsError && isTrustedFsViolationCode(error.code)) {
                binding.recordViolation(error);
            }
            throw error;
        }
    }
    async read(sessionId, args) {
        return this.audit(sessionId, async (binding) => {
            const parsed = parseExactArgs('slice_read', args, ['path']);
            const path = requireString(parsed.path, 'path');
            const authority = binding.authority;
            const resolved = resolveReadPath(authority, path);
            const inspection = await inspectPathNoSymlinksWithOps(authority.repoRoot, resolved.absolute, 'read', this.lstatImpl);
            if (inspection.final === 'missing' || inspection.finalStats === null) {
                throw operationFailure(`Read target '${resolved.relative}' does not exist`);
            }
            const before = inspection.finalStats;
            if (!before.isFile()) {
                throw operationFailure(`Read target '${resolved.relative}' is not a regular file`);
            }
            let handle;
            try {
                handle = await open(resolved.absolute, 'r');
            }
            catch (error) {
                throw operationFailure(`Cannot open read target '${resolved.relative}': ${error instanceof Error ? error.message : String(error)}`);
            }
            try {
                const after = await handle.stat();
                if (!assertSameFileIdentity(before, after)) {
                    throw symlinkBlock(`Read target '${resolved.relative}' changed identity between lstat and open`);
                }
                const content = await handle.readFile({ encoding: 'utf8' });
                return { path: resolved.relative, content };
            }
            catch (error) {
                if (error instanceof FsError) {
                    throw error;
                }
                throw operationFailure(`Cannot read target '${resolved.relative}': ${error instanceof Error ? error.message : String(error)}`);
            }
            finally {
                await closeQuietly(handle);
            }
        });
    }
    async write(sessionId, args) {
        return this.audit(sessionId, async (binding) => {
            const parsed = parseExactArgs('slice_write', args, ['path', 'content']);
            const path = requireString(parsed.path, 'path');
            const content = requireString(parsed.content, 'content');
            const authority = binding.authority;
            const resolved = resolveWritePath(authority, path);
            const inspection = await inspectPathNoSymlinksWithOps(authority.repoRoot, resolved.absolute, 'mutate', this.lstatImpl);
            if (inspection.final === 'missing' || inspection.finalStats === null) {
                if (!hasWriteOperation(authority, resolved.relative, 'create')) {
                    throw writeScopeViolation(resolved.relative, ': target does not exist and only update authority is held');
                }
                return createNewFile(resolved.absolute, resolved.relative, content);
            }
            if (!hasWriteOperation(authority, resolved.relative, 'update')) {
                throw writeScopeViolation(resolved.relative, ': target exists and only create authority is held');
            }
            const verified = await openVerifiedExistingFile(resolved.absolute, inspection.finalStats);
            try {
                const bytes = await mutateThroughHandle(verified.handle, resolved.relative, content);
                return {
                    path: resolved.relative,
                    written: true,
                    bytes,
                    created: false,
                };
            }
            finally {
                await closeQuietly(verified.handle);
            }
        });
    }
    async edit(sessionId, args) {
        return this.audit(sessionId, async (binding) => {
            const parsed = parseExactArgs('slice_edit', args, ['path', 'oldText', 'newText']);
            const path = requireString(parsed.path, 'path');
            const oldText = requireString(parsed.oldText, 'oldText');
            const newText = requireString(parsed.newText, 'newText');
            const authority = binding.authority;
            const resolved = resolveWritePath(authority, path);
            if (!hasWriteOperation(authority, resolved.relative, 'update')) {
                throw writeScopeViolation(resolved.relative, ': slice_edit requires update authority for an existing target');
            }
            const inspection = await inspectPathNoSymlinksWithOps(authority.repoRoot, resolved.absolute, 'mutate', this.lstatImpl);
            if (inspection.final === 'missing' || inspection.finalStats === null) {
                throw editMismatch(`Edit target '${resolved.relative}' does not exist`);
            }
            const verified = await openVerifiedExistingFile(resolved.absolute, inspection.finalStats);
            try {
                let beforeText;
                try {
                    beforeText = await verified.handle.readFile({ encoding: 'utf8' });
                }
                catch (error) {
                    throw operationFailure(`Cannot read edit target '${resolved.relative}': ${error instanceof Error ? error.message : String(error)}`);
                }
                if (oldText.length === 0) {
                    throw editMismatch('oldText must be non-empty for deterministic single-occurrence edit');
                }
                const occurrences = beforeText.split(oldText).length - 1;
                if (occurrences !== 1) {
                    throw editMismatch(`Edit target '${resolved.relative}' contains ${occurrences} occurrence(s) of oldText; exactly 1 is required`);
                }
                const index = beforeText.indexOf(oldText);
                const nextText = `${beforeText.slice(0, index)}${newText}${beforeText.slice(index + oldText.length)}`;
                const bytes = await mutateThroughHandle(verified.handle, resolved.relative, nextText);
                return {
                    path: resolved.relative,
                    replaced: true,
                    occurrences: 1,
                    bytes,
                };
            }
            finally {
                await closeQuietly(verified.handle);
            }
        });
    }
    async search(sessionId, args) {
        return this.audit(sessionId, async (binding) => {
            if (!isRecord(args)) {
                throw invalidArgs('slice_search arguments must be an object');
            }
            for (const key of Object.keys(args)) {
                if (key !== 'path' && key !== 'pattern') {
                    throw invalidArgs(`slice_search does not accept field '${key}'; search scope can never be widened by tool arguments`);
                }
            }
            if (!Object.prototype.hasOwnProperty.call(args, 'pattern')) {
                throw invalidArgs("slice_search requires field 'pattern'");
            }
            const pattern = requireString(args.pattern, 'pattern');
            if (pattern.length === 0) {
                throw invalidArgs('pattern must not be empty');
            }
            const searchFiles = await this.collectSearchFiles(binding, args.path);
            const matches = [];
            let filesSearched = 0;
            for (const file of searchFiles) {
                let content;
                try {
                    content = await readFile(file.absolute, 'utf8');
                }
                catch (error) {
                    throw operationFailure(`Cannot search authorized file '${file.relative}': ${error instanceof Error ? error.message : String(error)}`);
                }
                filesSearched += 1;
                const lines = content.split('\n');
                for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
                    const lineText = lines[lineIndex];
                    let fromIndex = 0;
                    while (fromIndex < lineText.length) {
                        const column = lineText.indexOf(pattern, fromIndex);
                        if (column === -1) {
                            break;
                        }
                        matches.push({
                            path: file.relative,
                            line: lineIndex + 1,
                            column: column + 1,
                            lineText,
                        });
                        fromIndex = column + pattern.length;
                    }
                }
            }
            matches.sort((left, right) => {
                if (left.path !== right.path) {
                    return left.path < right.path ? -1 : 1;
                }
                if (left.line !== right.line) {
                    return left.line - right.line;
                }
                return left.column - right.column;
            });
            return {
                pattern,
                filesSearched,
                matches,
            };
        });
    }
    async collectSearchFiles(binding, rawPath) {
        const authority = binding.authority;
        const files = new Map();
        if (rawPath !== undefined) {
            const root = resolveSearchRootPath(authority, rawPath);
            const inspection = await inspectPathNoSymlinksWithOps(authority.repoRoot, root.absolute, 'read', this.lstatImpl);
            if (inspection.final === 'missing' || inspection.finalStats === null) {
                throw operationFailure(`Search root '${root.relative}' does not exist`);
            }
            if (inspection.finalStats.isFile()) {
                files.set(root.relative, { absolute: root.absolute, relative: root.relative });
            }
            else if (inspection.finalStats.isDirectory()) {
                await this.walkAuthorizedDirectory(authority, root.absolute, files);
            }
            else {
                throw operationFailure(`Search root '${root.relative}' is not a regular file or directory`);
            }
            return [...files.values()].sort((a, b) => (a.relative < b.relative ? -1 : 1));
        }
        for (const rule of authority.readRules) {
            // Implicit search must honor the exact same component-wise no-symlink
            // policy as explicit reads. This blocks a symlink/junction at the rule
            // root AND a symlink/junction in any parent component before the rule
            // root is read or walked.
            const inspection = await inspectPathNoSymlinksWithOps(authority.repoRoot, rule.absoluteRoot, 'read', this.lstatImpl, { missingComponents: 'missing' });
            if (inspection.final === 'missing' || inspection.finalStats === null) {
                continue;
            }
            if (rule.recursive) {
                if (!inspection.finalStats.isDirectory()) {
                    throw operationFailure(`Recursive allowedReads entry '${rule.raw}' is not a directory`);
                }
                await this.walkAuthorizedDirectory(authority, rule.absoluteRoot, files);
                continue;
            }
            if (inspection.finalStats.isFile() && isReadPathAllowed(authority, rule.relative)) {
                files.set(rule.relative, { absolute: rule.absoluteRoot, relative: rule.relative });
            }
        }
        return [...files.values()].sort((a, b) => (a.relative < b.relative ? -1 : 1));
    }
    async walkAuthorizedDirectory(authority, absoluteRoot, files) {
        const pending = [absoluteRoot];
        while (pending.length > 0) {
            const directory = pending.pop();
            let entries;
            try {
                entries = await readdir(directory, { withFileTypes: true });
            }
            catch (error) {
                if (isErrno(error, 'ENOENT')) {
                    continue;
                }
                throw operationFailure(`Cannot enumerate authorized directory '${portableRelative(relative(authority.repoRoot, directory))}': ${error instanceof Error ? error.message : String(error)}`);
            }
            for (const entry of entries) {
                if (entry.isSymbolicLink()) {
                    continue;
                }
                const childAbsolute = join(directory, entry.name);
                const childRelative = portableRelative(relative(authority.repoRoot, childAbsolute));
                if (!isReadPathAllowed(authority, childRelative)) {
                    continue;
                }
                if (entry.isDirectory()) {
                    pending.push(childAbsolute);
                }
                else if (entry.isFile()) {
                    files.set(childRelative, { absolute: childAbsolute, relative: childRelative });
                }
            }
        }
    }
}
export function createSliceFsRuntime(sessions = createSliceFsSessionRegistry(), options = {}) {
    return new SliceFsRuntime(sessions, options);
}
export async function sliceRead(sessions, sessionId, args) {
    return new SliceFsRuntime(sessions).read(sessionId, args);
}
export async function sliceWrite(sessions, sessionId, args) {
    return new SliceFsRuntime(sessions).write(sessionId, args);
}
export async function sliceEdit(sessions, sessionId, args) {
    return new SliceFsRuntime(sessions).edit(sessionId, args);
}
export async function sliceSearch(sessions, sessionId, args) {
    return new SliceFsRuntime(sessions).search(sessionId, args);
}
//# sourceMappingURL=runtime.js.map