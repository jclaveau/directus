import { APP_SHARED_DEPS } from '@directus/extensions';
import { generateExtensionsEntrypoint, resolveModuleExtensions } from '@directus/extensions/node';
import yaml from '@rollup/plugin-yaml';
import UnheadVite from '@unhead/addons/vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { searchForWorkspaceRoot } from 'vite';
import { defineConfig } from 'vitest/config';
import vueDevtools from 'vite-plugin-vue-devtools';
import { VITEST_MAX_WORKERS } from '../vitest.max-workers.ts';

const API_PATH = path.join('..', 'api');

// https://vitejs.dev/config/
export default defineConfig({
	css: {
		preprocessorOptions: {
			scss: {
				api: 'modern-compiler',
			},
		},
	},
	plugins: [
		directusExtensions(),
		vue(),
		UnheadVite(),
		yaml({
			transform(data) {
				return data === null ? {} : undefined;
			},
		}),
		{
			name: 'watch-directus-dependencies',
			configureServer: (server) => {
				server.watcher.options = {
					...server.watcher.options,
					ignored: [/node_modules\/(?!@directus\/).*/, '**/.git/**'],
				};
			},
		},
		vueDevtools(),
	],
	define: {
		__VUE_I18N_LEGACY_API__: false,
	},
	resolve: {
		alias: [{ find: '@', replacement: path.resolve(import.meta.dirname, 'src') }],
	},
	base: process.env.NODE_ENV === 'production' ? '' : '/admin',
	...(!process.env.POVESTE && {
		server: {
			port: 8080,
			proxy: {
				'^/(?!admin)': {
					target: process.env.API_URL ? process.env.API_URL : 'http://127.0.0.1:8055/',
					changeOrigin: true,
				},
				'/websocket/logs': {
					target: process.env.API_URL ? process.env.API_URL : 'ws://127.0.0.1:8055/',
					changeOrigin: true,
				},
			},
			fs: {
				allow: [searchForWorkspaceRoot(process.cwd())],
			},
		},
	}),
	test: {
		maxWorkers: VITEST_MAX_WORKERS,
		environment: 'happy-dom',
		deps: {
			optimizer: {
				client: {
					exclude: ['pinia', 'url'],
				},
			},
		},
	},
});

function directusExtensions() {
	const virtualExtensionsId = '@directus-extensions';

	let extensionsEntrypoint = null;

	return [
		{
			name: 'directus-extensions-serve',
			apply: 'serve',
			config: () => ({
				optimizeDeps: {
					include: APP_SHARED_DEPS,
				},
			}),
			async buildStart() {
				await loadExtensions();
			},
			resolveId(id) {
				if (id === virtualExtensionsId) {
					return id;
				}
			},
			load(id) {
				if (id === virtualExtensionsId) {
					return extensionsEntrypoint;
				}
			},
		},
		{
			name: 'directus-extensions-build',
			apply: 'build',
			config: () => ({
				build: {
					rollupOptions: {
						input: {
							index: path.resolve(import.meta.dirname, 'index.html'),
							...APP_SHARED_DEPS.reduce((acc, dep) => ({ ...acc, [dep.replace(/\//g, '_')]: dep }), {}),
						},
						output: {
							entryFileNames: 'assets/[name].[hash].entry.js',
						},
						external: [virtualExtensionsId],
						preserveEntrySignatures: 'exports-only',
					},
				},
			}),
		},
	];

	async function loadExtensions() {
		const moduleExtensions = await resolveModuleExtensions(API_PATH);

		const mockSetting = (source, folder, extension) => {
			const settings = [
				{
					id: extension.name,
					enabled: true,
					folder: folder,
					bundle: null,
					source: source,
				},
			];

			if (extension.type === 'bundle') {
				settings.push(
					...extension.entries.map((entry) => ({
						enabled: true,
						folder: entry.name,
						bundle: extension.name,
						source: source,
					})),
				);
			}

			return settings;
		};

		// default to enabled for app extension in developer mode
		const extensionSettings = [
			...Array.from(moduleExtensions.entries()).flatMap(([folder, extension]) =>
				mockSetting('module', folder, extension),
			),
		];

		extensionsEntrypoint = generateExtensionsEntrypoint(
			{ module: moduleExtensions },
			extensionSettings,
		);
	}
}
