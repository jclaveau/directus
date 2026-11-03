import api from '@/api';
import { useNotificationsStore } from '@/stores/notifications';
import { useUserStore } from '@/stores/user';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { reportAppEntries, watchAppChunk } from './sync-app-chunk';

vi.mock('@/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/lang', () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock('@/stores/notifications', () => ({ useNotificationsStore: vi.fn() }));
vi.mock('@/stores/user', () => ({ useUserStore: vi.fn() }));

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
