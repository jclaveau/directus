import { afterEach, describe, expect, test, vi } from 'vitest';
// eslint-disable-next-line max-len
import { fetchAccountabilityCollectionAccess } from '../permissions/modules/fetch-accountability-collection-access/fetch-accountability-collection-access.js';

vi.mock('../database/index.js', () => {
	return { default: vi.fn(() => 'database-handle') };
});

vi.mock(
	// eslint-disable-next-line max-len
	'../permissions/modules/fetch-accountability-collection-access/fetch-accountability-collection-access.js',
	() => ({ fetchAccountabilityCollectionAccess: vi.fn() }),
);

vi.mock('../services/permissions.js', () => ({ PermissionsService: vi.fn() }));
vi.mock('../services/meta.js', () => ({ MetaService: vi.fn() }));
vi.mock('../middleware/respond.js', () => ({ respond: vi.fn() }));

const { default: router } = await import('./permissions.js');

afterEach(() => {
	vi.resetAllMocks();
});

describe('permissions controller GET /me', () => {
	test('refuses a request with no user, no member roles and no share', async () => {
		const next = vi.fn();

		await router.stack.find(
			(l: any) => l.route?.path === '/me' && l.route.methods['get'],
		)!.route!.stack[0]!.handle(
			{ accountability: { user: null, memberRoles: [] }, schema: {} } as any,
			{ locals: {} } as any,
			next,
		);

		expect(next.mock.calls[0]![0].message).toBe(
			`Can't access /me without being logged in`,
		);

		expect(fetchAccountabilityCollectionAccess).not.toHaveBeenCalled();
	});

	test('answers a request that only has member roles', async () => {
		const next = vi.fn();

		vi.mocked(fetchAccountabilityCollectionAccess).mockResolvedValue(
			{ articles: {} } as any,
		);

		const res = { locals: {} as Record<string, unknown> };

		await router.stack.find(
			(l: any) => l.route?.path === '/me' && l.route.methods['get'],
		)!.route!.stack[0]!.handle(
			{
				accountability: { user: null, memberRoles: ['role-1'] },
				schema: { collections: {} },
			} as any,
			res as any,
			next,
		);

		expect(res.locals['payload']).toEqual({ data: { articles: {} } });
		expect(next).toHaveBeenCalledWith();
	});
});
