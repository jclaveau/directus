import { useEnv } from '@directus/env';
import { ForbiddenError } from '@directus/errors';
import type { Request } from 'express';
import { beforeEach, expect, test, vi } from 'vitest';
import { handler } from './impersonation.js';

vi.mock('@directus/env');

const next = vi.fn();

function request(method: string, path: string, impersonator?: string): Request {
	return {
		method,
		path,
		accountability: { user: 'jane', impersonator },
	} as unknown as Request;
}

beforeEach(() => {
	vi.mocked(useEnv).mockReturnValue({ IMPERSONATION_WRITES: false });
	next.mockReset();
});

test('a request with no impersonator passes whatever it does', () => {
	handler(request('DELETE', '/items/articles/1'), {} as never, next);

	expect(next).toHaveBeenCalledOnce();
});

test.each([
	['GET', '/items/articles'],
	['HEAD', '/items/articles'],
	['OPTIONS', '/items/articles'],
	['SEARCH', '/items/articles'],
	['POST', '/auth/impersonate'],
	['DELETE', '/auth/impersonate'],
	['POST', '/auth/logout'],
	['POST', '/auth/refresh'],
	['PATCH', '/users/me/track/page'],
	['POST', '/graphql'],
	['POST', '/graphql/system'],
	['POST', '/auth/logout/'],
	['POST', '/Auth/Refresh'],
])('lets an impersonated %s %s through', (method, path) => {
	handler(request(method, path, 'admin'), {} as never, next);

	expect(next).toHaveBeenCalledOnce();
});

test.each([
	['POST', '/items/articles'],
	['PATCH', '/items/articles/1'],
	['DELETE', '/items/articles/1'],
	['PATCH', '/users/me'],
	['POST', '/files'],
	['POST', '/utils/cache/clear'],
])('refuses an impersonated %s %s while writes are off', (method, path) => {
	expect(() => {
		handler(request(method, path, 'admin'), {} as never, next);
	}).toThrow(
		expect.objectContaining({ extensions: { reason: 'impersonation_read_only' } }),
	);

	expect(next).not.toHaveBeenCalled();
});

test('lets writes through once IMPERSONATION_WRITES is on', () => {
	vi.mocked(useEnv).mockReturnValue({ IMPERSONATION_WRITES: true });

	handler(request('PATCH', '/items/articles/1', 'admin'), {} as never, next);

	expect(next).toHaveBeenCalledOnce();
});

test.each([
	['POST', '/users/me/tfa/enable'],
	['POST', '/users/me/tfa/disable'],
	['POST', '/users/me/tfa/generate'],
	['POST', '/auth/password/request'],
	['POST', '/auth/password/reset'],
	['POST', '/users/invite'],
	['POST', '/users/register'],
	// Express routes these to the same handlers
	['POST', '/Users/Me/TFA/generate'],
	['POST', '/users/me/tfa/generate/'],
	['POST', '/users/invite/'],
])('refuses %s %s with writes on: credentials are never theirs', (method, path) => {
	vi.mocked(useEnv).mockReturnValue({ IMPERSONATION_WRITES: true });

	expect(() => {
		handler(request(method, path, 'admin'), {} as never, next);
	}).toThrow(ForbiddenError);

	expect(() => {
		handler(request(method, path, 'admin'), {} as never, next);
	}).toThrow(
		expect.objectContaining({ extensions: { reason: 'impersonation_credentials' } }),
	);

	expect(next).not.toHaveBeenCalled();
});
