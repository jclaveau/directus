import { handlePressure } from '@directus/pressure';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
	CACHE_AUDIT_REPLAY_HEADER,
	cacheAuditReplayToken,
} from '../utils/cache-audit-replay.js';
import { shedUnderPressure } from './shed-under-pressure.js';

vi.mock('@directus/pressure', () => ({ handlePressure: vi.fn() }));
vi.mock('../utils/get-secret.js', () => ({ getSecret: () => 'secret' }));

const overloaded = new Error('Under pressure');

const shed = vi.fn((_req: Request, _res: Response, next: NextFunction) => {
	next(overloaded);
});

function request(headers: Record<string, string>): Request {
	return {
		get: (name: string) => headers[name.toLowerCase()],
	} as unknown as Request;
}

beforeEach(() => {
	shed.mockClear();

	vi.mocked(handlePressure)
		.mockReset()
		.mockReturnValue(shed);
});

describe('shedding under pressure', () => {
	test('builds the limiter once, from the options it is given', () => {
		const options = { maxEventLoopDelay: 500 };

		shedUnderPressure(options);

		expect(handlePressure).toHaveBeenCalledExactlyOnceWith(options);
	});

	test('sheds a request of anyone else', () => {
		const next = vi.fn();
		const res = {} as Response;
		const req = request({});

		shedUnderPressure({})(req, res, next);

		expect(shed).toHaveBeenCalledExactlyOnceWith(req, res, next);
		expect(next).toHaveBeenCalledExactlyOnceWith(overloaded);
	});

	test('lets the cache audit\'s replay through untouched', () => {
		const next = vi.fn();

		shedUnderPressure({})(
			request({ [CACHE_AUDIT_REPLAY_HEADER]: cacheAuditReplayToken() }),
			{} as Response,
			next,
		);

		expect(shed).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalledExactlyOnceWith();
	});

	test('sheds a replay marked with another SECRET\'s token', () => {
		const next = vi.fn();

		shedUnderPressure({})(
			request({ [CACHE_AUDIT_REPLAY_HEADER]: 'f'.repeat(64) }),
			{} as Response,
			next,
		);

		expect(shed).toHaveBeenCalledOnce();
		expect(next).toHaveBeenCalledExactlyOnceWith(overloaded);
	});
});
