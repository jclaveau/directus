import type { SYSTEM_COLLECTION_NAMES } from '@directus/constants';
import type {
	ActionHandler,
	EmbedHandler,
	FilterHandler,
	InitHandler,
	MutationEventContext,
	ReadEventContext,
	ScheduleHandler,
	WrittenEventContext,
} from '../events.js';
import type {
	CreateEntries,
	DeleteKeys,
	Item as AnyItem,
	UpdateEntries,
	UpdateGroup,
} from '../items.js';
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
type ItemsServiceEvent<Action extends PermissionsAction | WrittenAction> =
	| `items.${Action}`
	| `${string}.items.${Action}`
	| `${SystemScope}.${Action}`;

/**
 * The events an `ItemsService` emits once its rows are written, inside the
 * transaction and before it commits.
 */
type WrittenAction = 'created' | 'updated';

export type ItemsReadEvent = ItemsServiceEvent<'read'>;
export type ItemsCreateEvent = ItemsServiceEvent<'create'>;
export type ItemsUpdateEvent = ItemsServiceEvent<'update'>;
export type ItemsDeleteEvent = ItemsServiceEvent<'delete'>;
export type ItemsMutationEvent = ItemsServiceEvent<MutationAction>;
export type ItemsCreatedEvent = ItemsServiceEvent<'created'>;
export type ItemsUpdatedEvent = ItemsServiceEvent<'updated'>;
export type ItemsWrittenEvent = ItemsServiceEvent<WrittenAction>;

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
 * create or update taking the item type and wrapping it in the list it carries,
 * a delete taking the item type too, so `filter<Row>` does not type its keys as
 * a row, and handing them as `DeleteKeys`; then a created or updated one, typed
 * by the rows or groups it wrote; then any other string, which is also where a
 * non-literal event name lands.
 *
 * An item handler may return nothing: `emitFilter` keeps the payload when a
 * handler answers `undefined`.
 *
 * The last overload refuses an item event whose name it can infer, so a handler
 * that does not fit its item overload is an error rather than a silent fall
 * through to the plain context. TypeScript infers no type argument once the
 * caller writes one, so `filter<Row>(...)` and `filter<Row, Out>(...)` still
 * reach it with any event, and an event typed `string` is told apart from no
 * other: `filter<Row>(eventName, ...)` there types the payload as `Row`.
 */
export type RegisterFilter = {
	<TIn = unknown, TOut = TIn>(
		event: BareFilterEvent,
		handler: FilterHandler<TIn, TOut>,
	): void;
	<TIn = unknown, TOut = TIn>(
		event: ItemsReadEvent,
		handler: FilterHandler<TIn, TOut | void, ReadEventContext>,
	): void;
	<EntryItem = AnyItem>(
		event: ItemsCreateEvent,
		handler: FilterHandler<
			CreateEntries<EntryItem> | null,
			CreateEntries<EntryItem> | null | void,
			MutationEventContext
		>,
	): void;
	<EntryItem = AnyItem>(
		event: ItemsUpdateEvent,
		handler: FilterHandler<
			UpdateEntries<EntryItem> | null,
			UpdateEntries<EntryItem> | null | void,
			MutationEventContext
		>,
	): void;
	<_DeletedItem = AnyItem>(
		event: ItemsDeleteEvent,
		handler: FilterHandler<
			DeleteKeys | null,
			DeleteKeys | null | void,
			MutationEventContext
		>,
	): void;
	<CreatedItem = AnyItem>(
		event: ItemsCreatedEvent,
		handler: FilterHandler<CreatedItem[], void, WrittenEventContext>,
	): void;
	<UpdatedItem = AnyItem>(
		event: ItemsUpdatedEvent,
		handler: FilterHandler<
			UpdateGroup<UpdatedItem>[],
			void,
			WrittenEventContext
		>,
	): void;
	<TIn = unknown, TOut = TIn, EventName extends string = string>(
		event: EventName extends ItemsReadEvent | ItemsMutationEvent | ItemsWrittenEvent
			? never
			: EventName,
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
