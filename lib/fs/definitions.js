import { defineTool } from '@deepseek-ai/dsh-tools';
import { FsError, FS_ERROR_CODES } from './errors.js';
export function resolveSliceFsSessionFromExecution(execution) {
    if (execution.agent === undefined) {
        return null;
    }
    const id = execution.agent.id;
    return typeof id === 'string' ? id : String(id);
}
function requireSession(execution, resolver) {
    const sessionId = resolver(execution);
    if (sessionId === undefined || sessionId === null || sessionId.length === 0) {
        throw new FsError(FS_ERROR_CODES.FS_SESSION_UNKNOWN, 'No trusted worker session identity is available for this audited filesystem tool');
    }
    return sessionId;
}
function textRender(value) {
    return [{ type: 'text', text: JSON.stringify(value) }];
}
/**
 * Registry-ready DSH definitions for slice_read/search/write/edit.
 *
 * C4A permits the exact four audited filesystem tools. The definitions are
 * complete, parameter-validated, and resolve authority strictly from the
 * trusted execution agent -> Supervisor-owned session binding. Production DSH
 * setup registers only the subset admitted by the authentic active Slice.
 */
export function createSliceFsToolDefinitions(runtime, resolveSessionId = resolveSliceFsSessionFromExecution) {
    const definitions = {
        slice_read: defineTool({
            name: 'slice_read',
            description: 'Read one text file only when its canonical repo-relative path is inside the current Slice allowedReads authority.',
            parameters: {
                path: { type: 'string', required: true, description: 'Repo-relative file path' },
            },
            output: {
                schema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', required: true },
                        content: { type: 'string', required: true },
                    },
                    additionalProperties: false,
                },
                render: (_args, value) => textRender(value),
            },
            async execute(args, execution) {
                const sessionId = requireSession(execution, resolveSessionId);
                return runtime.read(sessionId, args);
            },
        }),
        slice_search: defineTool({
            name: 'slice_search',
            description: 'Literal-text search over files inside the current Slice allowedReads authority only.',
            parameters: {
                path: { type: 'string', description: 'Optional search root inside allowedReads' },
                pattern: { type: 'string', required: true, description: 'Literal text to find' },
            },
            output: {
                schema: {
                    type: 'object',
                    properties: {
                        pattern: { type: 'string', required: true },
                        filesSearched: { type: 'integer', required: true },
                        matches: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    path: { type: 'string', required: true },
                                    line: { type: 'integer', required: true },
                                    column: { type: 'integer', required: true },
                                    lineText: { type: 'string', required: true },
                                },
                                additionalProperties: false,
                            },
                        },
                    },
                    additionalProperties: false,
                },
                render: (_args, value) => textRender(value),
            },
            async execute(args, execution) {
                const sessionId = requireSession(execution, resolveSessionId);
                return runtime.search(sessionId, args);
            },
        }),
        slice_write: defineTool({
            name: 'slice_write',
            description: 'Write one exact target that is present in the current Slice allowedWrites authority.',
            parameters: {
                path: { type: 'string', required: true, description: 'Exact repo-relative write target' },
                content: { type: 'string', required: true, description: 'Complete new file content' },
            },
            output: {
                schema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', required: true },
                        written: { type: 'boolean', required: true, const: true },
                        bytes: { type: 'integer', required: true },
                        created: { type: 'boolean', required: true },
                    },
                    additionalProperties: false,
                },
                render: (_args, value) => textRender(value),
            },
            isConcurrencySafe: () => false,
            async execute(args, execution) {
                const sessionId = requireSession(execution, resolveSessionId);
                return runtime.write(sessionId, args);
            },
        }),
        slice_edit: defineTool({
            name: 'slice_edit',
            description: 'Replace exactly one occurrence of oldText with newText in one exact allowedWrites target.',
            parameters: {
                path: { type: 'string', required: true, description: 'Exact repo-relative write target' },
                oldText: { type: 'string', required: true, description: 'Text to replace exactly once' },
                newText: { type: 'string', required: true, description: 'Replacement text' },
            },
            output: {
                schema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', required: true },
                        replaced: { type: 'boolean', required: true, const: true },
                        occurrences: { type: 'integer', required: true, const: 1 },
                        bytes: { type: 'integer', required: true },
                    },
                    additionalProperties: false,
                },
                render: (_args, value) => textRender(value),
            },
            isConcurrencySafe: () => false,
            async execute(args, execution) {
                const sessionId = requireSession(execution, resolveSessionId);
                return runtime.edit(sessionId, args);
            },
        }),
    };
    return Object.freeze(definitions);
}
//# sourceMappingURL=definitions.js.map