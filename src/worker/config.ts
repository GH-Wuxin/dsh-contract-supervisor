import { WorkerError, WORKER_ERROR_CODES } from './errors.js';
import type { FrozenWorkerConfig } from './types.js';
import {
  isUniqueSubsetOfSliceFsTools,
  SLICE_FS_TOOL_NAMES,
} from '../fs/toolNames.js';
import {
  WORKER_MODEL,
  WORKER_PRESENTATION,
  WORKER_ROLE,
} from './types.js';

/**
 * Kept only for diagnostics/reporting. C4A no longer treats the allowlist as
 * deny-all; any name outside the exact audited S5 tool universe is invalid.
 * This constant intentionally contains no independently maintained names.
 */
export const FORBIDDEN_WORKER_TOOLS: readonly string[] = Object.freeze([]);

export const SUPPORTED_WORKER_TOOLS: readonly string[] = SLICE_FS_TOOL_NAMES;

function invalid(message: string): WorkerError {
  return new WorkerError(WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID, message);
}

export function assertValidWorkerConfig(config: FrozenWorkerConfig): void {
  if (config.role !== WORKER_ROLE) {
    throw invalid(
      `Worker role must be '${WORKER_ROLE}', received '${String(config.role)}'`,
    );
  }

  if (config.provider !== 'deepseek-ai') {
    throw invalid(
      `Worker provider must be 'deepseek-ai', received '${String(config.provider)}'`,
    );
  }

  if (config.model !== WORKER_MODEL) {
    throw invalid(
      `Worker model must be '${WORKER_MODEL}', received '${String(config.model)}'`,
    );
  }

  if (config.presentation !== WORKER_PRESENTATION) {
    throw invalid(
      `Worker presentation must be '${WORKER_PRESENTATION}', received '${String(config.presentation)}'`,
    );
  }

  if (config.oneShot !== true) {
    throw invalid('Worker must be configured as oneShot=true');
  }

  if (config.maxDepth !== 1) {
    throw invalid(
      `Worker maxDepth must be exactly 1, received '${String(config.maxDepth)}'`,
    );
  }

  if (!Array.isArray(config.toolAllowlist)) {
    throw invalid('Worker toolAllowlist must be an array');
  }

  // C4A: FrozenWorkerConfig.toolAllowlist is a Supervisor-owned UPPER BOUND.
  // It may be any duplicate-free subset of the exact four audited FS tools.
  // No arbitrary string may become a worker tool.
  if (!isUniqueSubsetOfSliceFsTools(config.toolAllowlist)) {
    const rendered = config.toolAllowlist.map((tool) => String(tool)).join(', ');
    throw invalid(
      `Worker toolAllowlist must be a duplicate-free subset of [${SLICE_FS_TOOL_NAMES.join(', ')}], received [${rendered}]`,
    );
  }
}

export function freezeWorkerConfig(config: FrozenWorkerConfig): FrozenWorkerConfig {
  assertValidWorkerConfig(config);
  return Object.freeze({
    ...config,
    toolAllowlist: Object.freeze([...config.toolAllowlist]),
  });
}
