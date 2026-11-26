import { describe, expect, test, vi } from 'vitest';

const { mockEnv } = vi.hoisted(() => {
	return { mockEnv: {} as Record<string, unknown> };
});

vi.mock('@directus/env', () => ({ useEnv: () => mockEnv }));

vi.mock('./bus/index.js', () => {
	return { useBus: () => ({ subscribe: vi.fn(), publish: vi.fn() }) };
});

vi.mock('./database/index.js', () => ({ default: vi.fn() }));
vi.mock('./services/index.js', () => ({}));

describe('the variables a flow reads as $env', () => {
	test('are the ones FLOWS_ENV_ALLOW_LIST names', async () => {
		mockEnv['FLOWS_ENV_ALLOW_LIST'] = ['PUBLIC_URL'];
		mockEnv['PUBLIC_URL'] = 'http://localhost:8055';
		mockEnv['SECRET'] = 'hidden';
		vi.resetModules();
		const { getFlowManager } = await import('./flows.js');

		expect((getFlowManager() as any).envs).toEqual({
			PUBLIC_URL: 'http://localhost:8055',
		});
	});

	test('are none with FLOWS_ENV_ALLOW_LIST unset', async () => {
		delete mockEnv['FLOWS_ENV_ALLOW_LIST'];
		vi.resetModules();
		const { getFlowManager } = await import('./flows.js');

		expect((getFlowManager() as any).envs).toEqual({});
	});
});
