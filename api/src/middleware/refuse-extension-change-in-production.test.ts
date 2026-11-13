import { RouteNotFoundError } from '@directus/errors';
import type { Request, Response } from 'express';
import { afterEach, expect, test, vi } from 'vitest';
import {
	isMarketplaceEnabled,
	refuseExtensionChangeInProduction,
} from './refuse-extension-change-in-production.js';

afterEach(() => {
	vi.unstubAllEnvs();
});

test.each([
	{ nodeEnv: 'production', enabled: false },
	{ nodeEnv: '', enabled: false },
	{ nodeEnv: 'development', enabled: true },
	{ nodeEnv: 'test', enabled: true },
])('reads NODE_ENV $nodeEnv as enabled: $enabled', ({ nodeEnv, enabled }) => {
	vi.stubEnv('NODE_ENV', nodeEnv);

	expect(isMarketplaceEnabled()).toBe(enabled);
});

test('refuses a registry route in production', () => {
	vi.stubEnv('NODE_ENV', 'production');
	const next = vi.fn();

	const req = {
		baseUrl: '/extensions/registry',
		path: '/install',
		originalUrl: '/extensions/registry/install',
	} as Request;

	expect(() => refuseExtensionChangeInProduction(req, {} as Response, next))
		.toThrow(new RouteNotFoundError({ path: '/extensions/registry/install' }));

	expect(next).not.toHaveBeenCalled();
});

// The bare registry path reaches the gate as `path: '/'`: the 404 names the path
// the client asked for, without the query.
test('names the bare registry path the client asked for', () => {
	vi.stubEnv('NODE_ENV', 'production');

	const req = {
		baseUrl: '/extensions/registry',
		path: '/',
		originalUrl: '/extensions/registry?search=a',
	} as Request;

	expect(() => refuseExtensionChangeInProduction(req, {} as Response, vi.fn()))
		.toThrow(new RouteNotFoundError({ path: '/extensions/registry' }));
});

test('passes a registry route outside production', () => {
	vi.stubEnv('NODE_ENV', 'development');
	const next = vi.fn();

	refuseExtensionChangeInProduction(
		{
			baseUrl: '/extensions/registry',
			path: '/install',
			originalUrl: '/extensions/registry/install',
		} as Request,
		{} as Response,
		next,
	);

	expect(next).toHaveBeenCalledExactlyOnceWith();
});
