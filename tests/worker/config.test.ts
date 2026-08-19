import { describe, expect, it } from 'vitest';
import {
  assertValidWorkerConfig,
  SUPPORTED_WORKER_TOOLS,
  WORKER_ERROR_CODES,
} from '../../src/worker/index.js';
import { SLICE_FS_TOOL_NAMES } from '../../src/fs/index.js';
import type { FrozenWorkerConfig } from '../../src/worker/index.js';
import { createTestConfig } from './helpers.js';

describe('worker frozen configuration', () => {
  it('WORKER-19 accepts the exact S4 frozen configuration', () => {
    expect(() => assertValidWorkerConfig(createTestConfig())).not.toThrow();
  });

  it('C4A accepts every supported audited FS tool in the upper bound', () => {
    expect(() =>
      assertValidWorkerConfig(createTestConfig([...SLICE_FS_TOOL_NAMES])),
    ).not.toThrow();
    expect(() =>
      assertValidWorkerConfig(createTestConfig(['slice_read'])),
    ).not.toThrow();
    expect(() =>
      assertValidWorkerConfig(createTestConfig(['slice_read', 'slice_search'])),
    ).not.toThrow();
    expect(() =>
      assertValidWorkerConfig(createTestConfig(['slice_write', 'slice_edit'])),
    ).not.toThrow();
    expect(SUPPORTED_WORKER_TOOLS).toEqual([...SLICE_FS_TOOL_NAMES]);
  });

  it('WORKER-19 rejects provider != deepseek-ai', () => {
    const bad = {
      ...createTestConfig(),
      provider: 'other',
    } as unknown as FrozenWorkerConfig;
    expect(() => assertValidWorkerConfig(bad)).toThrowError(
      expect.objectContaining({ code: WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID }),
    );
  });

  it('WORKER-19 rejects model != Flash', () => {
    const bad = {
      ...createTestConfig(),
      model: 'Pro',
    } as unknown as FrozenWorkerConfig;
    expect(() => assertValidWorkerConfig(bad)).toThrowError(
      expect.objectContaining({ code: WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID }),
    );
  });

  it('WORKER-19 rejects presentation != native', () => {
    const bad = {
      ...createTestConfig(),
      presentation: 'code',
    } as unknown as FrozenWorkerConfig;
    expect(() => assertValidWorkerConfig(bad)).toThrowError(
      expect.objectContaining({ code: WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID }),
    );
  });

  it('WORKER-19 rejects oneShot != true', () => {
    const bad = {
      ...createTestConfig(),
      oneShot: false,
    } as unknown as FrozenWorkerConfig;
    expect(() => assertValidWorkerConfig(bad)).toThrowError(
      expect.objectContaining({ code: WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID }),
    );
  });

  it('WORKER-19 rejects maxDepth undefined', () => {
    const bad = {
      ...createTestConfig(),
      maxDepth: undefined,
    } as unknown as FrozenWorkerConfig;
    expect(() => assertValidWorkerConfig(bad)).toThrowError(
      expect.objectContaining({ code: WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID }),
    );
  });

  it('WORKER-19 rejects maxDepth 0', () => {
    const bad = {
      ...createTestConfig(),
      maxDepth: 0,
    } as unknown as FrozenWorkerConfig;
    expect(() => assertValidWorkerConfig(bad)).toThrowError(
      expect.objectContaining({ code: WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID }),
    );
  });

  it('WORKER-19 rejects maxDepth 2', () => {
    const bad = {
      ...createTestConfig(),
      maxDepth: 2,
    } as unknown as FrozenWorkerConfig;
    expect(() => assertValidWorkerConfig(bad)).toThrowError(
      expect.objectContaining({ code: WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID }),
    );
  });

  it('WORKER-19 rejects maxDepth 999', () => {
    const bad = {
      ...createTestConfig(),
      maxDepth: 999,
    } as unknown as FrozenWorkerConfig;
    expect(() => assertValidWorkerConfig(bad)).toThrowError(
      expect.objectContaining({ code: WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID }),
    );
  });

  it.each([
    ['bash'],
    ['pwsh'],
    ['run_code'],
    ['subagent'],
    ['structured_output'],
    ['random_future_tool'],
  ])('C4A rejects unsupported tool [%s]', (tool) => {
    const bad = createTestConfig([tool]);
    expect(() => assertValidWorkerConfig(bad)).toThrowError(
      expect.objectContaining({ code: WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID }),
    );
  });

  it('C4A rejects duplicate tool names in the upper bound', () => {
    const bad = createTestConfig(['slice_read', 'slice_read']);
    expect(() => assertValidWorkerConfig(bad)).toThrowError(
      expect.objectContaining({ code: WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID }),
    );
  });

  it('C4A rejects mixed supported/unsupported tool names', () => {
    const bad = createTestConfig(['slice_read', 'bash']);
    expect(() => assertValidWorkerConfig(bad)).toThrowError(
      expect.objectContaining({ code: WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID }),
    );
  });
});
