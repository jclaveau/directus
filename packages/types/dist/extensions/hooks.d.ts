import type { ActionHandler, EmbedHandler, FilterHandler, InitHandler, MutationEventContext, ReadEventContext, ScheduleHandler } from '../events.js';
import type { ApiExtensionContext } from './api-extension-context.js';
export type HookExtensionContext = ApiExtensionContext & {
    emitter: any;
};
/**
 * The filter events an `ItemsService` emits, and so the ones whose context carries a
 * scoped-cache handle: `items.<op>`, `<collection>.items.<op>` and, for a system
 * collection, `<name>.<op>`.
 */
export type ItemsReadEvent = `${string}.read`;
export type ItemsMutationEvent = `${string}.${'create' | 'update' | 'delete'}`;
/** Same suffixes, no `ItemsService` behind them: their context carries no handle. */
export type BareFilterEvent = 'auth.create' | 'auth.update' | 'fields.create' | 'fields.update' | 'fields.delete';
/**
 * Overloads in the order TypeScript tries them: a bare event first, so `auth.create`
 * does not read as a mutation; then the two item shapes; then any other string,
 * which is also where a non-literal event name lands.
 */
export type RegisterFilter = {
    <TIn = unknown, TOut = TIn>(event: BareFilterEvent, handler: FilterHandler<TIn, TOut>): void;
    <TIn = unknown, TOut = TIn>(event: ItemsReadEvent, handler: FilterHandler<TIn, TOut, ReadEventContext>): void;
    <TIn = unknown, TOut = TIn>(event: ItemsMutationEvent, handler: FilterHandler<TIn, TOut, MutationEventContext>): void;
    <TIn = unknown, TOut = TIn>(event: string, handler: FilterHandler<TIn, TOut>): void;
};
export type RegisterFunctions = {
    filter: RegisterFilter;
    action: (event: string, handler: ActionHandler) => void;
    init: (event: string, handler: InitHandler) => void;
    schedule: (cron: string, handler: ScheduleHandler) => void;
    embed: (position: 'head' | 'body', code: string | EmbedHandler) => void;
};
export type HookConfig = (register: RegisterFunctions, context: HookExtensionContext) => void;
