import {
	InvalidPayloadError,
	ServiceUnavailableError,
	UnprocessableContentError,
} from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getExtensionManager } from '../extensions/index.js';
import { useLogger } from '../logger/index.js';
import { transaction } from '../utils/transaction.js';
import { ExtensionReadError, ExtensionsService } from './extensions.js';
import { ItemsService } from './items.js';

vi.mock('../database/index.js', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('../extensions/index.js', () => ({ getExtensionManager: vi.fn() }));

vi.mock('../logger/index.js', () => {
	const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
	return { useLogger: () => logger };
});

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
			{ id: 'bundle-id', bundle: null, source: 'module', folder: 'bundle-folder' },
			{
				id: 'entry-id',
				bundle: 'bundle-id',
				source: 'module',
				folder: 'entry-one',
			},
			{ id: 'stale-id', bundle: 'bundle-id', source: 'module', folder: 'removed' },
			{ id: 'orphan-id', bundle: 'missing-id', source: 'module', folder: 'x' },
			{ id: 'module-id', bundle: null, source: 'module', folder: 'module-folder' },
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
					source: 'module',
					folder: 'bundle-folder',
				},
				schema: {
					type: 'bundle',
					entries: [{ name: 'entry-one', type: 'interface' }],
				},
			},
			{
				id: 'module-id',
				bundle: null,
				meta: {
					id: 'module-id',
					bundle: null,
					source: 'module',
					folder: 'module-folder',
				},
				schema: null,
			},
			{
				id: 'entry-id',
				bundle: 'bundle-id',
				meta: {
					id: 'entry-id',
					bundle: 'bundle-id',
					source: 'module',
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
			source: 'module',
			folder: 'module-folder',
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
				source: 'module',
				folder: 'module-folder',
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

	it('refuses a payload without meta before opening a transaction', async () => {
		vi.mocked(getExtensionManager).mockReturnValue({} as any);

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		await expect(service.updateOne('extension-id', {})).rejects.toThrowError(
			InvalidPayloadError,
		);

		expect(transaction).not.toHaveBeenCalled();
	});

	it('answers only once the extensions are reloaded', async () => {
		const reloadSteps: string[] = [];

		vi.mocked(getExtensionManager).mockReturnValue({
			reload: vi.fn(async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				reloadSteps.push('reloaded');
			}),
			broadcastReloadNotification: vi.fn(async () => {
				reloadSteps.push('broadcast');
			}),
		} as any);

		vi.spyOn(ItemsService.prototype, 'updateOne').mockResolvedValue('extension-id');

		vi.spyOn(ExtensionsService.prototype, 'readOne').mockResolvedValue({
			id: 'extension-id',
			bundle: null,
			schema: null,
			meta: { options: null },
		} as any);

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		await service.updateOne('extension-id', { meta: { options: null } } as any);

		expect(reloadSteps).toEqual(['reloaded', 'broadcast']);
	});

	it('answers a 503 naming the saved settings on a failed reload', async () => {
		const reloadFailure = new Error('load failed');
		const broadcastReloadNotification = vi.fn().mockResolvedValue(undefined);

		vi.mocked(getExtensionManager).mockReturnValue({
			reload: vi.fn().mockRejectedValue(reloadFailure),
			broadcastReloadNotification,
		} as any);

		vi.spyOn(ItemsService.prototype, 'updateOne').mockResolvedValue('extension-id');

		vi.spyOn(ExtensionsService.prototype, 'readOne').mockResolvedValue({
			id: 'extension-id',
			bundle: null,
			schema: null,
			meta: { options: null },
		} as any);

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		const update = service.updateOne('extension-id', {
			meta: { options: null },
		} as any);

		await expect(update).rejects.toBeInstanceOf(ServiceUnavailableError);

		await expect(update).rejects.toHaveProperty(
			'message',
			oneLine`
				Service "extensions" is unavailable. The extension settings were saved,
				but reloading the extensions failed.
			`,
		);

		expect(broadcastReloadNotification).toHaveBeenCalledOnce();

		expect(useLogger().error).toHaveBeenCalledWith(
			reloadFailure,
			'Failed to reload the extensions after an extension update',
		);
	});

	it('answers the failed reload whatever the broadcast does', async () => {
		const reloadFailure = new Error('load failed');
		const broadcastFailure = new Error('bus down');

		vi.mocked(getExtensionManager).mockReturnValue({
			reload: vi.fn().mockRejectedValue(reloadFailure),
			broadcastReloadNotification: vi.fn().mockRejectedValue(broadcastFailure),
		} as any);

		vi.spyOn(ItemsService.prototype, 'updateOne').mockResolvedValue('extension-id');

		vi.spyOn(ExtensionsService.prototype, 'readOne').mockResolvedValue({
			id: 'extension-id',
			bundle: null,
			schema: null,
			meta: { options: null },
		} as any);

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		const update = service.updateOne('extension-id', {
			meta: { options: null },
		} as any);

		await expect(update).rejects.toBeInstanceOf(ServiceUnavailableError);

		expect(vi.mocked(useLogger().error).mock.calls).toEqual([
			[
				reloadFailure,
				'Failed to reload the extensions after an extension update',
			],
			[
				broadcastFailure,
				'Failed to tell the other processes to reload the extensions',
			],
		]);
	});

	it('answers the saved extension when only the broadcast fails', async () => {
		const broadcastFailure = new Error('bus down');

		vi.mocked(getExtensionManager).mockReturnValue({
			reload: vi.fn().mockResolvedValue(undefined),
			broadcastReloadNotification: vi.fn().mockRejectedValue(broadcastFailure),
		} as any);

		vi.spyOn(ItemsService.prototype, 'updateOne').mockResolvedValue('extension-id');

		vi.spyOn(ExtensionsService.prototype, 'readOne').mockResolvedValue({
			id: 'extension-id',
			bundle: null,
			schema: null,
			meta: { options: null },
		} as any);

		const service = new ExtensionsService({
			knex: knex.default({ client: MockClient }),
			schema,
		});

		const update = service.updateOne('extension-id', {
			meta: { options: null },
		} as any);

		await expect(update).resolves.toEqual({
			id: 'extension-id',
			bundle: null,
			schema: null,
			meta: { options: null },
		});

		expect(useLogger().error).toHaveBeenCalledWith(
			broadcastFailure,
			'Failed to tell the other processes to reload the extensions',
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
