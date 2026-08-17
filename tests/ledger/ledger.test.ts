import { afterEach, describe, expect, it } from 'vitest';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLedger,
  LEDGER_ERROR_CODES,
  LedgerError,
  openLedger,
  type LedgerRecord,
} from '../../src/ledger/index.js';
import { hashCanonical } from '../../src/hash/index.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ledger-'));
  tempDirs.push(dir);
  return dir;
}

function makePath(dir: string, name: string): string {
  return join(dir, name);
}

function expectCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(LedgerError);
  expect((error as LedgerError).code).toBe(code);
}

function recomputeHash(record: LedgerRecord): string {
  return hashCanonical({
    schemaVersion: record.schemaVersion,
    seq: record.seq,
    type: record.type,
    time: record.time,
    payload: record.payload,
    prevHash: record.prevHash,
  });
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe('S2 ledger', () => {
  it('LEDGER-01 empty ledger', async () => {
    const dir = await makeTempDir();
    const file = makePath(dir, 'ledger.jsonl');
    const ledger = await createLedger(file);

    expect(ledger.records).toEqual([]);
    expect(ledger.lastSeq).toBeNull();
    expect(ledger.tailHash).toBeNull();

    const first = await ledger.append({ type: 'a', payload: { n: 1 } });
    expect(first.seq).toBe(1);
    expect(first.prevHash).toBeNull();

    await ledger.close();
  });

  it('LEDGER-02 append chain', async () => {
    const dir = await makeTempDir();
    const file = makePath(dir, 'ledger.jsonl');
    const ledger = await createLedger(file);

    const a = await ledger.append({ type: 'a', payload: { value: 1 } });
    const b = await ledger.append({ type: 'b', payload: { value: 2 } });
    const c = await ledger.append({ type: 'c', payload: { value: 3 } });

    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(c.seq).toBe(3);
    expect(a.prevHash).toBeNull();
    expect(b.prevHash).toBe(a.hash);
    expect(c.prevHash).toBe(b.hash);
    expect(recomputeHash(a)).toBe(a.hash);
    expect(recomputeHash(b)).toBe(b.hash);
    expect(recomputeHash(c)).toBe(c.hash);

    await ledger.close();
  });

  it('LEDGER-03 restart replay', async () => {
    const dir = await makeTempDir();
    const file = makePath(dir, 'ledger.jsonl');
    const ledger = await createLedger(file);
    const payloads = [
      { kind: 'alpha', n: 1 },
      { kind: 'beta', n: 2 },
      { kind: 'gamma', n: 3 },
    ];

    for (const payload of payloads) {
      await ledger.append({ type: 'event', payload });
    }
    await ledger.close();

    const reopened = await openLedger(file);
    expect(reopened.records.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(reopened.records.map((r) => r.payload)).toEqual(payloads);
    expect(reopened.records.map((r) => r.hash)).toEqual(
      [1, 2, 3].map((seq) => {
        const prevHash = seq === 1 ? null : reopened.records[seq - 2].hash;
        return hashCanonical({
          schemaVersion: 1,
          seq,
          type: 'event',
          time: reopened.records[seq - 1].time,
          payload: payloads[seq - 1],
          prevHash,
        });
      }),
    );
    await reopened.close();
  });

  it('LEDGER-04 torn final tail recovery', async () => {
    const dir = await makeTempDir();
    const file = makePath(dir, 'ledger.jsonl');
    const ledger = await createLedger(file);
    await ledger.append({ type: 'a', payload: { n: 1 } });
    await ledger.append({ type: 'b', payload: { n: 2 } });
    await ledger.close();

    await appendFile(file, '{"schemaVer', 'utf8');

    const reopened = await openLedger(file);
    expect(reopened.records.map((r) => r.seq)).toEqual([1, 2]);
    const content = await readFile(file, 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    expect(content).not.toContain('{"schemaVer');
    await reopened.close();
  });

  it('LEDGER-05 apparently complete but unterminated tail is truncated', async () => {
    const dir = await makeTempDir();
    const file = makePath(dir, 'ledger.jsonl');
    const ledger = await createLedger(file);
    await ledger.append({ type: 'a', payload: { n: 1 } });
    await ledger.append({ type: 'b', payload: { n: 2 } });
    await ledger.close();

    const completeLooking = JSON.stringify({
      schemaVersion: 1,
      seq: 3,
      type: 'c',
      time: '2024-01-01T00:00:00.000Z',
      payload: { n: 3 },
      prevHash: 'should-be-ignored',
      hash: 'should-be-ignored',
    });
    await appendFile(file, completeLooking, 'utf8');

    const reopened = await openLedger(file);
    expect(reopened.records.map((r) => r.seq)).toEqual([1, 2]);
    const content = await readFile(file, 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    expect(content).not.toContain('should-be-ignored');
    await reopened.close();
  });

  it('LEDGER-06 newline-terminated invalid JSON fails closed', async () => {
    const dir = await makeTempDir();
    const file = makePath(dir, 'ledger.jsonl');
    const ledger = await createLedger(file);
    await ledger.append({ type: 'a', payload: { n: 1 } });
    await ledger.close();

    await appendFile(file, 'BAD_JSON\n', 'utf8');

    await expect(openLedger(file)).rejects.toSatisfy((error: unknown) => {
      expectCode(error, LEDGER_ERROR_CODES.LEDGER_CORRUPT);
      return true;
    });
  });

  it('LEDGER-07 hash tamper fails closed', async () => {
    const dir = await makeTempDir();
    const file = makePath(dir, 'ledger.jsonl');
    const ledger = await createLedger(file);
    await ledger.append({ type: 'a', payload: { n: 1 } });
    await ledger.close();

    const text = await readFile(file, 'utf8');
    const tampered = text.replace(/"hash":"[a-f0-9]+"/, '"hash":"0000000000000000000000000000000000000000000000000000000000000000"');
    await writeFile(file, tampered, 'utf8');

    await expect(openLedger(file)).rejects.toSatisfy((error: unknown) => {
      expectCode(error, LEDGER_ERROR_CODES.LEDGER_HASH_MISMATCH);
      return true;
    });
  });

  it('LEDGER-08 prevHash tamper fails closed', async () => {
    const dir = await makeTempDir();
    const file = makePath(dir, 'ledger.jsonl');
    const ledger = await createLedger(file);
    await ledger.append({ type: 'a', payload: { n: 1 } });
    await ledger.append({ type: 'b', payload: { n: 2 } });
    await ledger.close();

    const text = await readFile(file, 'utf8');
    const lines = text.split('\n');
    const second = lines[1].replace(/"prevHash":"[a-f0-9]+"/, '"prevHash":"deadbeef"');
    lines[1] = second;
    await writeFile(file, lines.join('\n'), 'utf8');

    await expect(openLedger(file)).rejects.toSatisfy((error: unknown) => {
      expectCode(error, LEDGER_ERROR_CODES.LEDGER_PREV_HASH_MISMATCH);
      return true;
    });
  });

  it('LEDGER-09 seq corruption fails closed', async () => {
    const dir = await makeTempDir();
    const file = makePath(dir, 'ledger.jsonl');
    const ledger = await createLedger(file);
    await ledger.append({ type: 'a', payload: { n: 1 } });
    await ledger.append({ type: 'b', payload: { n: 2 } });
    await ledger.close();

    const text = await readFile(file, 'utf8');
    const lines = text.split('\n');
    const second = lines[1].replace(/"seq":2/, '"seq":3');
    lines[1] = second;
    await writeFile(file, lines.join('\n'), 'utf8');

    await expect(openLedger(file)).rejects.toSatisfy((error: unknown) => {
      expectCode(error, LEDGER_ERROR_CODES.LEDGER_SEQUENCE_MISMATCH);
      return true;
    });
  });

  it('LEDGER-10 unsupported schema fails closed', async () => {
    const dir = await makeTempDir();
    const file = makePath(dir, 'ledger.jsonl');
    const ledger = await createLedger(file);
    await ledger.append({ type: 'a', payload: { n: 1 } });
    await ledger.close();

    const text = await readFile(file, 'utf8');
    const tampered = text.replace(/"schemaVersion":1/, '"schemaVersion":2');
    await writeFile(file, tampered, 'utf8');

    await expect(openLedger(file)).rejects.toSatisfy((error: unknown) => {
      expectCode(error, LEDGER_ERROR_CODES.LEDGER_SCHEMA_UNSUPPORTED);
      return true;
    });
  });

  it('LEDGER-11 invalid payloads are rejected before append', async () => {
    const dir = await makeTempDir();
    const file = makePath(dir, 'ledger.jsonl');
    const ledger = await createLedger(file);

    const invalidPayloads: unknown[] = [
      Number.NaN,
      undefined,
      new Date('2024-01-01T00:00:00.000Z'),
      Object.defineProperty({}, 'x', {
        enumerable: true,
        get: () => 1,
      }),
    ];

    for (const payload of invalidPayloads) {
      await expect(ledger.append({ type: 'bad', payload })).rejects.toSatisfy((error: unknown) => {
        expectCode(error, LEDGER_ERROR_CODES.INVALID_LEDGER_RECORD);
        return true;
      });
    }

    expect(ledger.records).toEqual([]);
    expect(await readFile(file, 'utf8')).toBe('');

    const valid = await ledger.append({ type: 'good', payload: { ok: true } });
    expect(valid.seq).toBe(1);
    await ledger.close();
  });

  it('LEDGER-12 concurrent append serialization', async () => {
    const dir = await makeTempDir();
    const file = makePath(dir, 'ledger.jsonl');
    const ledger = await createLedger(file);

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        ledger.append({ type: `t${index}`, payload: { index } }),
      ),
    );

    expect(results.map((r) => r.seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    const records = ledger.getRecords();
    expect(records.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      expect(recomputeHash(record)).toBe(record.hash);
      if (index === 0) {
        expect(record.prevHash).toBeNull();
      } else {
        expect(record.prevHash).toBe(records[index - 1].hash);
      }
    }

    await ledger.close();
    const reopened = await openLedger(file);
    expect(reopened.records.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    await reopened.close();
  });

  it('LEDGER-13 complete final corruption is not recovered', async () => {
    const dir = await makeTempDir();
    const file = makePath(dir, 'ledger.jsonl');
    const ledger = await createLedger(file);
    await ledger.append({ type: 'a', payload: { n: 1 } });
    await ledger.close();

    const text = await readFile(file, 'utf8');
    const tampered = text.replace(/"hash":"[a-f0-9]+"/, '"hash":"1111111111111111111111111111111111111111111111111111111111111111"');
    await writeFile(file, tampered, 'utf8');

    await expect(openLedger(file)).rejects.toSatisfy((error: unknown) => {
      expectCode(error, LEDGER_ERROR_CODES.LEDGER_HASH_MISMATCH);
      return true;
    });
  });

  it('LEDGER-14 caller mutation cannot split disk and memory', async () => {
    const dir = await makeTempDir();
    const file = makePath(dir, 'ledger.jsonl');
    const ledger = await createLedger(file);

    const payload = {
      nested: {
        value: 1,
      },
      list: [1, 2],
    };
    const originalSnapshot = JSON.parse(JSON.stringify(payload)) as typeof payload;

    const appendPromise = ledger.append({ type: 'event', payload });
    await Promise.resolve();
    payload.nested.value = 999;
    payload.list.push(3);
    expect(payload.nested.value).toBe(999);
    expect(payload.list).toEqual([1, 2, 3]);

    const returnedRecord = await appendPromise;

    expect(returnedRecord.payload).toEqual(originalSnapshot);
    expect(ledger.records[0].payload).toEqual(originalSnapshot);
    expect(recomputeHash(ledger.records[0])).toBe(ledger.records[0].hash);

    await ledger.close();

    const reopened = await openLedger(file);
    expect(reopened.records[0]).toEqual(returnedRecord);
    expect(reopened.records[0].payload).toEqual(originalSnapshot);
    expect(recomputeHash(reopened.records[0])).toBe(reopened.records[0].hash);
    await reopened.close();
  });

});
