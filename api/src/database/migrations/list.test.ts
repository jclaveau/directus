import { useEnv } from '@directus/env';
import fse from 'fs-extra';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { listMigrations } from './list.js';

vi.mock('@directus/env');
vi.mock('fs-extra');

const noop = async () => {};

beforeEach(() => {
	vi.mocked(useEnv).mockReturnValue({ MIGRATIONS_PATH: '/custom-migrations' });

	vi.mocked(fse.pathExists).mockResolvedValue(true as never);

	vi.mocked(fse.readdir).mockImplementation((async (directory: string) => {
		return directory === path.resolve('/custom-migrations')
			? ['20990102A-custom.js', 'readme.md']
			: ['20990103A-core.js', 'run.js', 'list.js', 'list.test.ts'];
	}) as never);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('listMigrations', () => {
	test('orders the core, custom and bundle migrations by date', async () => {
		const migrations = await listMigrations([
			{
				bundle: '@consumer/domain',
				name: '20990101A-add-orders',
				config: { up: noop, down: noop },
			},
			{
				bundle: '@consumer/domain',
				name: '20990103A-add-invoices',
				config: { phase: 'after-schema', up: noop, down: noop },
			},
		]);

		expect(migrations).toEqual([
			{
				version: '@consumer/domain:20990101A',
				name: 'Add Orders',
				file: '@consumer/domain entry "20990101A-add-orders"',
				bundle: '@consumer/domain',
				phase: 'before-schema',
				loadModule: expect.any(Function),
			},
			{
				version: '20990102A',
				name: 'Custom',
				file: path.resolve('/custom-migrations/20990102A-custom.js'),
				bundle: null,
				phase: 'before-schema',
				loadModule: expect.any(Function),
			},
			{
				version: '20990103A',
				name: 'Core',
				file: path.join(import.meta.dirname, '20990103A-core.js'),
				bundle: null,
				phase: 'before-schema',
				loadModule: expect.any(Function),
			},
			{
				version: '@consumer/domain:20990103A',
				name: 'Add Invoices',
				file: '@consumer/domain entry "20990103A-add-invoices"',
				bundle: '@consumer/domain',
				phase: 'after-schema',
				loadModule: expect.any(Function),
			},
		]);
	});

	test('loads a bundle migration from its config', async () => {
		const config = { up: noop, down: noop };

		const [migration] = await listMigrations([
			{ bundle: '@consumer/domain', name: '20990101A-add-orders', config },
		]);

		expect(await migration!.loadModule()).toBe(config);
	});

	test('refuses two migrations of a bundle on the same date', async () => {
		await expect(
			listMigrations([
				{
					bundle: '@consumer/domain',
					name: '20990101A-add-orders',
					config: { up: noop, down: noop },
				},
				{
					bundle: '@consumer/domain',
					name: '20990101A-add-invoices',
					config: { up: noop, down: noop },
				},
			]),
		).rejects.toThrow(
			new Error(
				'Migration keys collide! Please ensure that every migration uses a '
					+ 'unique key:\n'
					+ '\t- "@consumer/domain:20990101A": '
					+ '@consumer/domain entry "20990101A-add-orders",'
					+ ' @consumer/domain entry "20990101A-add-invoices"',
			),
		);
	});

	test('refuses a MIGRATIONS_PATH file without a date', async () => {
		vi.mocked(fse.readdir).mockImplementation((async (directory: string) => {
			return directory === path.resolve('/custom-migrations')
				? ['custom-add-foo.js']
				: ['20990103A-core.js'];
		}) as never);

		await expect(listMigrations()).rejects.toThrow(
			new Error(
				'Migration "custom-add-foo.js" in MIGRATIONS_PATH has no date:'
					+ ' name it "<YYYYMMDD><letter>-<name>.js"',
			),
		);
	});
});
