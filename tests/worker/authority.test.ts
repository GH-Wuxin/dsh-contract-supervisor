import { describe, expect, it } from 'vitest';
import {
  authorizeWorkerTool,
  createToolAuthorizer,
  WORKER_ERROR_CODES,
} from '../../src/worker/index.js';

describe('worker tool authority', () => {
  it('WORKER-04 empty allowlist denies every tool including unknown future tools', () => {
    const allowlist: readonly string[] = [];

    for (const tool of [
      'bash',
      'pwsh',
      'run_code',
      'subagent',
      'random_future_tool',
    ]) {
      expect(() => authorizeWorkerTool(tool, allowlist)).toThrowError(
        expect.objectContaining({ code: WORKER_ERROR_CODES.UNAUTHORIZED_TOOL }),
      );
    }
  });

  it('WORKER-04 explicit allowlist only permits listed tools and denies unknown future tools', () => {
    const allowlist = ['read'];

    expect(() => authorizeWorkerTool('read', allowlist)).not.toThrow();
    expect(() => authorizeWorkerTool('random_future_tool', allowlist)).toThrowError(
      expect.objectContaining({ code: WORKER_ERROR_CODES.UNAUTHORIZED_TOOL }),
    );
  });

  it('createToolAuthorizer freezes the allowlist snapshot', () => {
    const mutable = ['read'];
    const authorizer = createToolAuthorizer(mutable);
    mutable.push('bash');

    expect(() => authorizer('read')).not.toThrow();
    expect(() => authorizer('bash')).toThrowError(
      expect.objectContaining({ code: WORKER_ERROR_CODES.UNAUTHORIZED_TOOL }),
    );
  });
});
