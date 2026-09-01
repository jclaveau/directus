import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnv, holding } = vi.hoisted(() => {
	return {
		mockEnv: {} as Record<string, any>,
		holding: { value: [] as string[] | undefined },
	};
});

vi.mock('@directus/env', () => {
	return { useEnv: () => mockEnv };
});

vi.mock('directus/version', () => {
	return { version: '11.10.1' };
});

vi.mock('../logger/index.js', () => {
	return {
		useLogger: () => {
			return { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
		},
	};
});

vi.mock('../cache.js', () => {
	return {
		getCache: () => {
			return { cache: null };
		},
	};
});

vi.mock('../database/index.js', () => {
	return {
		default: () => {
			return { client: { pool: { numFree: () => 1, numUsed: () => 0 } } };
		},
		hasDatabaseConnection: async () => true,
	};
});

vi.mock('../mailer.js', () => {
	return {
		default: () => {
			return { verify: vi.fn() };
		},
	};
});

vi.mock('../middleware/rate-limiter-global.js', () => {
	return { rateLimiterGlobal: {} };
});

vi.mock('../middleware/rate-limiter-ip.js', () => {
	return { rateLimiter: {} };
});

vi.mock('../storage/index.js', () => {
	return {
		getStorage: async () => {
			return {
				location: () => {
					return {
						write: async () => undefined,
						read: async () => Readable.from(['check']),
						delete: async () => undefined,
					};
				},
			};
		},
	};
});

vi.mock('../server.js', () => {
	return { SERVER_ONLINE: true };
});

vi.mock('./settings.js', () => {
	return { SettingsService: class {} };
});

vi.mock('../outstanding-migrations.js', () => {
	return { outstandingMigrationsHoldingHealth: () => holding.value };
});

async function healthOf(accountability: { admin: boolean } | null) {
	vi.resetModules();
	const { ServerService } = await import('./server.js');

	return await new ServerService({
		accountability: accountability as any,
		schema: { collections: {}, relations: [] } as any,
	}).health();
}

describe('ServerService health', () => {
	beforeEach(() => {
		mockEnv['DB_CLIENT'] = 'pg';
		mockEnv['CACHE_ENABLED'] = false;
		mockEnv['RATE_LIMITER_ENABLED'] = false;
		mockEnv['RATE_LIMITER_GLOBAL_ENABLED'] = false;
		mockEnv['STORAGE_LOCATIONS'] = '';
		mockEnv['EMAIL_TRANSPORT'] = 'sendmail';
		mockEnv['PUBLIC_URL'] = 'http://localhost:8055';
		holding.value = [];
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('reports no migrations problem when nothing is outstanding', async () => {
		const data = await healthOf({ admin: true });

		expect(data['status']).not.toBe('error');
		expect(data['checks']['migrations']).toBeUndefined();
	});

	it('reports error while a migration is outstanding', async () => {
		holding.value = ['20990101A'];

		const data = await healthOf({ admin: true });

		expect(data['status']).toBe('error');
	});

	it('names the outstanding migrations to an admin', async () => {
		holding.value = ['20990101A', '20990102A'];

		const data = await healthOf({ admin: true });

		expect(data['checks']['migrations']).toEqual([
			{
				componentType: 'datastore',
				status: 'error',
				observedValue: '20990101A, 20990102A',
				output: 'Database migrations have not all been run',
			},
		]);
	});

	it('reports error while the reading is still unknown', async () => {
		holding.value = undefined;

		const data = await healthOf({ admin: true });

		expect(data['status']).toBe('error');
		expect(data['checks']['migrations'][0].observedValue).toBe('unknown');
	});

	it('tells a non-admin only the status', async () => {
		holding.value = ['20990101A'];

		expect(await healthOf(null)).toEqual({ status: 'error' });
	});
});
