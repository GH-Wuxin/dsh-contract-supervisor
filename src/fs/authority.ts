import {
  isAbsolute,
  relative,
  resolve,
} from 'node:path';
import type { WriteOperation } from '../domain/types.js';
import { FsError, FS_ERROR_CODES } from './errors.js';
import {
  canonicalizeRepositoryRoot,
  isInsideRoot,
  portableRelative,
  resolveRequestPath,
  validateRequestPath,
} from './path.js';
import type { SliceFsAuthority } from './types.js';

const AUTHORITY_BRAND = Symbol('dsh-contract-supervisor.sliceFsAuthority');

export interface PreparedReadRule {
  readonly raw: string;
  readonly relative: string;
  readonly key: string;
  readonly recursive: boolean;
  readonly absoluteRoot: string;
}

export interface PreparedWriteRule {
  readonly rawPath: string;
  readonly relative: string;
  readonly key: string;
  readonly operation: WriteOperation;
}

export interface PreparedSliceFsAuthority extends SliceFsAuthority {
  readonly readRules: readonly PreparedReadRule[];
  readonly writeRules: readonly PreparedWriteRule[];
  readonly recursiveReadPrefixes: readonly string[];
}

/**
 * Security-critical lookup structures are intentionally module-private.
 * `ReadonlySet`/`ReadonlyMap` alone would not stop caller-side mutation if the
 * same containers were exposed on the prepared authority object.
 */
interface PreparedAuthorityInternals {
  readonly exactReadPaths: ReadonlySet<string>;
  readonly writeOperations: ReadonlyMap<string, ReadonlySet<WriteOperation>>;
}

const preparedAuthorityInternals = new WeakMap<object, PreparedAuthorityInternals>();

function authorityInvalid(message: string): FsError {
  return new FsError(FS_ERROR_CODES.FS_AUTHORITY_CONFIG_INVALID, message);
}

function validateSessionIdentity(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
    throw authorityInvalid(`${field} must be a non-empty string of at most 1024 characters`);
  }
  if (value.includes('\0')) {
    throw authorityInvalid(`${field} must not contain NUL`);
  }
  return value;
}

/**
 * Canonicalize one Supervisor-owned authority path. Frozen Slice paths are
 * POSIX-style relative paths; they must not contain `.` or `..` and must not
 * escape the repository root.
 */
function normalizeAuthorityBase(repoRoot: string, input: string, field: string): {
  relative: string;
  absolute: string;
  key: string;
} {
  if (typeof input !== 'string' || input.length === 0 || input.length > 32_768) {
    throw authorityInvalid(`${field} must be a non-empty string`);
  }
  if (input.includes('\0')) {
    throw authorityInvalid(`${field} must not contain NUL`);
  }

  const portable = input.replace(/\\/g, '/');
  if (isAbsolute(input) || /^[A-Za-z]:/.test(portable)) {
    throw authorityInvalid(`${field} must be repo-relative, received '${input}'`);
  }
  try {
    validateRequestPath(portable);
  } catch (error) {
    throw authorityInvalid(
      `${field} is not a safe repo-relative path: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const segments = portable.split('/');
  if (
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw authorityInvalid(
      `${field} must be normalized (no empty, '.' or '..' segments), received '${input}'`,
    );
  }

  const absolute = resolve(repoRoot, portable);
  if (!isInsideRoot(repoRoot, absolute)) {
    throw authorityInvalid(`${field} escapes the repository root: '${input}'`);
  }

  const relPath = relative(repoRoot, absolute);
  if (relPath === '') {
    throw authorityInvalid(`${field} cannot be the repository root itself`);
  }

  return {
    relative: portableRelative(relPath),
    absolute,
    key: pathKey(portableRelative(relPath)),
  };
}

export function pathKey(relativePath: string): string {
  const portable = relativePath.replace(/\\/g, '/');
  return process.platform === 'win32' ? portable.toLowerCase() : portable;
}

function buildWriteOperations(
  rules: readonly PreparedWriteRule[],
): Map<string, Set<WriteOperation>> {
  const map = new Map<string, Set<WriteOperation>>();
  for (const rule of rules) {
    const existing = map.get(rule.key);
    if (existing === undefined) {
      map.set(rule.key, new Set([rule.operation]));
    } else {
      existing.add(rule.operation);
    }
  }
  return map;
}

function getPreparedAuthorityInternals(
  authority: PreparedSliceFsAuthority,
): PreparedAuthorityInternals {
  const internals = preparedAuthorityInternals.get(authority);
  if (internals === undefined) {
    throw authorityInvalid('Prepared authority internals are missing');
  }
  return internals;
}

export function isPreparedSliceFsAuthority(
  value: SliceFsAuthority,
): value is PreparedSliceFsAuthority {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as unknown as Record<PropertyKey, unknown>)[AUTHORITY_BRAND] === true &&
    preparedAuthorityInternals.has(value as object)
  );
}

/**
 * Freeze the Supervisor-owned authority that is later bound to one worker
 * session. The repo root is realpath'ed once here; audited tools never accept
 * a root from model arguments.
 */
export function createSliceFsAuthority(input: SliceFsAuthority): PreparedSliceFsAuthority {
  if (typeof input !== 'object' || input === null) {
    throw authorityInvalid('SliceFsAuthority input must be an object');
  }

  const sliceId = validateSessionIdentity(input.sliceId, 'sliceId');

  const repoRoot = canonicalizeRepositoryRoot(input.repoRoot);
  if (!Array.isArray(input.allowedReads) || !Array.isArray(input.allowedWrites)) {
    throw authorityInvalid('allowedReads and allowedWrites must be arrays');
  }

  const readRules: PreparedReadRule[] = input.allowedReads.map((entry, index) => {
    const field = `allowedReads[${index}]`;
    if (typeof entry !== 'string' || entry.length === 0) {
      throw authorityInvalid(`${field} must be a non-empty string`);
    }

    const portable = entry.replace(/\\/g, '/');
    if (portable.endsWith('/**')) {
      const base = portable.slice(0, -3);
      if (base.length === 0 || base.endsWith('/')) {
        throw authorityInvalid(`${field} recursive pattern '${entry}' has no directory prefix`);
      }
      const normalized = normalizeAuthorityBase(repoRoot, base, field);
      return {
        raw: entry,
        relative: normalized.relative,
        key: normalized.key,
        recursive: true,
        absoluteRoot: normalized.absolute,
      };
    }

    if (/[*?[\]{}]/.test(portable)) {
      throw authorityInvalid(
        `${field} uses unsupported wildcard syntax; only exact paths and 'dir/**' are supported`,
      );
    }

    const normalized = normalizeAuthorityBase(repoRoot, portable, field);
    return {
      raw: entry,
      relative: normalized.relative,
      key: normalized.key,
      recursive: false,
      absoluteRoot: normalized.absolute,
    };
  });

  const writeRules: PreparedWriteRule[] = input.allowedWrites.map((rule, index) => {
    const field = `allowedWrites[${index}]`;
    if (typeof rule !== 'object' || rule === null || typeof rule.path !== 'string') {
      throw authorityInvalid(`${field} must have a string path`);
    }
    if (rule.operation !== 'create' && rule.operation !== 'update') {
      throw authorityInvalid(`${field} operation must be 'create' or 'update'`);
    }
    const normalized = normalizeAuthorityBase(repoRoot, rule.path, `${field}.path`);
    return {
      rawPath: rule.path,
      relative: normalized.relative,
      key: normalized.key,
      operation: rule.operation,
    };
  });

  const writeOperations = buildWriteOperations(writeRules);
  const exactReadPaths = new Set(
    readRules.filter((rule) => !rule.recursive).map((rule) => rule.key),
  );

  const prepared: PreparedSliceFsAuthority = {
    repoRoot,
    sliceId,
    allowedReads: Object.freeze([...input.allowedReads]),
    allowedWrites: Object.freeze(
      input.allowedWrites.map((rule) => Object.freeze({ ...rule })),
    ),
    readRules: Object.freeze(readRules.map((rule) => Object.freeze(rule))),
    writeRules: Object.freeze(writeRules.map((rule) => Object.freeze(rule))),
    recursiveReadPrefixes: Object.freeze(
      readRules.filter((rule) => rule.recursive).map((rule) => rule.key),
    ),
  };

  preparedAuthorityInternals.set(prepared, {
    exactReadPaths,
    writeOperations,
  });

  Object.defineProperty(prepared, AUTHORITY_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(prepared);
}

export function isReadPathAllowed(
  authority: PreparedSliceFsAuthority,
  relativePath: string,
): boolean {
  const key = pathKey(relativePath);
  const internals = getPreparedAuthorityInternals(authority);
  if (internals.exactReadPaths.has(key)) {
    return true;
  }
  return authority.recursiveReadPrefixes.some((prefix) =>
    key.startsWith(`${prefix}/`),
  );
}

/**
 * Search roots may name a directory that only exists as a recursive
 * `dir/**` authority prefix. That does not make `dir/outside` readable; the
 * walk still filters every file through isReadPathAllowed.
 */
export function isReadSearchRootAllowed(
  authority: PreparedSliceFsAuthority,
  relativePath: string,
): boolean {
  const key = pathKey(relativePath);
  const internals = getPreparedAuthorityInternals(authority);
  if (internals.exactReadPaths.has(key)) {
    return true;
  }
  return authority.recursiveReadPrefixes.some(
    (prefix) => key === prefix || key.startsWith(`${prefix}/`),
  );
}

export function hasWritePath(
  authority: PreparedSliceFsAuthority,
  relativePath: string,
): boolean {
  return getPreparedAuthorityInternals(authority).writeOperations.has(
    pathKey(relativePath),
  );
}

export function hasWriteOperation(
  authority: PreparedSliceFsAuthority,
  relativePath: string,
  operation: WriteOperation,
): boolean {
  return (
    getPreparedAuthorityInternals(authority)
      .writeOperations.get(pathKey(relativePath))
      ?.has(operation) ?? false
  );
}

export function resolveAuthorityPath(
  authority: PreparedSliceFsAuthority,
  rawPath: unknown,
): ReturnType<typeof resolveRequestPath> {
  return resolveRequestPath(authority.repoRoot, rawPath);
}
