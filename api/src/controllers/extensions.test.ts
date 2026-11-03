import { expect, test, vi } from 'vitest';

vi.mock('@directus/env', () => ({ useEnv: () => ({}) }));
vi.mock('@directus/extensions-registry', () => ({}));

vi.mock('../extensions/index.js', () => {
	return {
		getExtensionManager: () => ({ getAppChunkHash: () => 'chunk-a' }),
	};
});

vi.mock('../services/extensions.js', () => {
	return { ExtensionsService: vi.fn(), ExtensionReadError: class {} };
});

vi.mock('../middleware/respond.js', () => ({ respond: vi.fn() }));

const { default: router } = await import('./extensions.js');

test('serves the app chunk hash past the response cache', async () => {
	const res = { locals: {} } as any;
	const next = vi.fn();

	const appChunkLayer = router.stack.find(
		(layer: any) => layer.route?.path === '/app-chunk',
	);

	await appChunkLayer!.route!.stack[0]!.handle({} as any, res, next);

	expect(res.locals).toEqual({
		cache: false,
		payload: { data: { chunk: 'chunk-a' } },
	});
});
