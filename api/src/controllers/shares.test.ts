import { beforeEach, describe, expect, test, vi } from 'vitest';

const createMany = vi.fn();
const updateBatch = vi.fn();
const readMany = vi.fn();
const login = vi.fn();

vi.mock('../services/shares.js', () => {
	return {
		SharesService: vi.fn(function () {
			return { createMany, updateBatch, readMany, login };
		}),
	};
});

vi.mock('../services/meta.js', () => ({ MetaService: vi.fn() }));
vi.mock('../middleware/respond.js', () => ({ respond: vi.fn() }));

const { default: router } = await import('./shares.js');
const { REFRESH_COOKIE_OPTIONS } = await import('../constants.js');

describe('shares controller', () => {
	beforeEach(() => vi.clearAllMocks());

	test('passes mutationBatching to the batch create', async () => {
		createMany.mockResolvedValue([1, 2]);
		readMany.mockResolvedValue([]);

		await router.stack.findLast(
			(l: any) => l.route?.path === '/' && l.route.methods['post'],
		)!.route!.stack[0]!.handle(
			{
				accountability: null,
				schema: {},
				body: [{ name: 'a' }, { name: 'b' }],
				query: { mutationBatching: 'disableBatching' },
				sanitizedQuery: {},
			} as any,
			{ locals: {} } as any,
			vi.fn(),
		);

		expect(createMany).toHaveBeenCalledWith(
			[{ name: 'a' }, { name: 'b' }],
			{ mutationBatching: 'disableBatching' },
		);
	});

	test('passes mutationBatching to the batch update', async () => {
		updateBatch.mockResolvedValue([1, 2]);
		readMany.mockResolvedValue([]);

		await router.stack.find(
			(l: any) => l.route?.path === '/' && l.route.methods['patch'],
		)!.route!.stack[1]!.handle(
			{
				accountability: null,
				schema: {},
				body: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
				query: { mutationBatching: 'disableBatching' },
				sanitizedQuery: {},
			} as any,
			{ locals: {} } as any,
			vi.fn(),
		);

		expect(updateBatch).toHaveBeenCalledWith(
			[{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
			{ mutationBatching: 'disableBatching' },
		);
	});

	test('sets the refresh cookie of a cookie-mode share login', async () => {
		login.mockResolvedValue({
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
			expires: 900_000,
		});

		const cookie = vi.fn();
		const locals = {};

		// as any: request and response stubs carry only what the handler reads
		await router.stack.find(
			(l: any) => l.route?.path === '/auth' && l.route.methods['post'],
		)!.route!.stack[0]!.handle(
			{
				schema: {},
				body: { share: 'share-id', mode: 'cookie' },
			} as any,
			{ cookie, locals } as any,
			vi.fn(),
		);

		expect(cookie).toHaveBeenCalledWith(
			'directus_refresh_token',
			'refresh-token',
			REFRESH_COOKIE_OPTIONS,
		);

		expect(locals).toEqual({
			payload: {
				data: {
					expires: 900_000,
					access_token: 'access-token',
				},
			},
		});
	});
});
