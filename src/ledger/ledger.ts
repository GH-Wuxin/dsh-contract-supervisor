import { open, readFile, truncate, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalize, hashCanonical } from '../hash/index.js';
import { LedgerError, LEDGER_ERROR_CODES } from './errors.js';
import type { LedgerErrorCode } from './errors.js';
import {
  LEDGER_SCHEMA_VERSION,
  type LedgerAppendInput,
  type LedgerRecord,
  type LedgerSnapshot,
} from './types.js';

const NEWLINE = 0x0a;

function cloneRecord(record: LedgerRecord): LedgerRecord {
  return structuredClone(record);
}

function asLedgerError(error: unknown, code: LedgerErrorCode, fallbackMessage: string): LedgerError {
  if (error instanceof LedgerError) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new LedgerError(code, `${fallbackMessage}: ${detail}`);
}

function invalidRecord(message: string): LedgerError {
  return new LedgerError(LEDGER_ERROR_CODES.INVALID_LEDGER_RECORD, message);
}

function corrupt(message: string): LedgerError {
  return new LedgerError(LEDGER_ERROR_CODES.LEDGER_CORRUPT, message);
}

function schemaUnsupported(version: unknown): LedgerError {
  return new LedgerError(
    LEDGER_ERROR_CODES.LEDGER_SCHEMA_UNSUPPORTED,
    `Unsupported ledger schema version: ${String(version)}`,
  );
}

function sequenceMismatch(expected: number, actual: unknown): LedgerError {
  return new LedgerError(
    LEDGER_ERROR_CODES.LEDGER_SEQUENCE_MISMATCH,
    `Expected sequence ${expected}, found ${String(actual)}`,
  );
}

function prevHashMismatch(expected: string | null, actual: unknown): LedgerError {
  return new LedgerError(
    LEDGER_ERROR_CODES.LEDGER_PREV_HASH_MISMATCH,
    `Expected prevHash ${String(expected)}, found ${String(actual)}`,
  );
}

function hashMismatch(expected: string, actual: unknown): LedgerError {
  return new LedgerError(
    LEDGER_ERROR_CODES.LEDGER_HASH_MISMATCH,
    `Hash mismatch: expected ${expected}, found ${String(actual)}`,
  );
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function parseLedgerText(text: string): LedgerRecord[] {
  const lines = splitLines(text);
  const records: LedgerRecord[] = [];
  let expectedSeq = 1;
  let previousHash: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') {
      throw corrupt(`Empty line at record ${index + 1}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw corrupt(`Invalid JSON at record ${index + 1}`);
    }

    if (!isRecordLike(parsed)) {
      throw corrupt(`Record ${index + 1} is not a JSON object`);
    }

    if (parsed.schemaVersion !== LEDGER_SCHEMA_VERSION) {
      throw schemaUnsupported(parsed.schemaVersion);
    }

    const seq = parsed.seq;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq <= 0) {
      throw sequenceMismatch(expectedSeq, seq);
    }
    if (seq !== expectedSeq) {
      throw sequenceMismatch(expectedSeq, seq);
    }

    if (typeof parsed.type !== 'string' || parsed.type.length === 0) {
      throw invalidRecord(`Record ${index + 1} has invalid type`);
    }

    if (typeof parsed.time !== 'string') {
      throw invalidRecord(`Record ${index + 1} has invalid time`);
    }

    if (parsed.prevHash !== previousHash) {
      throw prevHashMismatch(previousHash, parsed.prevHash);
    }

    const prevHash = parsed.prevHash as string | null;
    const body = {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      seq,
      type: parsed.type,
      time: parsed.time,
      payload: parsed.payload,
      prevHash,
    };

    let computedHash: string;
    try {
      computedHash = hashCanonical(body);
    } catch (error) {
      throw invalidRecord(`Record ${index + 1} has non-canonicalizable payload: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (typeof parsed.hash !== 'string' || parsed.hash !== computedHash) {
      throw hashMismatch(computedHash, parsed.hash);
    }

    const record: LedgerRecord = {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      seq,
      type: parsed.type,
      time: parsed.time,
      payload: parsed.payload,
      prevHash,
      hash: parsed.hash,
    };
    records.push(record);
    expectedSeq += 1;
    previousHash = record.hash;
  }

  return records;
}

async function ensureFileExists(filePath: string): Promise<void> {
  try {
    await writeFile(filePath, '', { flag: 'wx' });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') {
      throw asLedgerError(error, LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, `Failed to create ledger file ${filePath}`);
    }
  }
}

async function replayFile(filePath: string): Promise<LedgerRecord[]> {
  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch (error) {
    throw asLedgerError(error, LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, `Failed to read ledger file ${filePath}`);
  }

  const hasFinalNewline = buffer.length === 0 || buffer[buffer.length - 1] === NEWLINE;
  let content = buffer;

  if (!hasFinalNewline) {
    const lastNewline = buffer.lastIndexOf(NEWLINE);
    const keepLength = lastNewline === -1 ? 0 : lastNewline + 1;
    try {
      await truncate(filePath, keepLength);
    } catch (error) {
      throw asLedgerError(error, LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, `Failed to truncate torn tail in ${filePath}`);
    }
    content = buffer.subarray(0, keepLength);
  }

  return parseLedgerText(content.toString('utf8'));
}

export class JsonlLedger {
  private readonly filePathValue: string;
  private recordsValue: LedgerRecord[];
  private handle: Awaited<ReturnType<typeof open>> | null;
  private appendQueue: Promise<unknown> = Promise.resolve();
  private closedValue = false;
  private failedValue = false;

  private constructor(filePath: string, records: LedgerRecord[], handle: Awaited<ReturnType<typeof open>>) {
    this.filePathValue = filePath;
    this.recordsValue = records;
    this.handle = handle;
  }

  static async open(filePath: string): Promise<JsonlLedger> {
    const absolutePath = resolve(filePath);
    await ensureFileExists(absolutePath);
    const records = await replayFile(absolutePath);

    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(absolutePath, 'a+');
    } catch (error) {
      throw asLedgerError(error, LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, `Failed to open ledger file ${absolutePath}`);
    }

    return new JsonlLedger(absolutePath, records, handle);
  }

  get filePath(): string {
    return this.filePathValue;
  }

  get records(): readonly LedgerRecord[] {
    return this.recordsValue.map(cloneRecord);
  }

  get lastSeq(): number | null {
    const last = this.recordsValue[this.recordsValue.length - 1];
    return last ? last.seq : null;
  }

  get tailHash(): string | null {
    const last = this.recordsValue[this.recordsValue.length - 1];
    return last ? last.hash : null;
  }

  getRecords(): LedgerRecord[] {
    return this.recordsValue.map(cloneRecord);
  }

  readAll(): LedgerRecord[] {
    return this.recordsValue.map(cloneRecord);
  }

  replay(): Promise<LedgerRecord[]> {
    const run = this.appendQueue.then(async () => {
      try {
        const records = await replayFile(this.filePathValue);
        this.recordsValue = records;
        return this.recordsValue.map(cloneRecord);
      } catch (error) {
        this.failedValue = true;
        throw error;
      }
    });
    this.appendQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  readDurableRecords(): Promise<LedgerRecord[]> {
    return this.replay();
  }

  snapshot(): LedgerSnapshot {
    return {
      records: this.recordsValue.map(cloneRecord),
      lastSeq: this.lastSeq,
      tailHash: this.tailHash,
    };
  }

  append(input: LedgerAppendInput): Promise<LedgerRecord> {
    const run = this.appendQueue.then(() => this.appendNow(input));
    this.appendQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async appendNow(input: LedgerAppendInput): Promise<LedgerRecord> {
    if (this.closedValue) {
      throw new LedgerError(LEDGER_ERROR_CODES.LEDGER_CLOSED, 'Ledger is closed');
    }
    if (this.failedValue) {
      throw new LedgerError(LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, 'Ledger is in a failed state after an I/O error');
    }

    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw invalidRecord('Append input must be an object');
    }
    if (typeof input.type !== 'string' || input.type.length === 0) {
      throw invalidRecord('Append input type must be a non-empty string');
    }
    const time = input.time === undefined ? new Date().toISOString() : input.time;
    if (typeof time !== 'string') {
      throw invalidRecord('Append input time must be a string');
    }

    let canonicalPayload: string;
    let ownedPayload: unknown;
    try {
      canonicalPayload = canonicalize(input.payload);
      ownedPayload = JSON.parse(canonicalPayload) as unknown;
    } catch (error) {
      throw invalidRecord(`Invalid payload: ${error instanceof Error ? error.message : String(error)}`);
    }

    const nextSeq = this.lastSeq === null ? 1 : this.lastSeq + 1;
    const prevHash = this.tailHash;
    const body = {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      seq: nextSeq,
      type: input.type,
      time,
      payload: ownedPayload,
      prevHash,
    };

    let hash: string;
    try {
      hash = hashCanonical(body);
    } catch (error) {
      throw invalidRecord(`Invalid payload: ${error instanceof Error ? error.message : String(error)}`);
    }

    const record: LedgerRecord = {
      ...body,
      hash,
    };

    let line: string;
    try {
      line = canonicalize(record) + '\n';
    } catch (error) {
      throw invalidRecord(`Invalid record: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (this.handle === null) {
      throw new LedgerError(LEDGER_ERROR_CODES.LEDGER_CLOSED, 'Ledger is closed');
    }

    try {
      await this.handle.writeFile(line, 'utf8');
      await this.handle.sync();
    } catch (error) {
      this.failedValue = true;
      throw asLedgerError(error, LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, 'Failed to durably append ledger record');
    }

    const durableRecord = cloneRecord(record);
    this.recordsValue.push(durableRecord);
    return cloneRecord(durableRecord);
  }

  async close(): Promise<void> {
    if (this.closedValue) {
      return;
    }
    this.closedValue = true;
    if (this.handle !== null) {
      const handle = this.handle;
      this.handle = null;
      try {
        await handle.close();
      } catch (error) {
        throw asLedgerError(error, LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, 'Failed to close ledger file');
      }
    }
  }
}

export async function openLedger(filePath: string): Promise<JsonlLedger> {
  return JsonlLedger.open(filePath);
}

export async function createLedger(filePath: string): Promise<JsonlLedger> {
  const absolutePath = resolve(filePath);
  try {
    await writeFile(absolutePath, '', { flag: 'wx' });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new LedgerError(LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, `Ledger file already exists: ${absolutePath}`);
    }
    throw asLedgerError(error, LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, `Failed to create ledger file ${absolutePath}`);
  }
  return JsonlLedger.open(absolutePath);
}
