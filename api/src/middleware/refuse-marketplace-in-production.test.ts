import type { Request, Response } from 'express';
import { afterEach, expect, test, vi } from 'vitest';
import {
	isMarketplaceEnabled,
	refuseMarketplaceInProduction,
} from './refuse-marketplace-in-production.js';

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
	} as Request;

	expect(() => refuseMarketplaceInProduction(req, {} as Response, next))
		.toThrow("Route /extensions/registry/install doesn't exist.");

	expect(next).not.toHaveBeenCalled();
});

test('passes a registry route outside production', () => {
	vi.stubEnv('NODE_ENV', 'development');
	const next = vi.fn();

	refuseMarketplaceInProduction(
		{ baseUrl: '/extensions/registry', path: '/install' } as Request,
		{} as Response,
		next,
	);

	expect(next).toHaveBeenCalledExactlyOnceWith();
});
