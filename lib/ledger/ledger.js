import { open, readFile, truncate, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalize, hashCanonical } from '../hash/index.js';
import { LedgerError, LEDGER_ERROR_CODES } from './errors.js';
import { LEDGER_SCHEMA_VERSION, } from './types.js';
const NEWLINE = 0x0a;
function cloneRecord(record) {
    return structuredClone(record);
}
function asLedgerError(error, code, fallbackMessage) {
    if (error instanceof LedgerError) {
        return error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    return new LedgerError(code, `${fallbackMessage}: ${detail}`);
}
function invalidRecord(message) {
    return new LedgerError(LEDGER_ERROR_CODES.INVALID_LEDGER_RECORD, message);
}
function corrupt(message) {
    return new LedgerError(LEDGER_ERROR_CODES.LEDGER_CORRUPT, message);
}
function schemaUnsupported(version) {
    return new LedgerError(LEDGER_ERROR_CODES.LEDGER_SCHEMA_UNSUPPORTED, `Unsupported ledger schema version: ${String(version)}`);
}
function sequenceMismatch(expected, actual) {
    return new LedgerError(LEDGER_ERROR_CODES.LEDGER_SEQUENCE_MISMATCH, `Expected sequence ${expected}, found ${String(actual)}`);
}
function prevHashMismatch(expected, actual) {
    return new LedgerError(LEDGER_ERROR_CODES.LEDGER_PREV_HASH_MISMATCH, `Expected prevHash ${String(expected)}, found ${String(actual)}`);
}
function hashMismatch(expected, actual) {
    return new LedgerError(LEDGER_ERROR_CODES.LEDGER_HASH_MISMATCH, `Hash mismatch: expected ${expected}, found ${String(actual)}`);
}
function isRecordLike(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function splitLines(text) {
    if (text.length === 0) {
        return [];
    }
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}
function parseLedgerText(text) {
    const lines = splitLines(text);
    const records = [];
    let expectedSeq = 1;
    let previousHash = null;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.trim() === '') {
            throw corrupt(`Empty line at record ${index + 1}`);
        }
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch {
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
        const prevHash = parsed.prevHash;
        const body = {
            schemaVersion: LEDGER_SCHEMA_VERSION,
            seq,
            type: parsed.type,
            time: parsed.time,
            payload: parsed.payload,
            prevHash,
        };
        let computedHash;
        try {
            computedHash = hashCanonical(body);
        }
        catch (error) {
            throw invalidRecord(`Record ${index + 1} has non-canonicalizable payload: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (typeof parsed.hash !== 'string' || parsed.hash !== computedHash) {
            throw hashMismatch(computedHash, parsed.hash);
        }
        const record = {
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
async function ensureFileExists(filePath) {
    try {
        await writeFile(filePath, '', { flag: 'wx' });
    }
    catch (error) {
        const code = error.code;
        if (code !== 'EEXIST') {
            throw asLedgerError(error, LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, `Failed to create ledger file ${filePath}`);
        }
    }
}
async function replayFile(filePath) {
    let buffer;
    try {
        buffer = await readFile(filePath);
    }
    catch (error) {
        throw asLedgerError(error, LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, `Failed to read ledger file ${filePath}`);
    }
    const hasFinalNewline = buffer.length === 0 || buffer[buffer.length - 1] === NEWLINE;
    let content = buffer;
    if (!hasFinalNewline) {
        const lastNewline = buffer.lastIndexOf(NEWLINE);
        const keepLength = lastNewline === -1 ? 0 : lastNewline + 1;
        try {
            await truncate(filePath, keepLength);
        }
        catch (error) {
            throw asLedgerError(error, LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, `Failed to truncate torn tail in ${filePath}`);
        }
        content = buffer.subarray(0, keepLength);
    }
    return parseLedgerText(content.toString('utf8'));
}
export class JsonlLedger {
    filePathValue;
    recordsValue;
    handle;
    appendQueue = Promise.resolve();
    closedValue = false;
    failedValue = false;
    constructor(filePath, records, handle) {
        this.filePathValue = filePath;
        this.recordsValue = records;
        this.handle = handle;
    }
    static async open(filePath) {
        const absolutePath = resolve(filePath);
        await ensureFileExists(absolutePath);
        const records = await replayFile(absolutePath);
        let handle;
        try {
            handle = await open(absolutePath, 'a+');
        }
        catch (error) {
            throw asLedgerError(error, LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, `Failed to open ledger file ${absolutePath}`);
        }
        return new JsonlLedger(absolutePath, records, handle);
    }
    get filePath() {
        return this.filePathValue;
    }
    get records() {
        return this.recordsValue.map(cloneRecord);
    }
    get lastSeq() {
        const last = this.recordsValue[this.recordsValue.length - 1];
        return last ? last.seq : null;
    }
    get tailHash() {
        const last = this.recordsValue[this.recordsValue.length - 1];
        return last ? last.hash : null;
    }
    getRecords() {
        return this.recordsValue.map(cloneRecord);
    }
    readAll() {
        return this.recordsValue.map(cloneRecord);
    }
    replay() {
        const run = this.appendQueue.then(async () => {
            try {
                const records = await replayFile(this.filePathValue);
                this.recordsValue = records;
                return this.recordsValue.map(cloneRecord);
            }
            catch (error) {
                this.failedValue = true;
                throw error;
            }
        });
        this.appendQueue = run.then(() => undefined, () => undefined);
        return run;
    }
    readDurableRecords() {
        return this.replay();
    }
    snapshot() {
        return {
            records: this.recordsValue.map(cloneRecord),
            lastSeq: this.lastSeq,
            tailHash: this.tailHash,
        };
    }
    append(input) {
        const run = this.appendQueue.then(() => this.appendNow(input));
        this.appendQueue = run.then(() => undefined, () => undefined);
        return run;
    }
    async appendNow(input) {
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
        let canonicalPayload;
        let ownedPayload;
        try {
            canonicalPayload = canonicalize(input.payload);
            ownedPayload = JSON.parse(canonicalPayload);
        }
        catch (error) {
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
        let hash;
        try {
            hash = hashCanonical(body);
        }
        catch (error) {
            throw invalidRecord(`Invalid payload: ${error instanceof Error ? error.message : String(error)}`);
        }
        const record = {
            ...body,
            hash,
        };
        let line;
        try {
            line = canonicalize(record) + '\n';
        }
        catch (error) {
            throw invalidRecord(`Invalid record: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (this.handle === null) {
            throw new LedgerError(LEDGER_ERROR_CODES.LEDGER_CLOSED, 'Ledger is closed');
        }
        try {
            await this.handle.writeFile(line, 'utf8');
            await this.handle.sync();
        }
        catch (error) {
            this.failedValue = true;
            throw asLedgerError(error, LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, 'Failed to durably append ledger record');
        }
        const durableRecord = cloneRecord(record);
        this.recordsValue.push(durableRecord);
        return cloneRecord(durableRecord);
    }
    async close() {
        if (this.closedValue) {
            return;
        }
        this.closedValue = true;
        if (this.handle !== null) {
            const handle = this.handle;
            this.handle = null;
            try {
                await handle.close();
            }
            catch (error) {
                throw asLedgerError(error, LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, 'Failed to close ledger file');
            }
        }
    }
}
export async function openLedger(filePath) {
    return JsonlLedger.open(filePath);
}
export async function createLedger(filePath) {
    const absolutePath = resolve(filePath);
    try {
        await writeFile(absolutePath, '', { flag: 'wx' });
    }
    catch (error) {
        const code = error.code;
        if (code === 'EEXIST') {
            throw new LedgerError(LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, `Ledger file already exists: ${absolutePath}`);
        }
        throw asLedgerError(error, LEDGER_ERROR_CODES.LEDGER_IO_FAILURE, `Failed to create ledger file ${absolutePath}`);
    }
    return JsonlLedger.open(absolutePath);
}
//# sourceMappingURL=ledger.js.map