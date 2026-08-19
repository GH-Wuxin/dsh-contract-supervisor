import type { PathLstat } from './path.js';
import type { SliceFsSessionRegistry } from './session.js';
import type { SliceFsEditResult, SliceFsReadResult, SliceFsSearchResult, SliceFsWriteResult } from './types.js';
export interface SliceFsRuntimeOptions {
    /** Narrow deterministic seam for identity metadata acquisition tests. */
    readonly lstat?: PathLstat;
}
export declare class SliceFsRuntime {
    readonly sessions: SliceFsSessionRegistry;
    private readonly lstatImpl;
    constructor(sessions?: SliceFsSessionRegistry, options?: SliceFsRuntimeOptions);
    private audit;
    read(sessionId: string, args: unknown): Promise<SliceFsReadResult>;
    write(sessionId: string, args: unknown): Promise<SliceFsWriteResult>;
    edit(sessionId: string, args: unknown): Promise<SliceFsEditResult>;
    search(sessionId: string, args: unknown): Promise<SliceFsSearchResult>;
    private collectSearchFiles;
    private walkAuthorizedDirectory;
}
export declare function createSliceFsRuntime(sessions?: SliceFsSessionRegistry, options?: SliceFsRuntimeOptions): SliceFsRuntime;
export declare function sliceRead(sessions: SliceFsSessionRegistry, sessionId: string, args: unknown): Promise<SliceFsReadResult>;
export declare function sliceWrite(sessions: SliceFsSessionRegistry, sessionId: string, args: unknown): Promise<SliceFsWriteResult>;
export declare function sliceEdit(sessions: SliceFsSessionRegistry, sessionId: string, args: unknown): Promise<SliceFsEditResult>;
export declare function sliceSearch(sessions: SliceFsSessionRegistry, sessionId: string, args: unknown): Promise<SliceFsSearchResult>;
//# sourceMappingURL=runtime.d.ts.map