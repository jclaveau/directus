import { afterEach, expect, test, vi } from 'vitest';
import getDatabase from '../../../database/index.js';
import { migrateLatest } from '../../utils/migrate-latest.js';
import migrate from './migrate.js';

vi.mock('../../../database/index.js', () => ({ default: vi.fn() }));
vi.mock('../../../database/migrations/run.js', () => ({ default: vi.fn() }));

vi.mock('../../../extensions/lib/get-extension-migrations.js', () => {
	return { getExtensionMigrations: vi.fn() };
});

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));

vi.mock('../../../logger/index.js', () => {
	return { useLogger: () => mockLogger };
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

test('migrate:latest --phase logs the phase it ran', async () => {
	vi.mocked(getDatabase).mockReturnValue({ destroy: vi.fn() } as never);
	vi.spyOn(process, 'exit').mockReturnValue(undefined as never);

	await migrate('latest', { phase: 'before-schema' });

	expect(mockLogger.info).toHaveBeenLastCalledWith(
		'Migration phase "before-schema" up to date',
	);
});

test('migrate:latest without --phase logs the whole database', async () => {
	vi.mocked(getDatabase).mockReturnValue({ destroy: vi.fn() } as never);
	vi.spyOn(process, 'exit').mockReturnValue(undefined as never);

	await migrate('latest');

	expect(mockLogger.info).toHaveBeenLastCalledWith('Database up to date');
});
