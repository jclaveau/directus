import { i18n } from '@/lang';
import { useServerStore } from '@/stores/server';
import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import { expect, test, vi } from 'vitest';
import ExtensionItemOptions from './extension-item-options.vue';

function mountOptions(type: string, marketplace: boolean) {
	const pinia = createTestingPinia({ createSpy: vi.fn });
	useServerStore(pinia).info.extensions = { limit: null, marketplace };

	return mount(ExtensionItemOptions, {
		props: {
			extension: {
				id: 'extension-id',
				bundle: null,
				schema: null,
				meta: {
					enabled: true,
					folder: 'extension-id',
					source: 'registry',
					bundle: null,
				},
			} as any,
			type: type as any,
			state: 'enabled',
			stateLocked: false,
		},
		global: {
			plugins: [i18n, pinia],
			directives: {
				tooltip: {
					mounted: (el: any, binding: any) => {
						if (binding.value) {
							el.setAttribute('title', binding.value);
						}
					},
				},
			},
			config: {
				compilerOptions: { isCustomElement: (tag: string) => tag.includes('-') },
			},
		},
	});
}

test('locks the uninstall of a registry extension in production', () => {
	const uninstall = mountOptions('interface', false).find('.uninstall');

	expect(uninstall.attributes('disabled')).toBe('true');

	expect(uninstall.attributes('title')).toBe(
		'The Marketplace is disabled in production, where extensions change'
			+ ' only with a deploy',
	);
});

test('opens the uninstall of a registry extension outside production', () => {
	const uninstall = mountOptions('interface', true).find('.uninstall');

	expect(uninstall.attributes('disabled')).toBe('false');
	expect(uninstall.attributes('title')).toBeUndefined();
});

test('locks enabling or disabling an extension in production', () => {
	const toggle = mountOptions('interface', false).find('v-list-item[clickable]');

	expect(toggle.attributes('disabled')).toBe('true');

	expect(toggle.attributes('title')).toBe(
		'The Marketplace is disabled in production, where extensions change'
			+ ' only with a deploy',
	);
});

test('opens enabling or disabling an extension outside production', () => {
	const toggle = mountOptions('interface', true).find('v-list-item[clickable]');

	expect(toggle.attributes('disabled')).toBe('false');
	expect(toggle.attributes('title')).toBeUndefined();
});

test.each([
	{ marketplace: true, offered: true },
	{ marketplace: false, offered: false },
])('offers to reinstall a missing registry extension: $offered', ({
	marketplace,
	offered,
}) => {
	expect(
		mountOptions('missing', marketplace)
			.find('v-icon[name="download"]')
			.exists(),
	).toBe(offered);
});
