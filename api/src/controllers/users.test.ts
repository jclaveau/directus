import { InvalidCredentialsError, InvalidPayloadError } from '@directus/errors';
import { beforeEach, expect, test, vi } from 'vitest';

const users = vi.hoisted(() => ({ updateOne: vi.fn() }));

vi.mock('../services/users.js', () => {
	return {
		UsersService: class {
			updateOne = users.updateOne;
		},
	};
});

vi.mock('../services/authentication.js', () => {
	return { AuthenticationService: class {} };
});

vi.mock('../services/meta.js', () => ({ MetaService: class {} }));
vi.mock('../services/tfa.js', () => ({ TFAService: class {} }));
vi.mock('../middleware/rate-limiter-registration.js', () => ({ default: vi.fn() }));
vi.mock('../middleware/respond.js', () => ({ respond: vi.fn() }));
vi.mock('../middleware/use-collection.js', () => ({ default: () => vi.fn() }));
vi.mock('../middleware/validate-batch.js', () => ({ validateBatch: () => vi.fn() }));
vi.mock('../utils/sanitize-query.js', () => ({ sanitizeQuery: vi.fn() }));

const { default: router } = await import('./users.js');

// router.patch(path, asyncHandler(fn), respond): the Route layer's own stack
// holds [handler, respond]; drive the bare handler.
const trackPage = router.stack.find((entry: any) => {
	return entry.route?.path === '/me/track/page'
		&& entry.route.stack.some((handler: any) => handler.method === 'patch');
})!.route!.stack[0]!.handle as (req: any, res: any, next: any) => Promise<void>;

const next = vi.fn();

beforeEach(() => {
	next.mockReset();
	users.updateOne.mockReset();
});

test('tracks the page on the user', async () => {
	await trackPage(
		{
			accountability: { user: 'jane' },
			body: { last_page: '/content' },
			schema: {},
		},
		{},
		next,
	);

	expect(users.updateOne).toHaveBeenCalledWith(
		'jane',
		{ last_page: '/content' },
		{ autoPurgeCache: false },
	);

	expect(next).toHaveBeenCalledWith();
});

test("under impersonation the target's last page stays theirs", async () => {
	await trackPage(
		{
			accountability: { user: 'jane', impersonator: 'admin' },
			body: { last_page: '/content' },
			schema: {},
		},
		{},
		next,
	);

	expect(users.updateOne).not.toHaveBeenCalled();
	expect(next).toHaveBeenCalledWith();
});

test.each([
	[
		'no user',
		{ accountability: {}, body: { last_page: '/x' } },
		InvalidCredentialsError,
	],
	['no page', { accountability: { user: 'jane' }, body: {} }, InvalidPayloadError],
])('refuses %s', async (_, req, error) => {
	await trackPage(req, {}, next);

	expect(next.mock.calls[0]![0]).toBeInstanceOf(error);
	expect(users.updateOne).not.toHaveBeenCalled();
});
