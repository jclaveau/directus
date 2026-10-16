import { useEnv } from '@directus/env';
import {
	ForbiddenError,
	InvalidPayloadError,
	LimitExceededError,
	UnprocessableContentError,
} from '@directus/errors';
import { describe as describeExtension } from '@directus/extensions-registry';
import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getExtensionManager } from '../extensions/index.js';
import { ExtensionReadError, ExtensionsService } from './extensions.js';
import { ItemsService } from './items.js';

vi.mock('../database/index.js', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('@directus/env', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@directus/env')>();

	return { ...actual, useEnv: vi.fn(actual.useEnv) };
});

vi.mock('@directus/extensions-registry', () => ({ describe: vi.fn() }));
vi.mock('../extensions/index.js', () => ({ getExtensionManager: vi.fn() }));

vi.mock('../utils/transaction.js', () => {
	return {
		transaction: vi.fn((trxKnex, runInTransaction) => runInTransaction(trxKnex)),
	};
});

const schema = new SchemaBuilder()
	.collection('directus_extensions', (c) => {
		c.field('id').uuid()
.primary();
	})
	.build();

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe('Services / Extensions / install', () => {
	it('refuses a version the registry does not list', async () => {
		vi.mocked(getExtensionManager).mockReturnValue({ extensions: [] } as any);

		vi.mocked(describeExtension).mockResolvedValue({
			data: { type: 'interface', versions: [{ id: 'version-2', bundled: [] }] },
		} as any);

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		vi.mocked(useEnv).mockReturnValueOnce({
			MARKETPLACE_REGISTRY: 'https://registry.example.com',
		});

		const installation = service.install('extension-id', 'version-1');

		await expect(installation).rejects.toThrowError(ForbiddenError);

		await expect(installation).rejects.toHaveProperty(
			'message',
			`You don't have permission to access this.`,
		);

		expect(describeExtension).toHaveBeenCalledWith('extension-id', {
			registry: 'https://registry.example.com',
		});
	});

	it('counts each bundled entry against the extensions limit', async () => {
		vi.mocked(getExtensionManager).mockReturnValue({
			extensions: [{ name: 'one' }, { name: 'two' }],
		} as any);

		vi.mocked(describeExtension).mockResolvedValue({
			data: {
				type: 'bundle',
				versions: [
					{
						id: 'version-1',
						bundled: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
					},
				],
			},
		} as any);

		const createOneSpy = vi.spyOn(ItemsService.prototype, 'createOne');

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		vi.mocked(useEnv).mockReturnValueOnce({ EXTENSIONS_LIMIT: '4' });

		const installation = service.install('extension-id', 'version-1');

		await expect(installation).rejects.toThrowError(LimitExceededError);

		await expect(installation).rejects.toHaveProperty(
			'message',
			'Extensions limit exceeded.',
		);

		expect(createOneSpy).not.toHaveBeenCalled();
	});

	it('refuses a single extension once the limit is reached', async () => {
		vi.mocked(getExtensionManager).mockReturnValue({
			extensions: [{ name: 'one' }, { name: 'two' }],
		} as any);

		vi.mocked(describeExtension).mockResolvedValue({
			data: { type: 'interface', versions: [{ id: 'version-1', bundled: [] }] },
		} as any);

		const createOneSpy = vi.spyOn(ItemsService.prototype, 'createOne');

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		vi.mocked(useEnv).mockReturnValueOnce({ EXTENSIONS_LIMIT: '2' });

		const installation = service.install('extension-id', 'version-1');

		await expect(installation).rejects.toThrowError(LimitExceededError);

		await expect(installation).rejects.toHaveProperty(
			'message',
			'Extensions limit exceeded.',
		);

		expect(createOneSpy).not.toHaveBeenCalled();
	});

	it('records a bundle without entries as a single row', async () => {
		vi.mocked(getExtensionManager).mockReturnValue({
			extensions: [],
			install: vi.fn(),
		} as any);

		vi.mocked(describeExtension).mockResolvedValue({
			data: { type: 'bundle', versions: [{ id: 'version-1', bundled: [] }] },
		} as any);

		vi.spyOn(ItemsService.prototype, 'createOne').mockResolvedValue('extension-id');
		const createManySpy = vi.spyOn(ItemsService.prototype, 'createMany');

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		vi.mocked(useEnv).mockReturnValueOnce({});

		await service.install('extension-id', 'version-1');

		expect(createManySpy).not.toHaveBeenCalled();
	});

	it('records a bundle and each of its entries, then installs it', async () => {
		const installSpy = vi.fn();

		vi.mocked(getExtensionManager).mockReturnValue({
			extensions: [],
			install: installSpy,
		} as any);

		vi.mocked(describeExtension).mockResolvedValue({
			data: {
				type: 'bundle',
				versions: [
					{
						id: 'version-1',
						bundled: [{ name: 'entry-one' }, { name: 'entry-two' }],
					},
				],
			},
		} as any);

		const createOneSpy = vi
			.spyOn(ItemsService.prototype, 'createOne')
			.mockResolvedValue('extension-id');

		const createManySpy = vi
			.spyOn(ItemsService.prototype, 'createMany')
			.mockResolvedValue([]);

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		vi.mocked(useEnv).mockReturnValueOnce({});

		await service.install('extension-id', 'version-1');

		expect(describeExtension).toHaveBeenCalledWith('extension-id', {});

		expect(createOneSpy).toHaveBeenCalledWith({
			id: 'extension-id',
			enabled: true,
			folder: 'version-1',
			source: 'registry',
			bundle: null,
		});

		expect(createManySpy).toHaveBeenCalledWith([
			{
				enabled: true,
				folder: 'entry-one',
				source: 'registry',
				bundle: 'extension-id',
			},
			{
				enabled: true,
				folder: 'entry-two',
				source: 'registry',
				bundle: 'extension-id',
			},
		]);

		expect(installSpy).toHaveBeenCalledWith('version-1');
	});

	it('records a single extension under the limit without entries', async () => {
		const installSpy = vi.fn();

		vi.mocked(getExtensionManager).mockReturnValue({
			extensions: [{ name: 'one' }],
			install: installSpy,
		} as any);

		vi.mocked(describeExtension).mockResolvedValue({
			data: { type: 'interface', versions: [{ id: 'version-1', bundled: [] }] },
		} as any);

		const createOneSpy = vi
			.spyOn(ItemsService.prototype, 'createOne')
			.mockResolvedValue('extension-id');

		const createManySpy = vi.spyOn(ItemsService.prototype, 'createMany');

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		vi.mocked(useEnv).mockReturnValueOnce({ EXTENSIONS_LIMIT: '4' });

		await service.install('extension-id', 'version-1');

		expect(createOneSpy).toHaveBeenCalledWith({
			id: 'extension-id',
			enabled: true,
			folder: 'version-1',
			source: 'registry',
			bundle: null,
		});

		expect(createManySpy).not.toHaveBeenCalled();
		expect(installSpy).toHaveBeenCalledWith('version-1');
	});
});

describe('Services / Extensions / uninstall', () => {
	it.each([
		[
			{ id: 'extension-id', source: 'local', bundle: null, folder: 'version-1' },
			oneLine`
				Invalid payload. Cannot uninstall extensions
				that were not installed via marketplace.
			`,
		],
		[
			{
				id: 'extension-id',
				source: 'registry',
				bundle: 'parent-id',
				folder: 'entry',
			},
			'Invalid payload. Cannot uninstall sub extensions of bundles separately.',
		],
	])('refuses %j', async (settings, message) => {
		vi.mocked(getExtensionManager).mockReturnValue({} as any);
		vi.spyOn(ItemsService.prototype, 'readOne').mockResolvedValue(settings);
		const deleteOneSpy = vi.spyOn(ItemsService.prototype, 'deleteOne');

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		const removal = service.uninstall('extension-id');

		await expect(removal).rejects.toThrowError(InvalidPayloadError);
		await expect(removal).rejects.toHaveProperty('message', message);
		expect(deleteOneSpy).not.toHaveBeenCalled();
	});

	it('deletes the row and its entries, then removes the folder', async () => {
		const uninstallSpy = vi.fn();

		vi.mocked(getExtensionManager)
			.mockReturnValue({ uninstall: uninstallSpy } as any);

		vi.spyOn(ItemsService.prototype, 'readOne').mockResolvedValue({
			id: 'extension-id',
			source: 'registry',
			bundle: null,
			folder: 'version-1',
		});

		const deleteOneSpy = vi
			.spyOn(ItemsService.prototype, 'deleteOne')
			.mockResolvedValue('extension-id');

		const deleteByQuerySpy = vi
			.spyOn(ItemsService.prototype, 'deleteByQuery')
			.mockResolvedValue([]);

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		await service.uninstall('extension-id');

		expect(deleteOneSpy).toHaveBeenCalledWith('extension-id');

		expect(deleteByQuerySpy).toHaveBeenCalledWith({
			filter: { bundle: { _eq: 'extension-id' } },
		});

		expect(uninstallSpy).toHaveBeenCalledWith('version-1');
	});
});

describe('Services / Extensions / reinstall', () => {
	it.each([
		[
			{ id: 'extension-id', source: 'local', bundle: null, folder: 'version-1' },
			oneLine`
				Invalid payload. Cannot reinstall extensions
				that were not installed via marketplace.
			`,
		],
		[
			{
				id: 'extension-id',
				source: 'registry',
				bundle: 'parent-id',
				folder: 'entry',
			},
			'Invalid payload. Cannot reinstall sub extensions of bundles separately.',
		],
	])('refuses %j', async (settings, message) => {
		vi.mocked(getExtensionManager).mockReturnValue({} as any);
		vi.spyOn(ItemsService.prototype, 'readOne').mockResolvedValue(settings);

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		const reinstallation = service.reinstall('extension-id');

		await expect(reinstallation).rejects.toThrowError(InvalidPayloadError);
		await expect(reinstallation).rejects.toHaveProperty('message', message);
		expect(describeExtension).not.toHaveBeenCalled();
	});

	it('checks the recorded version again, then installs it', async () => {
		const installSpy = vi.fn();

		vi.mocked(getExtensionManager).mockReturnValue({
			extensions: [],
			install: installSpy,
		} as any);

		vi.mocked(describeExtension).mockResolvedValue({
			data: { type: 'interface', versions: [{ id: 'version-1', bundled: [] }] },
		} as any);

		vi.spyOn(ItemsService.prototype, 'readOne').mockResolvedValue({
			id: 'extension-id',
			source: 'registry',
			bundle: null,
			folder: 'version-1',
		});

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		vi.mocked(useEnv).mockReturnValueOnce({});

		await service.reinstall('extension-id');

		expect(describeExtension).toHaveBeenCalledWith('extension-id', {});
		expect(installSpy).toHaveBeenCalledWith('version-1');
	});
});

describe('Services / Extensions / readAll', () => {
	it(oneLine`
		lists the regular extensions, then the entries of a known bundle
	`, async () => {
		vi.mocked(getExtensionManager).mockReturnValue({
			getExtension: vi
				.fn()
				.mockReturnValueOnce({
					type: 'bundle',
					entries: [{ name: 'entry-one', type: 'interface' }],
				})
				.mockReturnValueOnce(undefined),
		} as any);

		vi.spyOn(ItemsService.prototype, 'readByQuery').mockResolvedValue([
			{ id: 'bundle-id', bundle: null, source: 'registry', folder: 'bundle-folder' },
			{
				id: 'entry-id',
				bundle: 'bundle-id',
				source: 'registry',
				folder: 'entry-one',
			},
			{ id: 'stale-id', bundle: 'bundle-id', source: 'registry', folder: 'removed' },
			{ id: 'orphan-id', bundle: 'missing-id', source: 'registry', folder: 'x' },
			{ id: 'local-id', bundle: null, source: 'local', folder: 'local-folder' },
		] as any);

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		expect(await service.readAll()).toEqual([
			{
				id: 'bundle-id',
				bundle: null,
				meta: {
					id: 'bundle-id',
					bundle: null,
					source: 'registry',
					folder: 'bundle-folder',
				},
				schema: {
					type: 'bundle',
					entries: [{ name: 'entry-one', type: 'interface' }],
				},
			},
			{
				id: 'local-id',
				bundle: null,
				meta: {
					id: 'local-id',
					bundle: null,
					source: 'local',
					folder: 'local-folder',
				},
				schema: null,
			},
			{
				id: 'entry-id',
				bundle: 'bundle-id',
				meta: {
					id: 'entry-id',
					bundle: 'bundle-id',
					source: 'registry',
					folder: 'entry-one',
				},
				schema: { name: 'entry-one', type: 'interface' },
			},
		]);
	});
});

describe('Services / Extensions / readOne', () => {
	it('answers a null schema for an extension the manager did not load', async () => {
		vi.mocked(getExtensionManager).mockReturnValue({
			getExtension: vi.fn().mockReturnValue(undefined),
		} as any);

		vi.spyOn(ItemsService.prototype, 'readOne').mockResolvedValue({
			id: 'extension-id',
			bundle: null,
			source: 'local',
			folder: 'local-folder',
		});

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		expect(await service.readOne('extension-id')).toEqual({
			id: 'extension-id',
			bundle: null,
			schema: null,
			meta: {
				id: 'extension-id',
				bundle: null,
				source: 'local',
				folder: 'local-folder',
			},
		});
	});
});

describe('Services / Extensions / updateOne', () => {
	it('refuses a payload without meta', async () => {
		vi.mocked(getExtensionManager).mockReturnValue({} as any);

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		const update = service.updateOne('extension-id', {});

		await expect(update).rejects.toThrowError(InvalidPayloadError);

		await expect(update).rejects.toHaveProperty(
			'message',
			'Invalid payload. "meta" is required.',
		);
	});

	it('wraps a failed read-back in ExtensionReadError', async () => {
		vi.mocked(getExtensionManager).mockReturnValue({} as any);
		vi.spyOn(ItemsService.prototype, 'updateOne').mockResolvedValue('extension-id');
		const readFailure = new Error('extension folder vanished');
		vi.spyOn(ExtensionsService.prototype, 'readOne').mockRejectedValue(readFailure);

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		const update = service.updateOne('extension-id', { meta: { enabled: false } });

		await expect(update).rejects.toThrowError(ExtensionReadError);
		await expect(update).rejects.toHaveProperty('originalError', readFailure);
	});

	it(oneLine`
		writes the meta of a bundle without syncing, then reloads and notifies
	`, async () => {
		const broadcastSpy = vi.fn();

		vi.mocked(getExtensionManager).mockReturnValue({
			reload: vi.fn().mockResolvedValue(undefined),
			broadcastReloadNotification: broadcastSpy,
		} as any);

		const updateOneSpy = vi
			.spyOn(ItemsService.prototype, 'updateOne')
			.mockResolvedValue('extension-id');

		vi.spyOn(ExtensionsService.prototype, 'readOne').mockResolvedValue({
			id: 'extension-id',
			bundle: null,
			schema: { type: 'bundle' },
			meta: { options: { color: 'red' } },
		} as any);

		const pgDatabase = knex.default({ client: MockClient, dialect: 'pg' });
		const pgTracker = createTracker(pgDatabase);
		const service = new ExtensionsService({ knex: pgDatabase, schema });

		expect(
			await service.updateOne(
				'extension-id',
				{ meta: { options: { color: 'red' } } } as any,
			),
		).toEqual({
			id: 'extension-id',
			bundle: null,
			schema: { type: 'bundle' },
			meta: { options: { color: 'red' } },
		});

		expect(updateOneSpy).toHaveBeenCalledWith('extension-id', {
			options: { color: 'red' },
		});

		expect(pgTracker.history.all).toEqual([]);
		await vi.waitFor(() => expect(broadcastSpy).toHaveBeenCalledTimes(1));
	});

	it('sets a toggled bundle and all its entries to its status', async () => {
		vi.mocked(getExtensionManager).mockReturnValue({
			reload: vi.fn().mockResolvedValue(undefined),
			broadcastReloadNotification: vi.fn(),
		} as any);

		vi.spyOn(ItemsService.prototype, 'updateOne').mockResolvedValue('bundle-id');

		vi.spyOn(ExtensionsService.prototype, 'readOne').mockResolvedValue({
			id: 'bundle-id',
			bundle: null,
			schema: { type: 'bundle' },
			meta: { enabled: false },
		} as any);

		const pgDatabase = knex.default({ client: MockClient, dialect: 'pg' });
		const pgTracker = createTracker(pgDatabase);
		pgTracker.on.update('directus_extensions').response(3);
		const service = new ExtensionsService({ knex: pgDatabase, schema });

		await service.updateOne('bundle-id', { meta: { enabled: false } });

		expect(pgTracker.history.update).toMatchObject([
			{
				sql: oneLine`
					update "directus_extensions" set "enabled" = $1
					where "bundle" = $2 or ("id" = $3)
				`,
				bindings: [false, 'bundle-id', 'bundle-id'],
			},
		]);
	});

	it('leaves a toggled extension outside any bundle alone', async () => {
		vi.mocked(getExtensionManager).mockReturnValue({
			reload: vi.fn().mockResolvedValue(undefined),
			broadcastReloadNotification: vi.fn(),
		} as any);

		vi.spyOn(ItemsService.prototype, 'updateOne').mockResolvedValue('extension-id');

		const readOneSpy = vi.spyOn(ExtensionsService.prototype, 'readOne')
			.mockResolvedValue({
			id: 'extension-id',
			bundle: null,
			schema: { type: 'interface' },
			meta: { enabled: false, bundle: null },
		} as any);

		const pgDatabase = knex.default({ client: MockClient, dialect: 'pg' });
		const pgTracker = createTracker(pgDatabase);
		const service = new ExtensionsService({ knex: pgDatabase, schema });

		await service.updateOne('extension-id', { meta: { enabled: false } });

		expect(readOneSpy).toHaveBeenCalledTimes(1);
		expect(pgTracker.history.all).toEqual([]);
	});

	it('leaves the parent alone when it is not a bundle', async () => {
		vi.mocked(getExtensionManager).mockReturnValue({
			reload: vi.fn().mockResolvedValue(undefined),
			broadcastReloadNotification: vi.fn(),
		} as any);

		vi.spyOn(ItemsService.prototype, 'updateOne').mockResolvedValue('entry-id');

		const readOneSpy = vi
			.spyOn(ExtensionsService.prototype, 'readOne')
			.mockResolvedValueOnce({
				id: 'entry-id',
				bundle: 'parent-id',
				schema: null,
				meta: { enabled: false },
			} as any)
			.mockResolvedValueOnce({
				id: 'parent-id',
				bundle: null,
				schema: null,
				meta: { enabled: true },
			} as any);

		const pgDatabase = knex.default({ client: MockClient, dialect: 'pg' });
		const pgTracker = createTracker(pgDatabase);
		const service = new ExtensionsService({ knex: pgDatabase, schema });

		await service.updateOne('entry-id', { meta: { enabled: false } });

		expect(readOneSpy).toHaveBeenCalledWith('parent-id');
		expect(pgTracker.history.all).toEqual([]);
	});

	it('refuses to toggle an entry of a non-partial bundle', async () => {
		vi.mocked(getExtensionManager).mockReturnValue({} as any);
		vi.spyOn(ItemsService.prototype, 'updateOne').mockResolvedValue('entry-id');

		vi.spyOn(ExtensionsService.prototype, 'readOne')
			.mockResolvedValueOnce({
				id: 'entry-id',
				bundle: 'parent-id',
				schema: { type: 'interface' },
				meta: { enabled: false },
			} as any)
			.mockResolvedValueOnce({
				id: 'parent-id',
				bundle: null,
				schema: { type: 'bundle', partial: false },
				meta: { enabled: true },
			} as any);

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient, dialect: 'pg' }),
			schema,
		});

		const update = service.updateOne('entry-id', { meta: { enabled: false } });

		await expect(update).rejects.toThrowError(UnprocessableContentError);

		await expect(update).rejects.toHaveProperty(
			'message',
			oneLine`
				Can't process content. Unable to toggle status of an entry
				for a bundle marked as non partial.
			`,
		);
	});

	it.each([
		[{ id: 'sibling-id' }, true],
		[undefined, false],
	])(oneLine`
		with enabled sibling %j sets the partial bundle to %s
	`, async (sibling, enabled) => {
		vi.mocked(getExtensionManager).mockReturnValue({
			reload: vi.fn().mockResolvedValue(undefined),
			broadcastReloadNotification: vi.fn(),
		} as any);

		vi.spyOn(ItemsService.prototype, 'updateOne').mockResolvedValue('entry-id');

		vi.spyOn(ExtensionsService.prototype, 'readOne')
			.mockResolvedValueOnce({
				id: 'entry-id',
				bundle: null,
				schema: { type: 'interface' },
				meta: { enabled: false, bundle: 'parent-id' },
			} as any)
			.mockResolvedValueOnce({
				id: 'parent-id',
				bundle: null,
				schema: { type: 'bundle', partial: true },
				meta: { enabled: true },
			} as any);

		const pgDatabase = knex.default({ client: MockClient, dialect: 'pg' });
		const pgTracker = createTracker(pgDatabase);
		pgTracker.on.select('directus_extensions').response(sibling);
		pgTracker.on.update('directus_extensions').response(1);
		const service = new ExtensionsService({ knex: pgDatabase, schema });

		await service.updateOne('entry-id', { meta: { enabled: false } });

		expect(pgTracker.history.select).toMatchObject([
			{
				sql: oneLine`
					select * from "directus_extensions"
					where "bundle" = $1 and "enabled" = $2 limit $3
				`,
				bindings: ['parent-id', true, 1],
			},
		]);

		expect(pgTracker.history.update).toMatchObject([
			{
				sql: 'update "directus_extensions" set "enabled" = $1 where "id" = $2',
				bindings: [enabled, 'parent-id'],
			},
		]);
	});
});
