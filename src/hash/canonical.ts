import { createHash } from 'node:crypto';
import { DomainError, ERROR_CODES } from '../domain/errors.js';

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function rejectUnsupported(message: string): never {
  throw new DomainError(ERROR_CODES.INVALID_CANONICAL_VALUE, message);
}

function canonicalizeInternal(value: unknown, seen: WeakSet<object>): string {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        rejectUnsupported(`Cannot canonicalize non-finite number: ${value}`);
      }
      return String(value);
    case 'string':
      return JSON.stringify(value);
    case 'undefined':
      rejectUnsupported('Cannot canonicalize undefined');
      break;
    case 'bigint':
      rejectUnsupported('Cannot canonicalize bigint');
      break;
    case 'symbol':
      rejectUnsupported('Cannot canonicalize symbol');
      break;
    case 'function':
      rejectUnsupported('Cannot canonicalize function');
      break;
    case 'object':
      if (Array.isArray(value)) {
        if (seen.has(value)) {
          rejectUnsupported('Cannot canonicalize circular reference');
        }
        seen.add(value);
        const items: string[] = [];
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (descriptor && ('get' in descriptor || 'set' in descriptor)) {
            rejectUnsupported(`Cannot canonicalize array accessor property: ${index}`);
          }
          if (!(index in value)) {
            rejectUnsupported('Cannot canonicalize sparse array');
          }
          items.push(canonicalizeInternal(value[index], seen));
        }
        seen.delete(value);
        return `[${items.join(',')}]`;
      }

      if (!isPlainObject(value)) {
        rejectUnsupported(
          `Cannot canonicalize non-plain object: ${Object.prototype.toString.call(value)}`,
        );
      }

      if (seen.has(value)) {
        rejectUnsupported('Cannot canonicalize circular reference');
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        rejectUnsupported('Cannot canonicalize object with symbol keys');
      }
      seen.add(value);
      const keys = Object.keys(value).sort();
      const entries = keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && ('get' in descriptor || 'set' in descriptor)) {
          rejectUnsupported(`Cannot canonicalize object accessor property: ${key}`);
        }
        const keyJson = JSON.stringify(key);
        return `${keyJson}:${canonicalizeInternal((value as Record<string, unknown>)[key], seen)}`;
      });
      seen.delete(value);
      return `{${entries.join(',')}}`;
    default:
      rejectUnsupported(`Cannot canonicalize unsupported value type: ${typeof value}`);
  }
}

export function canonicalize(value: unknown): string {
  return canonicalizeInternal(value, new WeakSet<object>());
}

export function hashCanonical(value: unknown): string {
  const canonical = canonicalize(value);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
