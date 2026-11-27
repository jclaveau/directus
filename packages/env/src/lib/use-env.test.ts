import { _cache, useEnv, useEnvVarRawValues } from './use-env.js';
import { test, expect, vi, afterEach } from 'vitest';
import { createEnv, readEnvVarRawValues } from './create-env.js';

vi.mock('./create-env.js');

afterEach(() => {
	vi.resetAllMocks();

	_cache.env = undefined;
});

test('Returns cached env if exists', () => {
	_cache.env = {};

	const env = useEnv();

	expect(env).toBe(_cache.env);
});

test('Creates new cached env if not exists', () => {
	const mockEnv = {};
	vi.mocked(createEnv, { partial: true }).mockReturnValue(mockEnv);

	const env = useEnv();

	expect(env).toBe(mockEnv);
	expect(_cache.env).toBe(mockEnv);
});

test('Reads the raw values off the cached env', () => {
	vi.mocked(createEnv, { partial: true }).mockReturnValue({});
	vi.mocked(readEnvVarRawValues).mockReturnValue({ DB_PORT: '5432' });

	expect(useEnvVarRawValues()).toEqual({ DB_PORT: '5432' });
	expect(createEnv).toHaveBeenCalledTimes(1);
});
