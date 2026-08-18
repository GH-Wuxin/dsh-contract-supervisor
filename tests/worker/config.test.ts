import { describe, expect, it } from 'vitest';
import {
  assertValidWorkerConfig,
  WORKER_ERROR_CODES,
} from '../../src/worker/index.js';
import type { FrozenWorkerConfig } from '../../src/worker/index.js';
import { createTestConfig } from './helpers.js';

describe('worker frozen configuration', () => {
  it('WORKER-19 accepts the exact S4 frozen configuration', () => {
    expect(() => assertValidWorkerConfig(createTestConfig())).not.toThrow();
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
    ['slice_write'],
    ['structured_output'],
    ['random_future_tool'],
  ])('WORKER-19 rejects non-empty allowlist [%s]', (tool) => {
    const bad = createTestConfig([tool]);
    expect(() => assertValidWorkerConfig(bad)).toThrowError(
      expect.objectContaining({ code: WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID }),
    );
  });
});
