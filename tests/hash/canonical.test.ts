import { describe, expect, it } from 'vitest';
import { canonicalize, hashCanonical } from '../../src/hash/index.js';
import { DomainError, ERROR_CODES } from '../../src/domain/index.js';

describe('canonical hashing', () => {
  it('HASH-01: object key order does not change canonical representation or hash', () => {
    const first = { a: 1, b: 2 };
    const second = { b: 2, a: 1 };

    expect(canonicalize(first)).toBe(canonicalize(second));
    expect(hashCanonical(first)).toBe(hashCanonical(second));
  });

  it('HASH-02: changing any semantic field changes the hash', () => {
    const base = { a: 1, b: 2 };
    const changed = { a: 1, b: 3 };

    expect(hashCanonical(base)).not.toBe(hashCanonical(changed));
  });

  it('HASH-03: array order is preserved and changes the hash', () => {
    const first = ['a', 'b'];
    const second = ['b', 'a'];

    expect(canonicalize(first)).not.toBe(canonicalize(second));
    expect(hashCanonical(first)).not.toBe(hashCanonical(second));
  });

  it('HASH-04: rejects unsupported values', () => {
    const unsupportedValues: unknown[] = [
      NaN,
      Infinity,
      -Infinity,
      undefined,
      () => undefined,
      Symbol('x'),
      new Date('2020-01-01T00:00:00.000Z'),
      new Map(),
      new Set(),
    ];

    for (const value of unsupportedValues) {
      expect(() => canonicalize(value), String(value)).toThrowError(
        expect.objectContaining({ code: ERROR_CODES.INVALID_CANONICAL_VALUE }),
      );
    }

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => canonicalize(circular)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.INVALID_CANONICAL_VALUE }),
    );

    expect(() => canonicalize({ nested: { ok: 1, bad: undefined } })).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.INVALID_CANONICAL_VALUE }),
    );
  });

  it('supports null, booleans, finite numbers, strings, arrays, and plain objects', () => {
    const value = {
      nil: null,
      yes: true,
      no: false,
      count: 42,
      text: 'hello',
      list: [1, 'two', null],
      nested: { z: 1, a: 2 },
    };

    expect(() => canonicalize(value)).not.toThrow();
    expect(typeof hashCanonical(value)).toBe('string');
  });

  it('does not call arbitrary toJSON methods', () => {
    const value = {
      a: 1,
      bad: {
        toJSON() {
          throw new Error('toJSON must not be called');
        },
      },
    };

    expect(() => canonicalize(value)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.INVALID_CANONICAL_VALUE }),
    );
  });

  it('HASH-05: object getter is rejected without execution', () => {
    let calls = 0;

    const value = {
      get x() {
        calls += 1;
        return 42;
      },
    };

    expect(calls).toBe(0);
    expect(() => canonicalize(value)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.INVALID_CANONICAL_VALUE }),
    );
    expect(calls).toBe(0);
  });

  it('HASH-06: object setter/accessor descriptor is rejected', () => {
    let setterCalls = 0;

    const value: Record<string, unknown> = {};
    Object.defineProperty(value, 'x', {
      enumerable: true,
      configurable: true,
      set() {
        setterCalls += 1;
      },
    });

    expect(() => canonicalize(value)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.INVALID_CANONICAL_VALUE }),
    );
    expect(setterCalls).toBe(0);
  });

  it('HASH-07: array index getter is rejected without execution', () => {
    let calls = 0;

    const value: unknown[] = [];
    Object.defineProperty(value, '0', {
      enumerable: true,
      configurable: true,
      get() {
        calls += 1;
        return 'x';
      },
    });
    value.length = 1;

    expect(calls).toBe(0);
    expect(() => canonicalize(value)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.INVALID_CANONICAL_VALUE }),
    );
    expect(calls).toBe(0);
  });

});
