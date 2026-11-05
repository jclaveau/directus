import { i18n } from '@/lang';
import { useExtensionsStore } from '@/stores/extensions';
import { useServerStore } from '@/stores/server';
import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test, vi } from 'vitest';
import ExtensionItem from './extension-item.vue';

test.each([
	{ marketplace: true, linked: true },
	{ marketplace: false, linked: false },
])('links a registry extension to the Marketplace: $linked', ({
	marketplace,
	linked,
}) => {
	const pinia = createTestingPinia({ createSpy: vi.fn });
	useServerStore(pinia).info.extensions = { limit: null, marketplace };

	expect(
		mount(ExtensionItem, {
			props: {
				extension: {
					id: 'extension-id',
					bundle: null,
					schema: { type: 'interface', name: 'registry-interface', local: false },
					meta: {
						enabled: true,
						folder: 'extension-id',
						source: 'registry',
						bundle: null,
					},
				} as any,
			},
			global: {
				plugins: [i18n, pinia],
				directives: { tooltip: { mounted: () => undefined } },
				stubs: { ExtensionItemOptions: true },
				config: {
					compilerOptions: {
						isCustomElement: (tag: string) => tag.includes('-'),
					},
				},
			},
		})
			.find('.marketplace-link')
			.exists(),
	).toBe(linked);
});

test('toggles an entry of a code bundle through its bundle', async () => {
	const pinia = createTestingPinia({ createSpy: vi.fn });

	const extension = {
		id: 'bundle-id/chart',
		bundle: 'bundle-id',
		schema: { type: 'panel', name: 'chart' },
		meta: { enabled: true, folder: 'chart', source: 'module', bundle: 'bundle-id' },
	} as any;

	const wrapper = mount(ExtensionItem, {
		props: { extension, entryOfCodeBundle: true },
		global: {
			plugins: [i18n, pinia],
			directives: { tooltip: { mounted: () => undefined } },
			stubs: { ExtensionItemOptions: true },
			config: {
				compilerOptions: {
					isCustomElement: (tag: string) => tag.includes('-'),
				},
			},
		},
	});

	wrapper.findComponent({ name: 'ExtensionItemOptions' }).vm.$emit('toggle-state');
	await flushPromises();

	expect(useExtensionsStore(pinia).toggleEntryState).toHaveBeenCalledWith(extension);
	expect(useExtensionsStore(pinia).toggleState).not.toHaveBeenCalled();
});

test('marks the children of a code bundle as its entries', () => {
	const pinia = createTestingPinia({ createSpy: vi.fn });

	const wrapper = mount(ExtensionItem, {
		props: {
			extension: {
				id: 'bundle-id',
				bundle: null,
				schema: { type: 'bundle', entriesFrom: 'code', partial: true },
				meta: { enabled: true, folder: 'orders', source: 'module', bundle: null },
			} as any,
			children: [
				{
					id: 'bundle-id/chart',
					bundle: 'bundle-id',
					schema: { type: 'panel', name: 'chart' },
					meta: { enabled: true, folder: 'chart' },
				},
			] as any,
		},
		global: {
			plugins: [i18n, pinia],
			directives: { tooltip: { mounted: () => undefined } },
			stubs: { ExtensionItemOptions: true },
			config: {
				compilerOptions: {
					isCustomElement: (tag: string) => tag.includes('-'),
				},
			},
		},
	});

	expect(
		wrapper.findAllComponents(ExtensionItem)[0]!.props('entryOfCodeBundle'),
	).toBe(true);
});

test('shows a disabled code bundle as disabled whatever its entries', () => {
	const pinia = createTestingPinia({ createSpy: vi.fn });

	const wrapper = mount(ExtensionItem, {
		props: {
			extension: {
				id: 'bundle-id',
				bundle: null,
				schema: { type: 'bundle', entriesFrom: 'code', partial: true },
				meta: { enabled: false, folder: 'orders', source: 'module', bundle: null },
			} as any,
			children: [
				{
					id: 'bundle-id/chart',
					bundle: 'bundle-id',
					schema: { type: 'panel', name: 'chart' },
					meta: { enabled: true, folder: 'chart' },
				},
				{
					id: 'bundle-id/picker',
					bundle: 'bundle-id',
					schema: { type: 'interface', name: 'picker' },
					meta: { enabled: false, folder: 'picker' },
				},
			] as any,
		},
		global: {
			plugins: [i18n, pinia],
			directives: { tooltip: { mounted: () => undefined } },
			stubs: { ExtensionItemOptions: true },
			config: {
				compilerOptions: {
					isCustomElement: (tag: string) => tag.includes('-'),
				},
			},
		},
	});

	expect(
		wrapper.findComponent({ name: 'ExtensionItemOptions' }).props('state'),
	).toBe('disabled');
});
