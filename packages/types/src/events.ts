import type { Knex } from 'knex';
import type { Accountability } from './accountability.js';
import type { PromiseCallback } from './misc.js';
import type { ScopedCachePurgeHandle, ScopedCacheScopeHandle } from './read-meta.js';
import type { SchemaOverview } from './schema.js';

export type EventContext = {
	database: Knex;
	schema: SchemaOverview | null;
	accountability: Accountability | null;
	/**
	 * Scoped-cache fingerprint channel, carrying ONLY the methods for this event:
	 * `scopeTo` and `dependOn` on `items.read`, `purgeBy` on
	 * `items.create`/`update`/`delete`. Absent on every other event. A hook does not
	 * see this union: `register.filter` hands a read handler `ReadEventContext` and a
	 * mutation handler `MutationEventContext`, resolved from the event name.
	 */
	scopedCache?: ScopedCacheScopeHandle | ScopedCachePurgeHandle;
};

/** What an `ItemsService` read filter receives: the read handle is always there. */
export type ReadEventContext = Omit<EventContext, 'scopedCache'> & {
	scopedCache: ScopedCacheScopeHandle;
};

/** What an `ItemsService` create/update/delete filter receives. */
export type MutationEventContext = Omit<EventContext, 'scopedCache'> & {
	scopedCache: ScopedCachePurgeHandle;
};

export type FilterHandler<
	TIn = unknown,
	TOut = TIn,
	TContext extends EventContext = EventContext,
> = (
	payload: TIn,
	meta: Record<string, any>,
	context: TContext,
) => TIn | TOut | Promise<TIn | TOut>;
export type ActionHandler = (meta: Record<string, any>, context: EventContext) => void;
export type InitHandler = (meta: Record<string, any>) => void;
export type ScheduleHandler = PromiseCallback;
export type EmbedHandler = () => string;
