import { WorkerError, WORKER_ERROR_CODES } from './errors.js';
import type { FrozenWorkerConfig } from './types.js';
import {
  WORKER_MODEL,
  WORKER_PRESENTATION,
  WORKER_ROLE,
} from './types.js';

/**
 * Kept only for diagnostics/reporting. It is NOT the authority source for S4:
 * the only legal allowlist is the empty list.
 */
export const FORBIDDEN_WORKER_TOOLS: readonly string[] = Object.freeze([
  'bash',
  'pwsh',
  'shell',
  'run_code',
  'subagent',
  'spawn',
  'workflow',
  'ralph',
  'jobs',
  'delegation',
]);

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

  // S4 positive allow policy: the only legal allowlist is [].
  // Unknown future tools are rejected by default because they are not in the
  // exact frozen allowlist.
  if (config.toolAllowlist.length !== 0) {
    throw invalid(
      `Worker toolAllowlist must be exactly [], received [${config.toolAllowlist.join(', ')}]`,
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
