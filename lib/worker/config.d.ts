import type { FrozenWorkerConfig } from './types.js';
/**
 * Kept only for diagnostics/reporting. C4A no longer treats the allowlist as
 * deny-all; any name outside the exact audited S5 tool universe is invalid.
 * This constant intentionally contains no independently maintained names.
 */
export declare const FORBIDDEN_WORKER_TOOLS: readonly string[];
export declare const SUPPORTED_WORKER_TOOLS: readonly string[];
export declare function assertValidWorkerConfig(config: FrozenWorkerConfig): void;
export declare function freezeWorkerConfig(config: FrozenWorkerConfig): FrozenWorkerConfig;
//# sourceMappingURL=config.d.ts.map