import { afterEach, describe, expect, test, vi } from 'vitest';
import { subscriptionsHook } from './hook.js';
import {
	refusePlanArchiveByUpdate,
	refusePlanDelete,
	refuseSubscriptionEventWrite,
} from './plans/refuse-direct-writes.js';
import { enqueueReconcile } from './sync/enqueue-reconcile.js';
import { runSyncBatch } from './sync/run-sync-batch.js';
import { mountRawBody } from './webhook/mount-raw-body.js';

vi.mock('./plans/refuse-direct-writes.js');
vi.mock('./sync/enqueue-reconcile.js');
vi.mock('./sync/run-sync-batch.js');

vi.mock('./webhook/mount-raw-body.js', async (importOriginal) => {
	return {
		...await importOriginal<typeof import('./webhook/mount-raw-body.js')>(),
		mountRawBody: vi.fn(),
	};
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetAllMocks();
});

describe('subscriptionsHook', () => {
	test('mounts the raw body parser before the JSON one', () => {
		const init = vi.fn();

		(subscriptionsHook.config as (...args: unknown[]) => void)(
			{ filter: vi.fn(), init, schedule: vi.fn() },
			{ env: { MAX_PAYLOAD_SIZE: '1mb' }, database: 'database' },
		);

		expect(init).toHaveBeenCalledWith('middlewares.before', expect.any(Function));
		init.mock.calls[0]?.[1]({ app: 'app' });
		expect(mountRawBody).toHaveBeenCalledWith('app', '1mb');
	});

	test('runs a sync batch every 10 seconds', async () => {
		const schedule = vi.fn();
		const logger = { warn: vi.fn() };
		const AccessService = vi.fn();

		(subscriptionsHook.config as (...args: unknown[]) => void)(
			{ filter: vi.fn(), init: vi.fn(), schedule },
			{
				env: { MAX_PAYLOAD_SIZE: '1mb' },
				database: 'database',
				services: { AccessService },
				getSchema: vi.fn().mockResolvedValue('schema'),
				logger,
			},
		);

		expect(schedule).toHaveBeenCalledWith('*/10 * * * * *', expect.any(Function));
		await schedule.mock.calls[0]?.[1]();

		expect(runSyncBatch).toHaveBeenCalledWith({
			database: 'database',
			enabledProviders: new Map(),
			logger,
			createAccessService: expect.any(Function),
		});

		vi.mocked(runSyncBatch).mock.calls[0]?.[0].createAccessService(
			'trx' as never,
		);

		expect(AccessService).toHaveBeenCalledWith({ knex: 'trx', schema: 'schema' });
	});

	test('refuses writes around the plans and their history', async () => {
		const filter = vi.fn();

		(subscriptionsHook.config as (...args: unknown[]) => void)(
			{ filter, init: vi.fn(), schedule: vi.fn() },
			{ env: { MAX_PAYLOAD_SIZE: '1mb' }, database: 'database' },
		);

		expect(filter.mock.calls).toEqual([
			['subscription_plans.items.delete', expect.any(Function)],
			['subscription_plans.items.update', refusePlanArchiveByUpdate],
			['subscription_events.items.create', refuseSubscriptionEventWrite],
			['subscription_events.items.update', refuseSubscriptionEventWrite],
			['subscription_events.items.delete', refuseSubscriptionEventWrite],
		]);

		vi.mocked(refusePlanDelete).mockResolvedValue([1]);

		await expect(filter.mock.calls[0]?.[1](
			[1],
			{},
			{ database: 'filter database' },
		)).resolves.toEqual([1]);

		expect(refusePlanDelete).toHaveBeenCalledWith([1], 'filter database');
	});

	test('queues a reconcile every hour', async () => {
		const schedule = vi.fn();

		(subscriptionsHook.config as (...args: unknown[]) => void)(
			{ filter: vi.fn(), init: vi.fn(), schedule },
			{ env: { MAX_PAYLOAD_SIZE: '1mb' }, database: 'database' },
		);

		expect(schedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function));
		await schedule.mock.calls[1]?.[1]();
		expect(enqueueReconcile).toHaveBeenCalledWith('database', new Map());
	});
});
