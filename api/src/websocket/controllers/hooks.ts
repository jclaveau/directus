import type { PrimaryKey, UpdateGroup } from '@directus/types';
import { useBus } from '../../bus/index.js';
import emitter from '../../emitter.js';
import type { WebSocketEvent } from '../messages.js';

let actionsRegistered = false;

export function registerWebSocketEvents() {
	if (actionsRegistered) return;
	actionsRegistered = true;

	registerActionHooks([
		'items',
		'access',
		'activity',
		'collections',
		'dashboards',
		'flows',
		'folders',
		'notifications',
		'operations',
		'panels',
		'permissions',
		'policies',
		'presets',
		'revisions',
		'roles',
		'settings',
		'shares',
		'translations',
		'users',
		'versions',
		'webhooks',
	]);

	registerFieldsHooks();
	registerFilesHooks();
	registerRelationsHooks();
	registerSortHooks();
}

// `items.update` carries a group per change, so the wire's `keys` is every group's,
// each key once. Shared by every module's update and by files', which differ only
// in the event they register for.
function updateEvent(
	{ collection, payload = [] }: Record<string, any>,
): WebSocketEvent {
	return {
		collection,
		action: 'update',
		keys: [
			...new Set<PrimaryKey>(
				payload.flatMap((group: UpdateGroup) => group.keys),
			),
		],
		payload,
	};
}

// A `directus_relations` subscriber is sent the payload as is, and a
// `directus_fields` one reads `collection` and `field` off it, so each group
// goes out as the flat change it carries.
function updateEventPerGroup(
	{ payload = [] }: Record<string, any>,
	collection: string,
): WebSocketEvent[] {
	return payload.map((group: UpdateGroup) => {
		return {
			collection,
			action: 'update',
			keys: group.keys,
			payload: group.data,
		};
	});
}

function registerActionHooks(modules: string[]) {
	// register event hooks that can be handled in an uniform manner
	for (const module of modules) {
		// One message per row; the grouped `create` carries the whole create.
		registerAction(`${module}.create.one`, ({ key, collection, payload = {} }) => {
			return {
				collection,
				action: 'create',
				key,
				payload,
			};
		});

		registerAction(`${module}.update`, updateEvent);

		registerAction(module + '.delete', ({ keys, collection, payload = [] }) => ({
			collection,
			action: 'delete',
			keys,
			payload,
		}));
	}
}

function registerFieldsHooks() {
	// exception for field hooks that don't report `directus_fields` as being the collection
	// FieldsService emits `fields.create` and `fields.update` itself with one field;
	// a `directus_fields` write through ItemsService emits them grouped, its
	// create's rows reaching `fields.create.one`.
	registerAction('fields.create', ({ key, payload = {} }) => {
		if (Array.isArray(payload)) {
			return null;
		}

		return {
			collection: 'directus_fields',
			action: 'create',
			key,
			payload,
		};
	});

	registerAction('fields.create.one', ({ key, payload = {} }) => {
		return {
			collection: 'directus_fields',
			action: 'create',
			key,
			payload,
		};
	});

	registerAction('fields.update', (meta) => {
		if (Array.isArray(meta['payload'])) {
			return updateEventPerGroup(meta, 'directus_fields');
		}

		return {
			collection: 'directus_fields',
			action: 'update',
			keys: meta['keys'] ?? [],
			payload: meta['payload'] ?? {},
		};
	});

	registerAction('fields.delete', ({ keys, payload = [] }) => ({
		collection: 'directus_fields',
		action: 'delete',
		keys,
		payload,
	}));
}

function registerFilesHooks() {
	// extra event for file uploads that doubles as create event
	registerAction('files.upload', ({ key, collection, payload = {} }) => ({
		collection,
		action: 'create',
		key,
		payload,
	}));

	registerAction('files.update', updateEvent);

	registerAction('files.delete', ({ keys, collection, payload = [] }) => ({
		collection,
		action: 'delete',
		keys,
		payload,
	}));
}

function registerRelationsHooks() {
	// exception for relation hooks that don't report `directus_relations` as being the collection
	registerAction('relations.create.one', ({ key, payload = {} }) => {
		return {
			collection: 'directus_relations',
			action: 'create',
			key,
			payload: { ...payload, key },
		};
	});

	registerAction('relations.update', (meta) => {
		return updateEventPerGroup(meta, 'directus_relations');
	});

	registerAction('relations.delete', ({ collection, payload = [] }) => ({
		collection: 'directus_relations',
		action: 'delete',
		keys: payload,
		payload: { collection, fields: payload },
	}));
}

function registerSortHooks() {
	registerAction('items.sort', ({ collection, item }) => ({
		collection,
		action: 'update',
		keys: [item],
		payload: {},
	}));
}

/**
 * Wrapper for emitter.onAction to hook into system events
 * @param event The action event to watch
 * @param transform Transformer function
 */
function registerAction(
	event: string,
	transform: (
		args: Record<string, any>,
	) => WebSocketEvent | WebSocketEvent[] | null,
) {
	const messenger = useBus();

	emitter.onAction(event, (data: Record<string, any>) => {
		const websocketEvents = transform(data);

		if (websocketEvents === null) {
			return;
		}

		// push the event through the Redis pub/sub
		for (const websocketEvent of [websocketEvents].flat()) {
			messenger.publish('websocket.event', websocketEvent as Record<string, any>);
		}
	});
}
