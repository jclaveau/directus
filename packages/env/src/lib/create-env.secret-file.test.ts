import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import {
	readConfigurationFromProcess,
} from '../utils/read-configuration-from-process.js';
import { createEnv } from './create-env.js';
import { readConfigurationFromFile } from './read-configuration-from-file.js';

vi.mock('../utils/get-config-path.js');
vi.mock('../utils/read-configuration-from-process.js');
vi.mock('./read-configuration-from-file.js');
vi.mock('node:fs');

afterEach(() => {
	vi.resetAllMocks();
});

test('reads a variable core declares off its _FILE', () => {
	vi.mocked(readConfigurationFromFile).mockReturnValue(null);
	vi.mocked(readConfigurationFromProcess).mockReturnValue({ KEY_FILE: './key' });
	vi.mocked(readFileSync).mockReturnValue('key-from-file');

	const env = createEnv();

	expect(env).toMatchObject({ KEY: 'key-from-file' });
	expect(env).not.toHaveProperty('KEY_FILE');
});

test('keeps the _FILE of a variable core does not declare as set', () => {
	vi.mocked(readConfigurationFromFile).mockReturnValue(null);
	vi.mocked(readConfigurationFromProcess).mockReturnValue({ KEYS_FILE: './key' });

	const env = createEnv();

	expect(readFileSync).not.toHaveBeenCalled();
	expect(env).toMatchObject({ KEYS_FILE: './key' });
	expect(env).not.toHaveProperty('KEYS');
});
