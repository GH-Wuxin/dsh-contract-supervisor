import {
  admitSlice,
  createSupervisorRuntimeState,
} from '../../src/state/index.js';
import type { SupervisorRuntimeState } from '../../src/state/index.js';
import type { FrozenWorkerConfig } from '../../src/worker/index.js';

export function createTestRuntime(): SupervisorRuntimeState {
  const contract = {
    contractHash: 'contract',
    readAuthority: [],
    writeAuthority: [],
    verifierCatalog: [],
    workerToolAllowlist: [],
  };

  const slice = {
    contractHash: 'contract',
    sliceHash: 'slice',
    maxAttempts: 3,
    allowedReads: [],
    allowedWrites: [],
    verifierRefs: [],
    regressionVerifierRefs: [],
    workerToolAllowlist: [],
  };

  return admitSlice(createSupervisorRuntimeState(), contract, slice);
}

export function createTestConfig(
  toolAllowlist: readonly string[] = [],
  maxDepth = 1,
): FrozenWorkerConfig {
  return {
    role: 'implementation_worker',
    provider: 'deepseek-ai',
    model: 'Flash',
    presentation: 'native',
    oneShot: true,
    toolAllowlist: [...toolAllowlist],
    maxDepth,
  };
}
