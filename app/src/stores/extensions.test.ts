import api from '@/api';
import { createTestingPinia } from '@pinia/testing';
import { setActivePinia } from 'pinia';
import { beforeEach, expect, test, vi } from 'vitest';
import { useExtensionsStore } from './extensions';
import { useNotificationsStore } from './notifications';

vi.mock('@/api', () => {
	return {
		default: {
			get: vi.fn().mockResolvedValue({ data: { data: [] } }),
			patch: vi.fn().mockResolvedValue({}),
		},
	};
});

vi.mock('vue-i18n', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('vue-i18n')>()),
		useI18n: () => ({ t: (key: string) => key }),
	};
});

beforeEach(() => {
	setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }));
});

test('toggles an app entry of a code bundle, then asks for a reload', async () => {
	await useExtensionsStore().toggleEntryState({
		id: 'bundle-id/chart',
		bundle: 'bundle-id',
		schema: { type: 'panel', name: 'chart' },
		meta: { enabled: true, folder: 'chart' },
	} as any);

	expect(api.patch).toHaveBeenCalledWith(
		'/extensions/bundle-id/entries/chart',
		{ meta: { enabled: false } },
	);

	expect(useNotificationsStore().add).toHaveBeenCalledWith({
		id: 'reload-required',
		title: 'reload_required',
		text: 'extension_reload_required_copy',
		type: 'warning',
		dialog: false,
		persist: true,
		alwaysShowText: true,
		dismissIcon: 'refresh',
		dismissText: 'extension_reload_now',
		dismissAction: expect.any(Function),
	});
});

test('toggles an api entry of a code bundle, with no reload', async () => {
	await useExtensionsStore().toggleEntryState({
		id: 'audit-id',
		bundle: 'bundle-id',
		schema: { type: 'hook', name: 'audit' },
		meta: { enabled: false, folder: 'audit' },
	} as any);

	expect(api.patch).toHaveBeenCalledWith(
		'/extensions/bundle-id/entries/audit',
		{ meta: { enabled: true } },
	);

	expect(useNotificationsStore().add).not.toHaveBeenCalled();
});
