import { HstVue } from '@poveste/plugin-vue';
import { defineConfig } from 'poveste';

export default defineConfig({
	plugins: [HstVue()],
	setupFile: './src/__poveste__/setup.ts',
	theme: {
		title: 'Directus Components',
		favicon: './public/favicon.ico',
		logo: {
			light: './src/assets/logo-dark.svg',
			dark: './src/assets/logo.svg',
		},
		logoHref: 'https://directus.io',
		colors: {
			primary: {
				50: '#fcfcff',
				100: '#ece7ff',
				200: '#cabeff',
				300: '#a996ff',
				400: '#876dff',
				500: '#6644ff',
				600: '#380cff',
				700: '#2600d3',
				800: '#1c009b',
				900: '#120063',
			},
		},
	},
	backgroundPresets: [],
	viteIgnorePlugins: ['directus-extensions-serve', 'directus-extensions-build'],
	viteNodeInlineDeps: [/@joeattardi\/emoji-button/],
	vite: {
		base: '/',
		// vue-i18n's ESM build reads these as compile-time flags. The app's vite config
		// defines only the legacy one, which a bundle can live with but the module
		// runner that collects stories cannot.
		define: {
			__VUE_I18N_FULL_INSTALL__: true,
			__VUE_I18N_LEGACY_API__: false,
			__INTLIFY_PROD_DEVTOOLS__: false,
		},
	},
});
