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
	 * `items.create`/`update`/`delete` and `items.created`/`updated`. Absent on every
	 * other event. A hook does not see this union: `register.filter` hands a read
	 * handler `ReadEventContext`, a mutation handler `MutationEventContext` and a
	 * written one `WrittenEventContext`, resolved from the event name.
	 */
	scopedCache?:
		| ScopedCacheScopeHandle
		| ScopedCachePurgeHandle
		| Pick<ScopedCachePurgeHandle, 'purgeBy'>;
};

/** What an `ItemsService` read filter receives: the read handle is always there. */
export type ReadEventContext = Omit<EventContext, 'scopedCache'> & {
	scopedCache: ScopedCacheScopeHandle;
};

/** What an `ItemsService` create/update/delete filter receives. */
export type MutationEventContext = Omit<EventContext, 'database' | 'scopedCache'> & {
	/**
	 * The transaction the filter hooks and the write share: a hook writing through
	 * it commits with the mutation or rolls back with it. On a service handed the
	 * caller's transaction it is that one, so the write lands when the caller
	 * commits.
	 */
	transaction: Knex;
	/** @deprecated Use `transaction`, the same object. */
	database: Knex;
	scopedCache: ScopedCachePurgeHandle;
};

/**
 * What an `ItemsService` created/updated filter receives, once the rows are
 * written: it may purge, but no row is left to take over, so it has no
 * `skipPurgeFor` to spare one an update hook took over and moved.
 */
export type WrittenEventContext = Omit<MutationEventContext, 'scopedCache'> & {
	scopedCache: Pick<ScopedCachePurgeHandle, 'purgeBy'>;
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
/**
 * What an `ItemsService` created/updated filter is: the rows are already
 * written, so it answers nothing.
 */
export type WrittenFilterHandler<TIn> = (
	payload: TIn,
	meta: Record<string, any>,
	context: WrittenEventContext,
) => undefined | Promise<void>;
export type ActionHandler = (meta: Record<string, any>, context: EventContext) => void;
export type InitHandler = (meta: Record<string, any>) => void;
export type ScheduleHandler = PromiseCallback;
export type EmbedHandler = () => string;
