import { ForbiddenError } from '@directus/errors';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { subscriptionsHook } from './hook.js';
import {
	refusePlanDelete,
	refusePlanStatusUpdate,
	refuseSubscriptionEventWrite,
	refuseSubscriptionStateUpdate,
	refuseUsedReferenceUpdate,
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

	test('filters the writes around the plans and their history', () => {
		const filter = vi.fn();

		(subscriptionsHook.config as (...args: unknown[]) => void)(
			{ filter, init: vi.fn(), schedule: vi.fn() },
			{ env: { MAX_PAYLOAD_SIZE: '1mb' }, database: 'database' },
		);

		expect(filter.mock.calls).toEqual([
			['subscription_plans.items.delete', expect.any(Function)],
			['subscription_plans.items.update', expect.any(Function)],
			['subscription_plan_references.items.update', expect.any(Function)],
			['subscriptions.items.update', expect.any(Function)],
			['subscription_events.items.create', expect.any(Function)],
			['subscription_events.items.update', expect.any(Function)],
			['subscription_events.items.delete', expect.any(Function)],
		]);
	});

	const WRITE_FILTERS = [
		[
			'subscription_plans.items.delete',
			0,
			[1],
			{ action: 'delete', collection: 'subscription_plans', primaryKeys: [1] },
			refusePlanDelete,
			[[1], 'filter database'],
		],
		[
			'subscription_plans.items.update',
			1,
			[{ data: { status: 'archived' }, keys: [1] }],
			{
				action: 'update',
				collection: 'subscription_plans',
				primaryKeys: [1],
				fields: ['status'],
			},
			refusePlanStatusUpdate,
			[[{ data: { status: 'archived' }, keys: [1] }], 'filter database'],
		],
		[
			'subscription_plan_references.items.update',
			2,
			[{ data: { reference: 'other' }, keys: [1] }],
			{
				action: 'update',
				collection: 'subscription_plan_references',
				primaryKeys: [1],
				fields: ['reference'],
			},
			refuseUsedReferenceUpdate,
			[[{ data: { reference: 'other' }, keys: [1] }], 'filter database'],
		],
		[
			'subscriptions.items.update',
			3,
			[{ data: { status: 'canceled' }, keys: [1] }],
			{
				action: 'update',
				collection: 'subscriptions',
				primaryKeys: [1],
				fields: ['status'],
			},
			refuseSubscriptionStateUpdate,
			[[{ data: { status: 'canceled' }, keys: [1] }]],
		],
		[
			'subscription_events.items.create',
			4,
			{ source: 'sync' },
			{ action: 'create', collection: 'subscription_events' },
			refuseSubscriptionEventWrite,
			[],
		],
		[
			'subscription_events.items.update',
			5,
			[{ data: { source: 'sync' }, keys: [1] }],
			{ action: 'update', collection: 'subscription_events' },
			refuseSubscriptionEventWrite,
			[],
		],
		[
			'subscription_events.items.delete',
			6,
			[1],
			{ action: 'delete', collection: 'subscription_events' },
			refuseSubscriptionEventWrite,
			[],
		],
	] as const;

	test.each(WRITE_FILTERS)('%s checks the access, then refuses', async (
		_eventName,
		filterIndex,
		eventPayload,
		accessCheck,
		refuseWrite,
		refuseArguments,
	) => {
		const filter = vi.fn();
		const validateAccess = vi.fn();

		(subscriptionsHook.config as (...args: unknown[]) => void)(
			{ filter, init: vi.fn(), schedule: vi.fn() },
			{ env: { MAX_PAYLOAD_SIZE: '1mb' }, database: 'database', validateAccess },
		);

		await filter.mock.calls[filterIndex]?.[1](eventPayload, {}, {
			database: 'filter database',
			schema: 'schema',
			accountability: { user: 'user-1' },
		});

		expect(validateAccess).toHaveBeenCalledWith(
			{ ...accessCheck, accountability: { user: 'user-1' } },
			{ knex: 'filter database', schema: 'schema' },
		);

		expect(refuseWrite).toHaveBeenCalledWith(...refuseArguments);
	});

	test.each(WRITE_FILTERS)('%s answers 403 before any refusal', async (
		_eventName,
		filterIndex,
		eventPayload,
		_accessCheck,
		refuseWrite,
	) => {
		const filter = vi.fn();
		const validateAccess = vi.fn().mockRejectedValue(new ForbiddenError());

		(subscriptionsHook.config as (...args: unknown[]) => void)(
			{ filter, init: vi.fn(), schedule: vi.fn() },
			{ env: { MAX_PAYLOAD_SIZE: '1mb' }, database: 'database', validateAccess },
		);

		await expect(filter.mock.calls[filterIndex]?.[1](eventPayload, {}, {
			database: 'filter database',
			schema: 'schema',
			accountability: { user: 'user-1' },
		})).rejects.toThrow(new ForbiddenError());

		expect(refuseWrite).not.toHaveBeenCalled();
	});

	test.each(WRITE_FILTERS)('%s checks no access for an internal call', async (
		_eventName,
		filterIndex,
		eventPayload,
		_accessCheck,
		refuseWrite,
	) => {
		const filter = vi.fn();
		const validateAccess = vi.fn();

		(subscriptionsHook.config as (...args: unknown[]) => void)(
			{ filter, init: vi.fn(), schedule: vi.fn() },
			{ env: { MAX_PAYLOAD_SIZE: '1mb' }, database: 'database', validateAccess },
		);

		await filter.mock.calls[filterIndex]?.[1](eventPayload, {}, {
			database: 'filter database',
			schema: 'schema',
			accountability: null,
		});

		expect(validateAccess).not.toHaveBeenCalled();
		expect(refuseWrite).toHaveBeenCalled();
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
