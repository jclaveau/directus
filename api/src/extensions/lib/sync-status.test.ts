import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const envRef = vi.hoisted(() => {
	return {
		current: {} as Record<string, unknown>,
	};
});

vi.mock('@directus/env', () => ({ useEnv: () => envRef.current }));

import { getSyncStatus, setSyncStatus, SyncStatus } from './sync-status.js';

let tempPath: string;

beforeEach(async () => {
	tempPath = await mkdtemp(join(tmpdir(), 'sync-status-'));
	await mkdir(join(tempPath, 'extensions'));

	envRef.current = {
		EXTENSIONS_LOCATION: 'remote',
		TEMP_PATH: tempPath,
	};
});

afterEach(async () => {
	await rm(tempPath, { recursive: true, force: true });
});

test('answers UNKNOWN before any sync wrote a status', async () => {
	expect(await getSyncStatus()).toBe(SyncStatus.UNKNOWN);
});

test('writes the status in the registry root and reads it back', async () => {
	await setSyncStatus(SyncStatus.DONE);

	expect(
		await readFile(join(tempPath, 'extensions', '.status'), 'utf8'),
	).toBe('DONE');

	expect(await getSyncStatus()).toBe(SyncStatus.DONE);
});
