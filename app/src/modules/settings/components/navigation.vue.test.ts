import { i18n } from '@/lang';
import { useServerStore } from '@/stores/server';
import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import { expect, test, vi } from 'vitest';
import SettingsNavigation from './navigation.vue';

const global = {
	config: {
		compilerOptions: { isCustomElement: (tag: string) => tag.includes('-') },
	},
};

test.each([
	{ marketplace: true, listed: true },
	{ marketplace: false, listed: false },
])('lists the Marketplace: $listed', ({ marketplace, listed }) => {
	const pinia = createTestingPinia({ createSpy: vi.fn });
	useServerStore(pinia).info.extensions = { limit: null, marketplace };

	expect(
		mount(SettingsNavigation, { global: { ...global, plugins: [i18n, pinia] } })
			.find('[to="/settings/marketplace"]')
			.exists(),
	).toBe(listed);
});
