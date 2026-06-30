import { ForbiddenError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability } from '@directus/types';
import knex, { type Knex } from 'knex';
import { MockClient, createTracker, type Tracker } from 'knex-mock-client';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type MockedFunction,
} from 'vitest';

const env: Record<string, any> = {
	CACHE_AUTO_PURGE: true,
	CACHE_NAMESPACE: 'system-cache',
	MAX_BATCH_MUTATION: 100000,
};

vi.mock('@directus/env', () => {
	return { useEnv: () => env };
});

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('../cache.js', () => {
	return {
		getCache: () => {
			return { cache: null, systemCache: null, localSchemaCache: null, lockCache: null };
		},
		clearSystemCache: vi.fn(),
	};
});

// validateAccess is the per-action gate; the suite drives access by resolving (grant)
// or rejecting (deny) so the update/delete/share flags are deterministic.
const validateAccess = vi.fn();

vi.mock('../permissions/modules/validate-access/validate-access.js', () => {
	return {
		validateAccess: (...args: unknown[]) => validateAccess(...args),
	};
});

// The singleton update-fields enrichment (post-line-172) hits these; stub them so the
// branch runs without a real policy/permission DB chain.
vi.mock('../permissions/lib/fetch-policies.js', () => {
	return { fetchPolicies: vi.fn().mockResolvedValue([]) };
});

vi.mock('../permissions/lib/fetch-permissions.js', () => {
	return { fetchPermissions: vi.fn().mockResolvedValue([]) };
});

const { PermissionsService } = await import('./permissions.js');

const plainSchema = new SchemaBuilder()
	.collection('articles', (c) => {
		c.field('id').id();
		c.field('title').string();
	})
	.build();

const singletonSchema = new SchemaBuilder()
	.collection('settings', (c) => {
		c.field('id').id();
		c.field('title').string();
	})
	.build();

singletonSchema.collections['settings']!.singleton = true;

const nonAdmin: Accountability = {
	user: 'u',
	role: null,
	roles: [],
	admin: false,
	app: true,
	ip: null,
};

// Extract the `action` each validateAccess call was made with, sorted for stable assertion.
function actionsFromCalls(): string[] {
	return validateAccess.mock.calls
		.map(([opts]) => (opts as { action: string }).action)
		.sort();
}

describe('PermissionsService.getItemPermissions', () => {
	let db: MockedFunction<Knex>;
	let tracker: Tracker;

	beforeAll(() => {
		db = vi.mocked(knex.default({ client: MockClient }));
		tracker = createTracker(db);
	});

	beforeEach(() => {
		validateAccess.mockReset();
	});

	afterEach(() => {
		tracker.reset();
	});

	function service(accountability: Accountability | null, schema = plainSchema) {
		return new PermissionsService({ knex: db, schema, accountability });
	}

	// Lines 96/98: unauthenticated callers are rejected before any permission lookup.
	it('throws ForbiddenError when accountability is null', async () => {
		await expect(service(null).getItemPermissions('articles')).rejects.toBeInstanceOf(
			ForbiddenError,
		);
	});

	it('throws ForbiddenError when accountability has no user', async () => {
		const noUser = { ...nonAdmin, user: null } as Accountability;

		await expect(service(noUser).getItemPermissions('articles')).rejects.toBeInstanceOf(
			ForbiddenError,
		);
	});

	// Admin short-circuit returns blanket access without touching validateAccess.
	it('returns blanket access for admins', async () => {
		const admin = { ...nonAdmin, admin: true } as Accountability;
		const result = await service(admin).getItemPermissions('articles');

		expect(result).toEqual({
			update: { access: true },
			delete: { access: true },
			share: { access: true },
		});

		expect(validateAccess).not.toHaveBeenCalled();
	});

	// Lines 145-147 (checkAction ternary): a non-singleton collection keeps updateAction
	// = 'update', so the update branch passes 'update' through, not 'create'.
	it('checks the update action with checkAction="update" for a non-singleton collection', async () => {
		validateAccess.mockResolvedValue(undefined);

		await service(nonAdmin).getItemPermissions('articles');

		expect(actionsFromCalls()).toEqual(['delete', 'share', 'update']);
	});

	// Lines 132-136: singleton WITH a row keeps updateAction = 'update'.
	it('keeps updateAction="update" when the singleton already has a row', async () => {
		validateAccess.mockResolvedValue(undefined);
		tracker.on.select('settings').response([{ id: 1 }]);

		await service(nonAdmin, singletonSchema).getItemPermissions('settings');

		expect(actionsFromCalls()).toEqual(['delete', 'share', 'update']);
	});

	// Lines 132-135 (the !result[0] branch): an empty singleton flips updateAction to
	// 'create', which the ternary then forwards as checkAction for the update key.
	it('flips updateAction to "create" when the singleton has no row', async () => {
		validateAccess.mockResolvedValue(undefined);
		tracker.on.select('settings').response([]);

		await service(nonAdmin, singletonSchema).getItemPermissions('settings');

		// 'update' became 'create'; 'delete'/'share' pass through unchanged.
		expect(actionsFromCalls()).toEqual(['create', 'delete', 'share']);
	});

	// Lines 136-138 (catch): a failing singleton read also flips updateAction to 'create'.
	it('flips updateAction to "create" when the singleton read throws', async () => {
		validateAccess.mockResolvedValue(undefined);
		tracker.on.select('settings').simulateError('boom');

		await service(nonAdmin, singletonSchema).getItemPermissions('settings');

		expect(actionsFromCalls()).toEqual(['create', 'delete', 'share']);
	});

	// A denied action leaves its access flag false; a granted one flips it true.
	it('reflects per-action grant/deny from validateAccess', async () => {
		validateAccess.mockImplementation(async (opts: { action: string }) => {
			if (opts.action === 'delete') {
				throw new ForbiddenError({ reason: 'no' });
			}
		});

		const result = await service(nonAdmin).getItemPermissions('articles');

		expect(result.update.access).toBe(true);
		expect(result.delete.access).toBe(false);
		expect(result.share.access).toBe(true);
	});
});
