import type { Knex } from 'knex';
import type { Accountability } from './accountability.js';
import type { PromiseCallback } from './misc.js';
import type { ScopedCacheHandle } from './read-meta.js';
import type { SchemaOverview } from './schema.js';

export type EventContext = {
	database: Knex;
	schema: SchemaOverview | null;
	accountability: Accountability | null;
	/**
	 * Present on CRUD *filter* hooks (`items.read`/`create`/`update`/`delete`): lets
	 * the hook add scoped cache tags for this op. See {@link ScopedCacheHandle}.
	 */
	scopedCache?: ScopedCacheHandle;
};

export type FilterHandler<TIn = unknown, TOut = TIn> = (
	payload: TIn,
	meta: Record<string, any>,
	context: EventContext,
) => TIn | TOut | Promise<TIn | TOut>;
export type ActionHandler = (meta: Record<string, any>, context: EventContext) => void;
export type InitHandler = (meta: Record<string, any>) => void;
export type ScheduleHandler = PromiseCallback;
export type EmbedHandler = () => string;
