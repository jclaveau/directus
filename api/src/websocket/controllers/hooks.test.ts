import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import emitter from '../../emitter.js';
import { registerWebSocketEvents } from './hooks.js';

const publishEvent = vi.hoisted(() => vi.fn());

vi.mock('../../bus/index.js', () => {
	return { useBus: () => ({ publish: publishEvent }) };
});

vi.mock('../../database/index.js', () => ({ default: vi.fn() }));

beforeAll(() => {
	registerWebSocketEvents();
});

afterEach(() => {
	publishEvent.mockClear();
});

describe('update messages', () => {
	test('an update sends one message, each key once', async () => {
		await emitter.emitAction('items.update', {
			payload: [
				{ data: { status: 'a' }, keys: [1, 2] },
				{ data: { title: 'b' }, keys: [2, 3] },
			],
			collection: 'articles',
		});

		expect(publishEvent.mock.calls).toEqual([
			['websocket.event', {
				collection: 'articles',
				action: 'update',
				keys: [1, 2, 3],
				payload: [
					{ data: { status: 'a' }, keys: [1, 2] },
					{ data: { title: 'b' }, keys: [2, 3] },
				],
			}],
		]);
	});

	test('a relations update sends one message per group', async () => {
		await emitter.emitAction('relations.update', {
			payload: [
				{ data: { one_field: 'tags' }, keys: [4] },
				{ data: { one_field: 'links' }, keys: [5, 6] },
			],
			collection: 'directus_relations',
		});

		expect(publishEvent.mock.calls).toEqual([
			['websocket.event', {
				collection: 'directus_relations',
				action: 'update',
				keys: [4],
				payload: { one_field: 'tags' },
			}],
			['websocket.event', {
				collection: 'directus_relations',
				action: 'update',
				keys: [5, 6],
				payload: { one_field: 'links' },
			}],
		]);
	});

	test('a field FieldsService updates sends its own key', async () => {
		await emitter.emitAction('fields.update', {
			payload: { field: 'title', meta: { note: 'x' } },
			keys: ['title'],
			collection: 'articles',
		});

		expect(publishEvent.mock.calls).toEqual([
			['websocket.event', {
				collection: 'directus_fields',
				action: 'update',
				keys: ['title'],
				payload: { field: 'title', meta: { note: 'x' } },
			}],
		]);
	});

	test('a grouped fields update sends one message per group', async () => {
		await emitter.emitAction('fields.update', {
			payload: [
				{ data: { collection: 'articles', field: 'title' }, keys: [8] },
				{ data: { collection: 'articles', field: 'body' }, keys: [9] },
			],
			collection: 'directus_fields',
		});

		expect(publishEvent.mock.calls).toEqual([
			['websocket.event', {
				collection: 'directus_fields',
				action: 'update',
				keys: [8],
				payload: { collection: 'articles', field: 'title' },
			}],
			['websocket.event', {
				collection: 'directus_fields',
				action: 'update',
				keys: [9],
				payload: { collection: 'articles', field: 'body' },
			}],
		]);
	});
});

describe('create messages', () => {
	test('a relation create sends one message per row', async () => {
		await emitter.emitAction('relations.create', {
			payload: [{ many_collection: 'articles' }],
			keys: [5],
			collection: 'directus_relations',
		});

		await emitter.emitAction('relations.create.one', {
			payload: { many_collection: 'articles' },
			key: 5,
			collection: 'directus_relations',
		});

		expect(publishEvent.mock.calls).toEqual([
			['websocket.event', {
				collection: 'directus_relations',
				action: 'create',
				key: 5,
				payload: { many_collection: 'articles', key: 5 },
			}],
		]);
	});

	test('a fields create sends the flat field and each row', async () => {
		await emitter.emitAction('fields.create', {
			payload: { field: 'title', type: 'string' },
			key: 'title',
			collection: 'articles',
		});

		await emitter.emitAction('fields.create', {
			payload: [{ field: 'body' }],
			keys: [7],
			collection: 'directus_fields',
		});

		await emitter.emitAction('fields.create.one', {
			payload: { field: 'body' },
			key: 7,
			collection: 'directus_fields',
		});

		expect(publishEvent.mock.calls).toEqual([
			['websocket.event', {
				collection: 'directus_fields',
				action: 'create',
				key: 'title',
				payload: { field: 'title', type: 'string' },
			}],
			['websocket.event', {
				collection: 'directus_fields',
				action: 'create',
				key: 7,
				payload: { field: 'body' },
			}],
		]);
	});
});
