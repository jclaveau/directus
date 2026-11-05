import type { Knex } from 'knex';
import { afterEach, expect, test, vi } from 'vitest';
import { outstandingMigrations } from '../../database/index.js';
import runMigrations from '../../database/migrations/run.js';
import {
	getExtensionMigrations,
} from '../../extensions/lib/get-extension-migrations.js';
import { migrateLatest } from './migrate-latest.js';

vi.mock('../../database/index.js', () => ({ outstandingMigrations: vi.fn() }));
vi.mock('../../database/migrations/run.js', () => ({ default: vi.fn() }));

vi.mock('../../extensions/lib/get-extension-migrations.js', () => {
	return { getExtensionMigrations: vi.fn() };
});

vi.mock('../../logger/index.js', () => ({ useLogger: () => ({ info: vi.fn() }) }));
vi.mock('../../utils/apply-snapshot.js', () => ({ applySnapshot: vi.fn() }));

vi.mock('../../utils/get-snapshot-diff.js', () => {
	return { getSnapshotDiff: vi.fn() };
});

vi.mock('../../utils/get-snapshot.js', () => ({ getSnapshot: vi.fn() }));

vi.mock('../commands/schema/load-snapshot.js', () => {
	return { loadSnapshotFile: vi.fn() };
});

vi.mock('../commands/schema/report-diff.js', () => {
	return { isEmptySnapshotDiff: vi.fn() };
});

afterEach(() => {
	vi.resetAllMocks();
});

// A deploy imports the schema between the two phases with its own tool, so it
// needs a run that stops once the before-schema migrations are done, even with
// after-schema ones still pending.
test('--phase before-schema runs its own migrations alone', async () => {
	vi.mocked(getExtensionMigrations).mockResolvedValue([
		{
			bundle: 'domain',
			name: '20240101A-fill-columns',
			config: { phase: 'after-schema', up: vi.fn(), down: vi.fn() },
		},
	]);

	vi.mocked(outstandingMigrations).mockResolvedValue([
		'domain:20240101A',
	]);

	await migrateLatest({} as Knex, undefined, 'before-schema');

	expect(vi.mocked(runMigrations)).toHaveBeenCalledExactlyOnceWith(
		{},
		'latest',
		true,
		{
			extensionMigrations: [
				{
					bundle: 'domain',
					name: '20240101A-fill-columns',
					config: {
						phase: 'after-schema',
						up: expect.any(Function),
						down: expect.any(Function),
					},
				},
			],
			phase: 'before-schema',
		},
	);
});

test('--phase after-schema runs its own migrations alone', async () => {
	vi.mocked(getExtensionMigrations).mockResolvedValue([]);

	await migrateLatest({} as Knex, undefined, 'after-schema');

	expect(vi.mocked(runMigrations)).toHaveBeenCalledExactlyOnceWith(
		{},
		'latest',
		true,
		{ extensionMigrations: [], phase: 'after-schema' },
	);
});

test('an unknown --phase is refused before any migration runs', async () => {
	vi.mocked(getExtensionMigrations).mockResolvedValue([]);

	await expect(migrateLatest({} as Knex, undefined, 'schema')).rejects.toThrow(
		new Error(
			'Unknown migration phase "schema":'
			+ ' expected "before-schema" or "after-schema"',
		),
	);

	expect(vi.mocked(runMigrations)).not.toHaveBeenCalled();
});

test('--snapshot with --phase is refused before any migration runs', async () => {
	vi.mocked(getExtensionMigrations).mockResolvedValue([]);

	await expect(
		migrateLatest({} as Knex, 'schema.json', 'before-schema'),
	).rejects.toThrow(
		new Error(
			'--snapshot "schema.json" is applied between the two phases:'
			+ ' it cannot go with --phase "before-schema"',
		),
	);

	expect(vi.mocked(runMigrations)).not.toHaveBeenCalled();
});
