import { ForbiddenError, MethodNotAllowedError } from '@directus/errors';
import { beforeEach, expect, test, vi } from 'vitest';

const env = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock('@directus/env', () => ({ useEnv: () => env }));

const { parseGraphQL } = await import('./graphql.js');

const next = vi.fn();

function run(req: Record<string, unknown>) {
	const res = { locals: {} as Record<string, unknown> };
	return parseGraphQL(req as never, res as never, next).then(() => res);
}

beforeEach(() => {
	next.mockReset();
	delete env['IMPERSONATION_WRITES'];
});

test('a query is parsed and passed on', async () => {
	const res = await run({
		method: 'POST',
		body: { query: '{ articles { id } }' },
		accountability: { user: 'jane', impersonator: 'admin' },
	});

	expect(next).toHaveBeenCalledWith();

	expect(res.locals['graphqlParams'])
		.toMatchObject({ query: '{ articles { id } }' });

	expect(res.locals['cache']).toBeUndefined();
});

test('a mutation over GET is refused', async () => {
	await run({
		method: 'GET',
		query: { query: 'mutation { delete_articles_item(id: 1) { id } }' },
		accountability: { user: 'jane' },
	});

	expect(next.mock.calls[0]![0]).toBeInstanceOf(MethodNotAllowedError);
});

test('a mutation under impersonation is read-only', async () => {
	await run({
		method: 'POST',
		body: { query: 'mutation { delete_articles_item(id: 1) { id } }' },
		accountability: { user: 'jane', impersonator: 'admin' },
	});

	const error = next.mock.calls[0]![0];
	expect(error).toBeInstanceOf(ForbiddenError);
	expect(error.extensions.reason).toBe('impersonation_read_only');
});

test('a mutation under impersonation runs once writes are on', async () => {
	env['IMPERSONATION_WRITES'] = true;

	const res = await run({
		method: 'POST',
		body: { query: 'mutation { delete_articles_item(id: 1) { id } }' },
		accountability: { user: 'jane', impersonator: 'admin' },
	});

	expect(next).toHaveBeenCalledWith();
	expect(res.locals['cache']).toBe(false);
});
