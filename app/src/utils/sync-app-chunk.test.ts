import api from '@/api';
import { useNotificationsStore } from '@/stores/notifications';
import { useUserStore } from '@/stores/user';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	readAppChunkUrl,
	reportAppEntries,
	watchAppChunk,
} from './sync-app-chunk';

vi.mock('@/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/lang', () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock('@/stores/notifications', () => ({ useNotificationsStore: vi.fn() }));
vi.mock('@/stores/user', () => ({ useUserStore: vi.fn() }));
vi.mock('@/utils/get-root-path', () => ({ getRootPath: () => '/admin-root/' }));

afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe('reportAppEntries', () => {
	test('posts the entries of the chunk as an admin', async () => {
		vi.mocked(useUserStore).mockReturnValue({ isAdmin: true } as never);

		await reportAppEntries({
			chunkHash: 'abc',
			bundleEntries: [
				{
					source: 'module',
					folder: 'domain',
					entries: [{ type: 'panel', name: 'chart' }],
				},
			],
		});

		expect(api.post).toHaveBeenCalledWith('/extensions/app-entries', {
			chunk: 'abc',
			entries: [
				{
					source: 'module',
					folder: 'domain',
					entries: [{ type: 'panel', name: 'chart' }],
				},
			],
		});
	});

	test('posts nothing as a non-admin', async () => {
		vi.mocked(useUserStore).mockReturnValue({ isAdmin: false } as never);

		await reportAppEntries({ chunkHash: 'abc', bundleEntries: [] });

		expect(api.post).not.toHaveBeenCalled();
	});

	test('posts nothing for a chunk without code bundles', async () => {
		vi.mocked(useUserStore).mockReturnValue({ isAdmin: true } as never);

		await reportAppEntries({ chunkHash: 'abc' });

		expect(api.post).not.toHaveBeenCalled();
	});
});

describe('watchAppChunk', () => {
	test('asks for a reload once the server serves another chunk', async () => {
		const notifications = { add: vi.fn() };
		vi.mocked(useNotificationsStore).mockReturnValue(notifications as never);
		vi.mocked(api.get).mockResolvedValue({ data: { data: { chunk: 'def' } } });

		const stopWatching = watchAppChunk({ chunkHash: 'abc' });

		document.dispatchEvent(new Event('visibilitychange'));
		await vi.waitFor(() => expect(notifications.add).toHaveBeenCalledTimes(1));
		stopWatching();

		expect(api.get).toHaveBeenCalledWith('/extensions/app-chunk');

		expect(notifications.add).toHaveBeenCalledWith({
			title: 'reload_required',
			text: 'extension_app_chunk_stale_copy',
			type: 'warning',
			dialog: false,
			persist: true,
			alwaysShowText: true,
			dismissIcon: 'refresh',
			dismissText: 'extension_reload_now',
			dismissAction: expect.any(Function),
		});
	});
});

describe('reportAppEntries failures', () => {
	test('asks for one reload when the server refuses a stale chunk', async () => {
		vi.resetModules();

		const { default: freshApi } = await import('@/api');

		const { useNotificationsStore: freshNotifications } = await import(
			'@/stores/notifications'
		);

		const { useUserStore: freshUserStore } = await import('@/stores/user');
		const { reportAppEntries: freshReport } = await import('./sync-app-chunk');

		const notifications = { add: vi.fn() };
		vi.mocked(freshNotifications).mockReturnValue(notifications as never);
		vi.mocked(freshUserStore).mockReturnValue({ isAdmin: true } as never);
		vi.mocked(freshApi.post).mockRejectedValue({ response: { status: 409 } });

		await freshReport({ chunkHash: 'abc', bundleEntries: [] });
		await freshReport({ chunkHash: 'abc', bundleEntries: [] });

		expect(notifications.add).toHaveBeenCalledTimes(1);

		const reloadSpy = vi.spyOn(window.location, 'reload')
			.mockImplementation(() => undefined);

		notifications.add.mock.calls[0]![0].dismissAction();

		expect(reloadSpy).toHaveBeenCalledTimes(1);
	});

	test('warns about a report the server fails otherwise', async () => {
		const consoleWarn = vi.spyOn(console, 'warn')
			.mockImplementation(() => undefined);

		vi.mocked(useUserStore).mockReturnValue({ isAdmin: true } as never);
		vi.mocked(api.post).mockRejectedValue(new Error('offline'));

		await reportAppEntries({ chunkHash: 'abc', bundleEntries: [] });

		expect(consoleWarn).toHaveBeenCalledWith(
			'Couldn\'t report the app entries of the bundles',
			new Error('offline'),
		);
	});
});

describe('watchAppChunk without a check', () => {
	test('watches nothing for a chunk without a hash', () => {
		const stopWatching = watchAppChunk({});

		document.dispatchEvent(new Event('visibilitychange'));
		stopWatching();

		expect(api.get).not.toHaveBeenCalled();
	});

	test('reads nothing while the tab is hidden', () => {
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

		const stopWatching = watchAppChunk({ chunkHash: 'abc' });

		document.dispatchEvent(new Event('visibilitychange'));
		stopWatching();

		expect(api.get).not.toHaveBeenCalled();
	});

	test('warns about an app chunk it cannot read', async () => {
		const consoleWarn = vi.spyOn(console, 'warn')
			.mockImplementation(() => undefined);

		vi.mocked(api.get).mockRejectedValue(new Error('offline'));

		const stopWatching = watchAppChunk({ chunkHash: 'abc' });

		document.dispatchEvent(new Event('visibilitychange'));

		await vi.waitFor(() => {
			expect(consoleWarn).toHaveBeenCalledWith(
				'Couldn\'t read the app chunk the server serves',
				new Error('offline'),
			);
		});

		stopWatching();
	});
});

describe('readAppChunkUrl', () => {
	test('reads the entry url carrying the served chunk hash', async () => {
		vi.mocked(api.get).mockResolvedValue({ data: { data: { chunk: 'def' } } });

		expect(await readAppChunkUrl()).toBe(
			'/admin-root/extensions/sources/index.js?chunk=def',
		);
	});

	test('reads the bare entry url when the hash cannot be read', async () => {
		const consoleWarn = vi.spyOn(console, 'warn')
			.mockImplementation(() => undefined);

		vi.mocked(api.get).mockRejectedValue(new Error('offline'));

		expect(await readAppChunkUrl()).toBe(
			'/admin-root/extensions/sources/index.js',
		);

		expect(consoleWarn).toHaveBeenCalledWith(
			'Couldn\'t read the app chunk the server serves',
			new Error('offline'),
		);
	});
});
