import { useEnv } from '@directus/env';
import { RouteNotFoundError } from '@directus/errors';
import type { Request, Response } from 'express';
import { beforeEach, expect, test, vi } from 'vitest';
import {
	isMarketplaceEnabled,
	refuseExtensionChangeInProduction,
} from './refuse-extension-change-in-production.js';

vi.mock('@directus/env');

beforeEach(() => {
	vi.mocked(useEnv).mockReturnValue({ MARKETPLACE_ENABLED: false });
});

test.each([
	{ marketplaceEnabled: false, enabled: false },
	{ marketplaceEnabled: true, enabled: true },
])(
	'reads MARKETPLACE_ENABLED $marketplaceEnabled as enabled: $enabled',
	({ marketplaceEnabled, enabled }) => {
		vi.mocked(useEnv).mockReturnValue({
			MARKETPLACE_ENABLED: marketplaceEnabled,
		});

		expect(isMarketplaceEnabled()).toBe(enabled);
	},
);

test('refuses a registry route when MARKETPLACE_ENABLED is false', () => {
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
	const req = {
		baseUrl: '/extensions/registry',
		path: '/',
		originalUrl: '/extensions/registry?search=a',
	} as Request;

	expect(() => refuseExtensionChangeInProduction(req, {} as Response, vi.fn()))
		.toThrow(new RouteNotFoundError({ path: '/extensions/registry' }));
});

test('passes a registry route when MARKETPLACE_ENABLED is true', () => {
	vi.mocked(useEnv).mockReturnValue({ MARKETPLACE_ENABLED: true });
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
