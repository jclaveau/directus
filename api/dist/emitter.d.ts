import type { ActionHandler, EventContext, FilterHandler, InitHandler } from '@directus/types';
export declare class Emitter {
    private filterEmitter;
    private actionEmitter;
    private initEmitter;
    constructor();
    private getDefaultContext;
    emitFilter<TIn = unknown, TOut = TIn>(event: string | string[], payload: TIn, meta: Record<string, any>, context?: EventContext | null): Promise<TOut | TIn>;
    emitAction(event: string | string[], meta: Record<string, any>, context?: EventContext | null): void;
    emitInit(event: string, meta: Record<string, any>): Promise<void>;
    onFilter<TIn = unknown, TOut = TIn>(event: string, handler: FilterHandler<TIn, TOut>): void;
    onAction(event: string, handler: ActionHandler): void;
    onInit(event: string, handler: InitHandler): void;
    offFilter<TIn = unknown, TOut = TIn>(event: string, handler: FilterHandler<TIn, TOut>): void;
    offAction(event: string, handler: ActionHandler): void;
    offInit(event: string, handler: InitHandler): void;
    offAll(): void;
}
declare const emitter: Emitter;
export declare const useEmitter: () => Emitter;
export default emitter;
