import type { FlowRaw } from '@directus/types';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import emitter from './emitter.js';
import { getFlowManager } from './flows.js';
import { ActivityService } from './services/activity.js';
import { FlowsService } from './services/flows.js';

vi.mock('./bus/index.js', () => {
	return { useBus: () => ({ subscribe: vi.fn(), publish: vi.fn() }) };
});

vi.mock('./database/index.js', () => ({ default: vi.fn() }));
vi.mock('./services/index.js', () => ({}));
vi.mock('./services/activity.js', () => ({ ActivityService: vi.fn() }));
vi.mock('./services/revisions.js', () => ({ RevisionsService: vi.fn() }));
vi.mock('./services/flows.js', () => ({ FlowsService: vi.fn() }));
vi.mock('./utils/get-schema.js', () => ({ getSchema: vi.fn() }));

vi.mock('./extensions/lib/scoped-cache-handle.js', () => {
	return { createScopedCacheExtensionHandle: vi.fn() };
});

const recordTrigger = vi.fn();

beforeEach(() => {
	getFlowManager().addOperation('record', (_options, { data }) => {
		recordTrigger(data['$trigger']);

		return { status: 'stamped' };
	});
});

afterEach(async () => {
	emitter.offAll();
	await (getFlowManager() as any).unload();
	vi.restoreAllMocks();
	recordTrigger.mockClear();
});

describe('event flows on item updates', () => {
	test('a filter flow runs per group, its return replacing the data', async () => {
		vi.mocked(FlowsService).mockImplementation(function () {
			return {
				readByQuery: async (): Promise<FlowRaw[]> => {
					return [{
						id: 'flow-1',
						trigger: 'event',
						accountability: null,
						options: {
							type: 'filter',
							scope: ['items.update'],
							collections: ['articles'],
							return: '$last',
						},
						operation: 'op-1',
						operations: [{
							id: 'op-1',
							key: 'record',
							type: 'record',
							options: {},
							resolve: null,
							reject: null,
							flow: 'flow-1',
						}],
					} as unknown as FlowRaw];
				},
			} as unknown as FlowsService;
		});

		await (getFlowManager() as any).load();

		const groupsAfterFlow = await emitter.emitFilter(
			'articles.items.update',
			[
				{ data: { status: 'a' }, keys: [1, 3] },
				{ data: { status: 'b' }, keys: [2] },
			],
			{ collection: 'articles' },
		);

		expect(groupsAfterFlow).toEqual([
			{ data: { status: 'stamped' }, keys: [1, 3] },
			{ data: { status: 'stamped' }, keys: [2] },
		]);

		expect(recordTrigger.mock.calls).toEqual([
			[{
				event: 'articles.items.update',
				payload: { status: 'a' },
				keys: [1, 3],
				collection: 'articles',
				originalPayload: { status: 'a' },
			}],
			[{
				event: 'articles.items.update',
				payload: { status: 'b' },
				keys: [2],
				collection: 'articles',
				originalPayload: { status: 'b' },
			}],
		]);
	});

	test('a filter flow with no return keeps each group as it was', async () => {
		vi.mocked(FlowsService).mockImplementation(function () {
			return {
				readByQuery: async (): Promise<FlowRaw[]> => {
					return [{
						id: 'flow-1',
						trigger: 'event',
						accountability: null,
						options: {
							type: 'filter',
							scope: ['items.update'],
							collections: ['articles'],
						},
						operation: 'op-1',
						operations: [{
							id: 'op-1',
							key: 'record',
							type: 'record',
							options: {},
							resolve: null,
							reject: null,
							flow: 'flow-1',
						}],
					} as unknown as FlowRaw];
				},
			} as unknown as FlowsService;
		});

		await (getFlowManager() as any).load();

		const groupsAfterFlow = await emitter.emitFilter(
			'articles.items.update',
			[{ data: { status: 'a' }, keys: [1, 2] }],
			{ collection: 'articles' },
		);

		expect(groupsAfterFlow).toEqual([{ data: { status: 'a' }, keys: [1, 2] }]);
	});

	test('a filter flow returning null hands the group a null data', async () => {
		getFlowManager().addOperation('clear', () => null);

		vi.mocked(FlowsService).mockImplementation(function () {
			return {
				readByQuery: async (): Promise<FlowRaw[]> => {
					return [{
						id: 'flow-1',
						trigger: 'event',
						accountability: null,
						options: {
							type: 'filter',
							scope: ['items.update'],
							collections: ['articles'],
							return: '$last',
						},
						operation: 'op-1',
						operations: [{
							id: 'op-1',
							key: 'record',
							type: 'clear',
							options: {},
							resolve: null,
							reject: null,
							flow: 'flow-1',
						}],
					} as unknown as FlowRaw];
				},
			} as unknown as FlowsService;
		});

		await (getFlowManager() as any).load();

		const groupsAfterFlow = await emitter.emitFilter(
			'articles.items.update',
			[{ data: { status: 'a' }, keys: [1, 2] }],
			{ collection: 'articles' },
		);

		expect(groupsAfterFlow).toEqual([{ data: null, keys: [1, 2] }]);
	});

	test('an action flow runs once per group, keys beside the data', async () => {
		vi.mocked(FlowsService).mockImplementation(function () {
			return {
				readByQuery: async (): Promise<FlowRaw[]> => {
					return [{
						id: 'flow-1',
						trigger: 'event',
						accountability: null,
						options: {
							type: 'action',
							scope: ['items.update'],
							collections: ['articles'],
						},
						operation: 'op-1',
						operations: [{
							id: 'op-1',
							key: 'record',
							type: 'record',
							options: {},
							resolve: null,
							reject: null,
							flow: 'flow-1',
						}],
					} as unknown as FlowRaw];
				},
			} as unknown as FlowsService;
		});

		await (getFlowManager() as any).load();

		await emitter.emitAction('articles.items.update', {
			payload: [
				{ data: { status: 'a' }, keys: [1, 3] },
				{ data: { status: 'b' }, keys: [2] },
			],
			collection: 'articles',
		});

		expect(recordTrigger.mock.calls).toEqual([
			[{
				event: 'articles.items.update',
				payload: { status: 'a' },
				keys: [1, 3],
				collection: 'articles',
			}],
			[{
				event: 'articles.items.update',
				payload: { status: 'b' },
				keys: [2],
				collection: 'articles',
			}],
		]);
	});

	test('an action flow failing on one group still runs the next', async () => {
		vi.mocked(ActivityService)
			.mockImplementationOnce(function () {
				return {
					createOne: async () => {
						throw new Error('activity write failed');
					},
				} as unknown as ActivityService;
			})
			.mockImplementationOnce(function () {
				return { createOne: async () => 'activity-2' } as unknown as ActivityService;
			});

		vi.mocked(FlowsService).mockImplementation(function () {
			return {
				readByQuery: async (): Promise<FlowRaw[]> => {
					return [{
						id: 'flow-1',
						trigger: 'event',
						accountability: 'activity',
						options: {
							type: 'action',
							scope: ['items.update'],
							collections: ['articles'],
						},
						operation: 'op-1',
						operations: [{
							id: 'op-1',
							key: 'record',
							type: 'record',
							options: {},
							resolve: null,
							reject: null,
							flow: 'flow-1',
						}],
					} as unknown as FlowRaw];
				},
			} as unknown as FlowsService;
		});

		await (getFlowManager() as any).load();

		await emitter.emitAction('articles.items.update', {
			payload: [
				{ data: { status: 'a' }, keys: [1] },
				{ data: { status: 'b' }, keys: [2] },
			],
			collection: 'articles',
		});

		expect(ActivityService).toHaveBeenCalledTimes(2);
	});

	test('a system collection listens on its grouped update event', async () => {
		vi.mocked(FlowsService).mockImplementation(function () {
			return {
				readByQuery: async (): Promise<FlowRaw[]> => {
					return [{
						id: 'flow-1',
						trigger: 'event',
						accountability: null,
						options: {
							type: 'action',
							scope: ['items.update'],
							collections: ['directus_users'],
						},
						operation: 'op-1',
						operations: [{
							id: 'op-1',
							key: 'record',
							type: 'record',
							options: {},
							resolve: null,
							reject: null,
							flow: 'flow-1',
						}],
					} as unknown as FlowRaw];
				},
			} as unknown as FlowsService;
		});

		await (getFlowManager() as any).load();

		await emitter.emitAction('users.update', {
			payload: [{ data: { status: 'active' }, keys: ['u-1', 'u-2'] }],
			collection: 'directus_users',
		});

		expect(recordTrigger.mock.calls).toEqual([
			[{
				event: 'users.update',
				payload: { status: 'active' },
				keys: ['u-1', 'u-2'],
				collection: 'directus_users',
			}],
		]);
	});

	test('a filter flow runs on the field FieldsService emits itself', async () => {
		vi.mocked(FlowsService).mockImplementation(function () {
			return {
				readByQuery: async (): Promise<FlowRaw[]> => {
					return [{
						id: 'flow-1',
						trigger: 'event',
						accountability: null,
						options: {
							type: 'filter',
							scope: ['items.update'],
							collections: ['directus_fields'],
							return: '$last',
						},
						operation: 'op-1',
						operations: [{
							id: 'op-1',
							key: 'record',
							type: 'record',
							options: {},
							resolve: null,
							reject: null,
							flow: 'flow-1',
						}],
					} as unknown as FlowRaw];
				},
			} as unknown as FlowsService;
		});

		await (getFlowManager() as any).load();

		const fieldAfterFlow = await emitter.emitFilter(
			'fields.update',
			{ field: 'title', meta: { note: 'x' } },
			{ keys: ['title'], collection: 'articles' },
		);

		expect(fieldAfterFlow).toEqual({ status: 'stamped' });

		expect(recordTrigger.mock.calls).toEqual([
			[{
				event: 'fields.update',
				payload: { field: 'title', meta: { note: 'x' } },
				keys: ['title'],
				collection: 'articles',
				originalPayload: { field: 'title', meta: { note: 'x' } },
			}],
		]);
	});

	test('an action flow runs on the field FieldsService emits itself', async () => {
		vi.mocked(FlowsService).mockImplementation(function () {
			return {
				readByQuery: async (): Promise<FlowRaw[]> => {
					return [{
						id: 'flow-1',
						trigger: 'event',
						accountability: null,
						options: {
							type: 'action',
							scope: ['items.update'],
							collections: ['directus_fields'],
						},
						operation: 'op-1',
						operations: [{
							id: 'op-1',
							key: 'record',
							type: 'record',
							options: {},
							resolve: null,
							reject: null,
							flow: 'flow-1',
						}],
					} as unknown as FlowRaw];
				},
			} as unknown as FlowsService;
		});

		await (getFlowManager() as any).load();

		await emitter.emitAction('fields.update', {
			payload: { field: 'title', meta: { note: 'x' } },
			keys: ['title'],
			collection: 'articles',
		});

		expect(recordTrigger.mock.calls).toEqual([
			[{
				event: 'fields.update',
				payload: { field: 'title', meta: { note: 'x' } },
				keys: ['title'],
				collection: 'articles',
			}],
		]);
	});
});

describe('event flows on item creates', () => {
	test('a create flow listens per row and on the bare system event', async () => {
		vi.mocked(FlowsService).mockImplementation(function () {
			return {
				readByQuery: async (): Promise<FlowRaw[]> => {
					return [{
						id: 'flow-1',
						trigger: 'event',
						accountability: null,
						options: {
							type: 'filter',
							scope: ['items.create'],
							collections: ['articles', 'directus_users'],
						},
						operation: 'op-1',
						operations: [{
							id: 'op-1',
							key: 'record',
							type: 'record',
							options: {},
							resolve: null,
							reject: null,
							flow: 'flow-1',
						}],
					} as unknown as FlowRaw];
				},
			} as unknown as FlowsService;
		});

		await (getFlowManager() as any).load();

		expect([
			emitter.hasFilterListeners('articles.items.create.one'),
			emitter.hasFilterListeners('users.create.one'),
			emitter.hasFilterListeners('articles.items.create'),
			emitter.hasFilterListeners('users.create'),
		]).toEqual([true, true, false, true]);
	});

	test('a create filter flow sees the base event name', async () => {
		vi.mocked(FlowsService).mockImplementation(function () {
			return {
				readByQuery: async (): Promise<FlowRaw[]> => {
					return [{
						id: 'flow-1',
						trigger: 'event',
						accountability: null,
						options: {
							type: 'filter',
							scope: ['items.create'],
							collections: ['articles'],
						},
						operation: 'op-1',
						operations: [{
							id: 'op-1',
							key: 'record',
							type: 'record',
							options: {},
							resolve: null,
							reject: null,
							flow: 'flow-1',
						}],
					} as unknown as FlowRaw];
				},
			} as unknown as FlowsService;
		});

		await (getFlowManager() as any).load();

		await emitter.emitFilter(
			'articles.items.create.one',
			{ title: 'x' },
			{ collection: 'articles' },
		);

		expect(recordTrigger.mock.calls).toEqual([
			[{
				event: 'articles.items.create',
				payload: { title: 'x' },
				collection: 'articles',
				originalPayload: { title: 'x' },
			}],
		]);
	});

	test('a create action flow receives the base event name', async () => {
		vi.mocked(FlowsService).mockImplementation(function () {
			return {
				readByQuery: async (): Promise<FlowRaw[]> => {
					return [{
						id: 'flow-1',
						trigger: 'event',
						accountability: null,
						options: {
							type: 'action',
							scope: ['items.create'],
							collections: ['articles'],
						},
						operation: 'op-1',
						operations: [{
							id: 'op-1',
							key: 'record',
							type: 'record',
							options: {},
							resolve: null,
							reject: null,
							flow: 'flow-1',
						}],
					} as unknown as FlowRaw];
				},
			} as unknown as FlowsService;
		});

		await (getFlowManager() as any).load();

		await emitter.emitAction('articles.items.create.one', {
			payload: { title: 'x' },
			key: 7,
			collection: 'articles',
		});

		expect(recordTrigger.mock.calls).toEqual([
			[{
				event: 'articles.items.create',
				payload: { title: 'x' },
				key: 7,
				collection: 'articles',
			}],
		]);
	});

	test('a create flow runs on the field FieldsService emits itself', async () => {
		vi.mocked(FlowsService).mockImplementation(function () {
			return {
				readByQuery: async (): Promise<FlowRaw[]> => {
					return [{
						id: 'flow-1',
						trigger: 'event',
						accountability: null,
						options: {
							type: 'filter',
							scope: ['items.create'],
							collections: ['directus_fields'],
							return: '$last',
						},
						operation: 'op-1',
						operations: [{
							id: 'op-1',
							key: 'record',
							type: 'record',
							options: {},
							resolve: null,
							reject: null,
							flow: 'flow-1',
						}],
					} as unknown as FlowRaw];
				},
			} as unknown as FlowsService;
		});

		await (getFlowManager() as any).load();

		const fieldAfterFlow = await emitter.emitFilter(
			'fields.create',
			{ field: 'title', type: 'string' },
			{ collection: 'articles' },
		);

		expect(fieldAfterFlow).toEqual({ status: 'stamped' });

		expect(recordTrigger.mock.calls).toEqual([
			[{
				event: 'fields.create',
				payload: { field: 'title', type: 'string' },
				collection: 'articles',
				originalPayload: { field: 'title', type: 'string' },
			}],
		]);
	});

	test('a create flow leaves the grouped create to its per-row event', async () => {
		vi.mocked(FlowsService).mockImplementation(function () {
			return {
				readByQuery: async (): Promise<FlowRaw[]> => {
					return [{
						id: 'flow-1',
						trigger: 'event',
						accountability: null,
						options: {
							type: 'filter',
							scope: ['items.create'],
							collections: ['directus_fields'],
							return: '$last',
						},
						operation: 'op-1',
						operations: [{
							id: 'op-1',
							key: 'record',
							type: 'record',
							options: {},
							resolve: null,
							reject: null,
							flow: 'flow-1',
						}],
					} as unknown as FlowRaw];
				},
			} as unknown as FlowsService;
		});

		await (getFlowManager() as any).load();

		const entriesAfterFlow = await emitter.emitFilter(
			'fields.create',
			[{ data: { field: 'title' } }],
			{ collection: 'directus_fields' },
		);

		expect([entriesAfterFlow, recordTrigger.mock.calls]).toEqual([
			[{ data: { field: 'title' } }],
			[],
		]);
	});

	test('a create action flow runs on the flat fields create', async () => {
		vi.mocked(FlowsService).mockImplementation(function () {
			return {
				readByQuery: async (): Promise<FlowRaw[]> => {
					return [{
						id: 'flow-1',
						trigger: 'event',
						accountability: null,
						options: {
							type: 'action',
							scope: ['items.create'],
							collections: ['directus_fields'],
						},
						operation: 'op-1',
						operations: [{
							id: 'op-1',
							key: 'record',
							type: 'record',
							options: {},
							resolve: null,
							reject: null,
							flow: 'flow-1',
						}],
					} as unknown as FlowRaw];
				},
			} as unknown as FlowsService;
		});

		await (getFlowManager() as any).load();

		await emitter.emitAction('fields.create', {
			payload: { field: 'title', type: 'string' },
			key: 'title',
			collection: 'articles',
		});

		await emitter.emitAction('fields.create', {
			payload: [{ field: 'body' }],
			keys: [3],
			collection: 'directus_fields',
		});

		expect(recordTrigger.mock.calls).toEqual([
			[{
				event: 'fields.create',
				payload: { field: 'title', type: 'string' },
				key: 'title',
				collection: 'articles',
			}],
		]);
	});
});
