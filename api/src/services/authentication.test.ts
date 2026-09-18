import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import knex from 'knex';
import { MockClient, createTracker, type Tracker } from 'knex-mock-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
	return { scoped: true, purgeForMutatedRows: vi.fn() };
});

vi.mock('../database/index.js', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('../auth.js', () => {
	return { getAuthProvider: vi.fn() };
});

vi.mock('../rate-limiter.js', () => {
	return { createRateLimiter: () => ({ set: vi.fn() }), RateLimiterRes: class {} };
});

vi.mock('../extensions/lib/scoped-cache-handle.js', () => {
	return {
		createScopedCacheExtensionHandle: () => {
			return { purgeForMutatedRows: state.purgeForMutatedRows };
		},
	};
});

vi.mock('../scoped-cache.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../scoped-cache.js')>();

	return { ...actual, scopedCachePurgeEnabled: () => state.scoped };
});

const { AuthenticationService } = await import('./authentication.js');

const schema = new SchemaBuilder()
	.collection('directus_users', (c) => {
		c.field('id')
			.uuid()
			.primary();
	})
	.build();

describe('a login or a refresh touching last_access', () => {
	const db = knex.default({ client: MockClient });
	let tracker: Tracker;

	beforeEach(() => {
		tracker = createTracker(db);
		tracker.on.update('directus_users').response(1);
	});

	afterEach(() => {
		tracker.reset();
		vi.clearAllMocks();
	});

	it(oneLine`
		writes the stamp raw and purges the user's slices, since no hook heard the
		write
	`, async () => {
		state.scoped = true;
		const service = new AuthenticationService({ knex: db, schema });

		await (service as any).touchLastAccess('u-1');

		expect(tracker.history.update).toHaveLength(1);
		expect(tracker.history.update[0]!.bindings.at(-1)).toBe('u-1');

		expect(state.purgeForMutatedRows)
			.toHaveBeenCalledWith('directus_users', [{ id: 'u-1' }]);
	});

	it('leaves the cache alone in full mode, as upstream does', async () => {
		state.scoped = false;
		const service = new AuthenticationService({ knex: db, schema });

		await (service as any).touchLastAccess('u-1');

		expect(tracker.history.update).toHaveLength(1);
		expect(state.purgeForMutatedRows).not.toHaveBeenCalled();
	});
});
