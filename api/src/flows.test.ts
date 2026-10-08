import type { FlowRaw } from '@directus/types';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import emitter from './emitter.js';
import { getFlowManager } from './flows.js';
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
	recordTrigger.mockClear();
});

async function loadEventFlow(options: Record<string, unknown>) {
	vi.mocked(FlowsService).mockImplementation(function () {
		return {
		readByQuery: async (): Promise<FlowRaw[]> => {
			return [{
			id: 'flow-1',
			trigger: 'event',
			accountability: null,
			options,
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
}

describe('event flows on item updates', () => {
	test('a filter flow runs per group, its return replacing the data', async () => {
		await loadEventFlow({
			type: 'filter',
			scope: ['items.update'],
			collections: ['articles'],
			return: '$last',
		});

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
		await loadEventFlow({
			type: 'filter',
			scope: ['items.update'],
			collections: ['articles'],
		});

		const groupsAfterFlow = await emitter.emitFilter(
			'articles.items.update',
			[{ data: { status: 'a' }, keys: [1, 2] }],
			{ collection: 'articles' },
		);

		expect(groupsAfterFlow).toEqual([{ data: { status: 'a' }, keys: [1, 2] }]);
	});

	test('an action flow runs once per group, keys beside the data', async () => {
		await loadEventFlow({
			type: 'action',
			scope: ['items.update'],
			collections: ['articles'],
		});

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

	test('a system collection listens on its grouped update event', async () => {
		await loadEventFlow({
			type: 'action',
			scope: ['items.update'],
			collections: ['directus_users'],
		});

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
});

describe('event flows on item creates', () => {
	test('a create flow listens per row, never on the grouped event', async () => {
		await loadEventFlow({
			type: 'filter',
			scope: ['items.create'],
			collections: ['articles', 'directus_users'],
		});

		expect([
			emitter.hasFilterListeners('articles.items.create.one'),
			emitter.hasFilterListeners('users.create.one'),
			emitter.hasFilterListeners('articles.items.create'),
			emitter.hasFilterListeners('users.create'),
		]).toEqual([true, true, false, false]);
	});

	test('a create action flow receives the row as it always has', async () => {
		await loadEventFlow({
			type: 'action',
			scope: ['items.create'],
			collections: ['articles'],
		});

		await emitter.emitAction('articles.items.create.one', {
			payload: { title: 'x' },
			key: 7,
			collection: 'articles',
		});

		expect(recordTrigger.mock.calls).toEqual([
			[{
				event: 'articles.items.create.one',
				payload: { title: 'x' },
				key: 7,
				collection: 'articles',
			}],
		]);
	});
});
