import type { SYSTEM_COLLECTION_NAMES } from '@directus/constants';
import type {
	ActionHandler,
	EmbedHandler,
	FilterHandler,
	InitHandler,
	MutationEventContext,
	ReadEventContext,
	ScheduleHandler,
} from '../events.js';
import type { CreateEntry, UpdateEntry } from '../items.js';
import type { PermissionsAction } from '../permissions.js';
import type { ApiExtensionContext } from './api-extension-context.js';

export type HookExtensionContext = ApiExtensionContext & {
	emitter: any;
};

export type MutationAction = Exclude<PermissionsAction, 'read' | 'share'>;

export type SystemCollection = (typeof SYSTEM_COLLECTION_NAMES)[number];

/** The prefix an `ItemsService` over a system collection emits its events under. */
export type SystemScope = SystemCollection extends `directus_${infer Scope}`
	? Scope
	: never;

/**
 * The filter events an `ItemsService` emits, and so the ones whose context carries a
 * scoped-cache handle: `items.<op>`, `<collection>.items.<op>` and, for a system
 * collection, `<name>.<op>`. A create and an update are emitted grouped, once per
 * mutation.
 */
type ItemsServiceEvent<Action extends PermissionsAction> =
	| `items.${Action}`
	| `${string}.items.${Action}`
	| `${SystemScope}.${Action}`;

export type ItemsReadEvent = ItemsServiceEvent<'read'>;
export type ItemsCreateEvent = ItemsServiceEvent<'create'>;
export type ItemsUpdateEvent = ItemsServiceEvent<'update'>;
export type ItemsMutationEvent = ItemsServiceEvent<MutationAction>;

/**
 * A system scope whose events a service other than `ItemsService` emits by hand: its
 * context carries no handle.
 */
export type BareFilterEvent =
	| 'fields.create'
	| 'fields.update'
	| 'fields.delete';

/**
 * Overloads in the order TypeScript tries them: a bare event first, so
 * `fields.create` does not read as a mutation; then the item shapes, a grouped
 * create or update defaulting its payload to the list it carries; then any other
 * string, which is also where a non-literal event name lands.
 */
export type RegisterFilter = {
	<TIn = unknown, TOut = TIn>(
		event: BareFilterEvent,
		handler: FilterHandler<TIn, TOut>,
	): void;
	<TIn = unknown, TOut = TIn>(
		event: ItemsReadEvent,
		handler: FilterHandler<TIn, TOut, ReadEventContext>,
	): void;
	<TIn = (CreateEntry | null)[] | null, TOut = TIn>(
		event: ItemsCreateEvent,
		handler: FilterHandler<TIn, TOut, MutationEventContext>,
	): void;
	<TIn = UpdateEntry[] | null, TOut = TIn>(
		event: ItemsUpdateEvent,
		handler: FilterHandler<TIn, TOut, MutationEventContext>,
	): void;
	<TIn = unknown, TOut = TIn>(
		event: ItemsMutationEvent,
		handler: FilterHandler<TIn, TOut, MutationEventContext>,
	): void;
	<TIn = unknown, TOut = TIn>(
		event: string,
		handler: FilterHandler<TIn, TOut>,
	): void;
};

export type RegisterFunctions = {
	filter: RegisterFilter;
	action: (event: string, handler: ActionHandler) => void;
	init: (event: string, handler: InitHandler) => void;
	schedule: (cron: string, handler: ScheduleHandler) => void;
	embed: (position: 'head' | 'body', code: string | EmbedHandler) => void;
};

export type HookConfig = (register: RegisterFunctions, context: HookExtensionContext) => void;
