import api from '@/api';
import { useNotificationsStore } from '@/stores/notifications';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { readAppChunkUrl, watchAppChunk } from './sync-app-chunk';

vi.mock('@/api', () => ({ default: { get: vi.fn() } }));
vi.mock('@/lang', () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock('@/stores/notifications', () => ({ useNotificationsStore: vi.fn() }));
vi.mock('@/utils/get-root-path', () => ({ getRootPath: () => '/admin-root/' }));

afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
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
