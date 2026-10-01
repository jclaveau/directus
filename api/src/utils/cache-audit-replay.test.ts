import type { Request } from 'express';
import { describe, expect, test, vi } from 'vitest';
import {
	CACHE_AUDIT_REPLAY_HEADER,
	cacheAuditReplayToken,
	isCacheAuditReplay,
} from './cache-audit-replay.js';
import { getSecret } from './get-secret.js';

vi.mock('./get-secret.js', () => ({ getSecret: vi.fn(() => 'secret-a') }));

function request(headers: Record<string, string>): Request {
	return {
		get: (name: string) => headers[name.toLowerCase()],
	} as unknown as Request;
}

describe('the replay token', () => {
	test('is one hex digest per SECRET, the same on every process sharing it', () => {
		const token = cacheAuditReplayToken();

		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(cacheAuditReplayToken()).toBe(token);

		vi.mocked(getSecret).mockReturnValueOnce('secret-b');

		expect(cacheAuditReplayToken()).not.toBe(token);
	});

	test('is not the SECRET itself', () => {
		expect(cacheAuditReplayToken()).not.toContain('secret-a');
	});
});

describe('recognising a replay', () => {
	test('by the header carrying this SECRET\'s token', () => {
		const req = request({
			[CACHE_AUDIT_REPLAY_HEADER]: cacheAuditReplayToken(),
		});

		expect(isCacheAuditReplay(req)).toBe(true);
	});

	test.each([
		['no header', {}],
		['an empty header', { [CACHE_AUDIT_REPLAY_HEADER]: '' }],
		['a token of another length', { [CACHE_AUDIT_REPLAY_HEADER]: 'abc' }],
		[
			'a token of the right length for another SECRET',
			{ [CACHE_AUDIT_REPLAY_HEADER]: 'f'.repeat(64) },
		],
	])('not with %s', (_case, headers) => {
		expect(isCacheAuditReplay(request(headers))).toBe(false);
	});
});
