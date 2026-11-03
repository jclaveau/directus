import { i18n } from '@/lang';
import { useServerStore } from '@/stores/server';
import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
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
