import { realpathSync, statSync } from 'node:fs';
import { lstat } from 'node:fs/promises';
import {
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';
import { FsError, FS_ERROR_CODES } from './errors.js';

const MAX_PATH_LENGTH = 32_768;

const WINDOWS_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'CLOCK$',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

function invalidPath(message: string): FsError {
  return new FsError(FS_ERROR_CODES.FS_INVALID_ARGUMENT, message);
}

function invalidOperation(message: string): FsError {
  return new FsError(FS_ERROR_CODES.FILESYSTEM_OPERATION_FAILED, message);
}

function identityUnsafe(message: string): FsError {
  return new FsError(FS_ERROR_CODES.TARGET_IDENTITY_UNSAFE, message);
}

function symlinkBlock(message: string): FsError {
  return new FsError(FS_ERROR_CODES.SYMLINK_POLICY_BLOCK, message);
}

function rootInvalid(message: string): FsError {
  return new FsError(FS_ERROR_CODES.FS_AUTHORITY_CONFIG_INVALID, message);
}

/**
 * Canonicalize the Supervisor-owned repository root exactly once.
 *
 * The caller's alias is resolved here; only the canonical absolute local
 * directory is returned. Subsequent alias retargeting cannot redirect
 * authorities that were frozen from this result.
 */
export function canonicalizeRepositoryRoot(repoRoot: string): string {
  if (
    typeof repoRoot !== 'string' ||
    repoRoot.length === 0 ||
    repoRoot.includes('\0')
  ) {
    throw rootInvalid('repository root must be a non-empty string without NUL');
  }

  let canonical: string;
  try {
    canonical = realpathSync(repoRoot);
  } catch (error) {
    throw rootInvalid(
      `Cannot canonicalize repository root '${String(repoRoot)}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!isAbsolute(canonical)) {
    throw rootInvalid('repository root must resolve to an absolute path');
  }

  if (
    process.platform === 'win32' &&
    (canonical.startsWith('\\') || parse(canonical).root.startsWith('\\'))
  ) {
    throw rootInvalid(
      'UNC/network repository roots are outside the S5 local-filesystem MVP',
    );
  }

  let stats;
  try {
    stats = statSync(canonical);
  } catch (error) {
    throw rootInvalid(
      `Cannot inspect canonical repository root '${canonical}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!stats.isDirectory()) {
    throw rootInvalid(`Repository root '${canonical}' is not a directory`);
  }

  return canonical;
}

export function portableRelative(relativePath: string): string {
  return relativePath.split(sep).join('/');
}

export function isInsideRoot(root: string, absolutePath: string): boolean {
  const rel = relative(root, absolutePath);
  if (rel === '') {
    return true;
  }
  if (isAbsolute(rel)) {
    return false;
  }
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

function validateWindowsRequestAliases(rawPath: string): void {
  // Drive-relative forms such as C:foo use the target drive's current
  // directory and are never a legal repo-relative request.
  if (/^[A-Za-z]:[^\\/]/.test(rawPath)) {
    throw invalidPath('Drive-relative paths are not accepted');
  }

  // Alternate data streams are a different filesystem identity from the file
  // named in allowedWrites. Reject them outright on Windows.
  const withoutDrive = rawPath.replace(/^[A-Za-z]:[\\/][\\/]?/, '');
  if (withoutDrive.includes(':')) {
    throw invalidPath('Paths containing drive/stream colons are not accepted');
  }

  const segments = rawPath.split(/[\\/]+/).filter((segment) => segment !== '');

  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      // path.resolve handles these; they are not themselves an alias.
      continue;
    }

    // Trailing dots/spaces are Win32 aliases for the same name and must not be
    // accepted as exact targets.
    if (/[. ]$/.test(segment)) {
      throw invalidPath('Windows path segments may not end in a dot or space');
    }

    const base = segment.split('.')[0].toUpperCase();
    if (WINDOWS_RESERVED_NAMES.has(base)) {
      throw invalidPath(`Windows device name '${segment}' is not a regular file path`);
    }
  }
}

export function validateRequestPath(rawPath: unknown): asserts rawPath is string {
  if (typeof rawPath !== 'string') {
    throw invalidPath('path must be a string');
  }
  if (rawPath.length === 0) {
    throw invalidPath('path must not be empty');
  }
  if (rawPath.length > MAX_PATH_LENGTH) {
    throw invalidPath('path is too long');
  }
  if (rawPath.includes('\0')) {
    throw invalidPath('path must not contain NUL');
  }

  if (process.platform === 'win32') {
    validateWindowsRequestAliases(rawPath);
  }
}

export type RequestPathResolution =
  | {
      readonly ok: true;
      readonly absolute: string;
      readonly relative: string;
    }
  | {
      readonly ok: false;
      readonly outside: true;
      readonly absolute: string;
      readonly relative: string;
    };

/**
 * Canonicalize a model-supplied request path against the frozen repository
 * root WITHOUT touching the filesystem in a way that follows symlinks.
 *
 * `path.resolve` removes `.`, `..` and duplicate separators and yields one
 * absolute normalized path. Containment is checked on that normalized path
 * before any lstat/open work occurs.
 */
export function resolveRequestPath(
  repoRoot: string,
  rawPath: unknown,
): RequestPathResolution {
  validateRequestPath(rawPath);

  const absolute = resolve(repoRoot, rawPath);
  if (!isInsideRoot(repoRoot, absolute)) {
    return {
      ok: false,
      outside: true,
      absolute,
      relative: portableRelative(relative(repoRoot, absolute)),
    };
  }

  return {
    ok: true,
    absolute,
    relative: portableRelative(relative(repoRoot, absolute)),
  };
}

export function assertInsideRoot(repoRoot: string, absolute: string): void {
  if (!isInsideRoot(repoRoot, absolute)) {
    throw invalidOperation('Path escaped the frozen repository root');
  }
}

export type PathInspectionMode = 'read' | 'mutate';

export interface PathInspection {
  readonly final: 'present' | 'missing';
  readonly finalStats: Awaited<ReturnType<typeof lstat>> | null;
}

/** Narrow injectable lstat seam for deterministic identity-failure tests. */
export type PathLstat = (path: string) => Promise<Awaited<ReturnType<typeof lstat>>>;

export interface PathInspectionOptions {
  /** Search collection treats any missing component as a missing rule root. */
  readonly missingComponents?: 'error' | 'missing';
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === code
  );
}

/**
 * Walk each component from the repository root and lstat it. lstat never
 * follows a final symlink or a parent junction, so this is the S5
 * SYMLINK_POLICY_BLOCK checkpoint. The returned final lstat result is the
 * identity snapshot used for regular-file/hardlink checks.
 */
export async function inspectPathNoSymlinksWithOps(
  repoRoot: string,
  absolute: string,
  mode: PathInspectionMode,
  lstatImpl: PathLstat,
  options: PathInspectionOptions = {},
): Promise<PathInspection> {
  assertInsideRoot(repoRoot, absolute);

  const rel = relative(repoRoot, absolute);
  if (rel === '') {
    throw invalidPath('path resolves to the repository root itself');
  }

  const segments = rel.split(sep).filter((segment) => segment !== '');
  if (segments.length === 0) {
    throw invalidPath('path has no filesystem components');
  }

  let current = repoRoot;
  let previousStats: Awaited<ReturnType<typeof lstat>> | null = null;

  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    const isFinal = index === segments.length - 1;

    let stats: Awaited<ReturnType<typeof lstat>>;
    try {
      stats = await lstatImpl(current);
    } catch (error) {
      if (
        isErrno(error, 'ENOENT') &&
        (isFinal || options.missingComponents === 'missing')
      ) {
        if (previousStats !== null && !previousStats.isDirectory()) {
          throw invalidOperation(
            `Parent of '${relative(repoRoot, current)}' is not a directory`,
          );
        }
        return { final: 'missing', finalStats: null };
      }

      if (mode === 'read') {
        throw invalidOperation(
          `Cannot inspect '${relative(repoRoot, current)}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      if (isFinal) {
        throw identityUnsafe(
          `Cannot obtain identity metadata for '${relative(repoRoot, current)}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      if (isErrno(error, 'ENOENT')) {
        throw invalidOperation(
          `Parent directory '${relative(repoRoot, current)}' does not exist`,
        );
      }

      throw identityUnsafe(
        `Cannot verify traversal identity for '${relative(repoRoot, current)}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (stats.isSymbolicLink()) {
      throw symlinkBlock(
        `Path '${portableRelative(relative(repoRoot, current))}' traverses symlink/junction component '${segments[index]}'`,
      );
    }

    if (!isFinal && !stats.isDirectory()) {
      throw invalidOperation(
        `Path component '${segments[index]}' is not a directory`,
      );
    }

    previousStats = stats;
  }

  return {
    final: 'present',
    finalStats: previousStats,
  };
}

export async function inspectPathNoSymlinks(
  repoRoot: string,
  absolute: string,
  mode: PathInspectionMode,
): Promise<PathInspection> {
  return inspectPathNoSymlinksWithOps(repoRoot, absolute, mode, lstat);
}

export function isRegularFileStats(
  stats: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return stats.isFile();
}

export function assertSameFileIdentity(
  before: Awaited<ReturnType<typeof lstat>>,
  after: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return before.dev === after.dev && before.ino === after.ino;
}
