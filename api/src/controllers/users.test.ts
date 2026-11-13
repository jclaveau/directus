import { InvalidQueryError } from '@directus/errors';
import { oneLine } from '@directus/utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const updateOne = vi.fn();
const readOne = vi.fn();

vi.mock('../services/users.js', () => {
	return {
		UsersService: vi.fn(function () {
			return { updateOne, readOne };
		}),
	};
});

vi.mock('../services/authentication.js', () => ({ AuthenticationService: vi.fn() }));
vi.mock('../services/meta.js', () => ({ MetaService: vi.fn() }));
vi.mock('../services/tfa.js', () => ({ TFAService: vi.fn() }));
vi.mock('../middleware/respond.js', () => ({ respond: vi.fn() }));

vi.mock('../middleware/rate-limiter-registration.js', () => {
	return { default: vi.fn() };
});

const scopedCachePurgeEnabled = vi.fn();

vi.mock('../scoped-cache/index.js', () => {
	return { scopedCachePurgeEnabled: () => scopedCachePurgeEnabled() };
});

const { default: router } = await import('./users.js');

async function trackPage() {
	const next = vi.fn();

	// router.patch('/me/track/page', asyncHandler(fn), respond) registers one Route
	// layer whose own stack holds [handler, respond]; drive the bare handler here.
	const layer = router.stack.find((l: any) => l.route?.path === '/me/track/page');

	await layer!.route!.stack[0]!.handle(
		{
			accountability: { user: 'u-1' },
			schema: {},
			body: { last_page: '/content/articles' },
		} as any,
		{ locals: {} } as any,
		next,
	);

	return { next };
}

describe('users controller /me/track/page', () => {
	beforeEach(() => vi.clearAllMocks());

	test(oneLine`
		lets the scoped purge hear the write, so /users/me follows — the user's own
		slices only, the bare pin any session could drain at the limiter's rate stays
	`, async () => {
		scopedCachePurgeEnabled.mockReturnValue(true);

		const { next } = await trackPage();

		expect(updateOne).toHaveBeenCalledWith(
			'u-1',
			{ last_page: '/content/articles' },
			{ autoPurgeCache: true, purgeBareFingerprint: false },
		);

		expect(next).toHaveBeenCalledWith();
	});

	test(oneLine`
		keeps the cache silent in full mode, where the purge is a flush
	`, async () => {
		scopedCachePurgeEnabled.mockReturnValue(false);

		const { next } = await trackPage();

		expect(updateOne).toHaveBeenCalledWith(
			'u-1',
			{ last_page: '/content/articles' },
			{ autoPurgeCache: false, purgeBareFingerprint: false },
		);

		expect(next).toHaveBeenCalledWith();
	});
});

describe('users controller PATCH /:pk', () => {
	beforeEach(() => vi.clearAllMocks());

	test('passes mutationBatching to the update', async () => {
		updateOne.mockResolvedValueOnce('u-2');
		readOne.mockResolvedValueOnce({ id: 'u-2' });

		await router.stack.find((l: any) => {
			return l.route?.path === '/:pk' && l.route.methods.patch;
		})!.route!.stack[0]!.handle(
			{
				accountability: null,
				schema: {},
				params: { pk: 'u-2' },
				query: { mutationBatching: 'preserveMutationOrder' },
				body: { first_name: 'Ada' },
				sanitizedQuery: {},
			} as any,
			{ locals: {} } as any,
			vi.fn(),
		);

		expect(updateOne).toHaveBeenCalledWith(
			'u-2',
			{ first_name: 'Ada' },
			{ mutationBatching: 'preserveMutationOrder' },
		);
	});

	test('refuses an unknown mutationBatching before updating', async () => {
		const next = vi.fn();

		await router.stack.find((l: any) => {
			return l.route?.path === '/:pk' && l.route.methods.patch;
		})!.route!.stack[0]!.handle(
			{
				accountability: null,
				schema: {},
				params: { pk: 'u-2' },
				query: { mutationBatching: 'batchEverything' },
				body: { first_name: 'Ada' },
				sanitizedQuery: {},
			} as any,
			{ locals: {} } as any,
			next,
		);

		expect(next).toHaveBeenCalledWith(new InvalidQueryError({
			reason: '"mutationBatching" must be one of minimizeMutations, '
				+ 'preserveMutationOrder, disableBatching',
		}));

		expect(updateOne).not.toHaveBeenCalled();
	});
});
