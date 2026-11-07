import { afterEach, expect, test, vi } from 'vitest';
import getDatabase from '../../../database/index.js';
import { migrateLatest } from '../../utils/migrate-latest.js';
import migrate from './migrate.js';

vi.mock('../../../database/index.js', () => ({ default: vi.fn() }));
vi.mock('../../../database/migrations/run.js', () => ({ default: vi.fn() }));

vi.mock('../../../extensions/lib/get-extension-migrations.js', () => {
	return { getExtensionMigrations: vi.fn() };
});

vi.mock('../../../logger/index.js', () => {
	return { useLogger: () => ({ info: vi.fn(), error: vi.fn() }) };
});

vi.mock('../../utils/migrate-latest.js', () => ({ migrateLatest: vi.fn() }));

afterEach(() => {
	vi.restoreAllMocks();
});

test('migrate:latest hands its --phase to migrateLatest', async () => {
	const database = { destroy: vi.fn() };
	vi.mocked(getDatabase).mockReturnValue(database as never);
	const exitSpy = vi.spyOn(process, 'exit').mockReturnValue(undefined as never);

	await migrate('latest', { phase: 'before-schema' });

	expect(vi.mocked(migrateLatest)).toHaveBeenCalledExactlyOnceWith(
		database,
		undefined,
		'before-schema',
	);

	expect(exitSpy).toHaveBeenCalledExactlyOnceWith();
});
