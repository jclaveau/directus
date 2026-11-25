import { expect, test, vi } from 'vitest';

const { warn } = vi.hoisted(() => {
	return { warn: vi.fn() };
});

vi.mock('node:fs/promises', () => {
	return {
		readdir: vi.fn(async () => {
			return ['vue.Ab12Cd34.entry.js', 'index.html'];
		}),
	};
});

vi.mock('@directus/utils/node', () => {
	return { resolvePackage: vi.fn(() => '/app') };
});

vi.mock('../../logger/index.js', () => {
	return { useLogger: () => ({ warn }) };
});

const { getSharedDepsMapping } = await import('./get-shared-deps-mapping.js');

test('maps a shared dependency to its asset, warns of a missing one', async () => {
	expect(await getSharedDepsMapping(['vue', 'pinia'])).toEqual({
		vue: '/admin/assets/vue.Ab12Cd34.entry.js',
	});

	expect(warn).toHaveBeenCalledWith(
		'Couldn\'t find shared extension dependency "pinia"',
	);
});
