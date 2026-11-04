import { expect, test, vi } from 'vitest';

vi.mock('@directus/env', () => ({ useEnv: () => ({}) }));
vi.mock('@directus/extensions-registry', () => ({}));

vi.mock('../extensions/index.js', () => {
	return {
		getExtensionManager: () => ({ getAppChunkHash: () => 'chunk-a' }),
	};
});

const updateEntry = vi.hoisted(() => vi.fn());

vi.mock('../services/extensions.js', () => {
	return {
		ExtensionsService: class {
			updateEntry = updateEntry;
		},
		ExtensionReadError: class {},
	};
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

test('updates an entry of a code bundle by its bundle and name', async () => {
	updateEntry.mockResolvedValue({ id: 'entry-id' });
	const res = { locals: {} } as any;
	const next = vi.fn();

	const entryLayer = router.stack.find((layer: any) => {
		return layer.route?.path.endsWith('/entries/:name') && layer.route.methods.patch;
	});

	await entryLayer!.route!.stack[1]!.handle(
		{
			params: { pk: 'bundle-id', name: 'picker' },
			body: { meta: { enabled: false } },
			accountability: { admin: true },
		} as any,
		res,
		next,
	);

	expect(updateEntry).toHaveBeenCalledWith('bundle-id', 'picker', {
		meta: { enabled: false },
	});

	expect(res.locals).toEqual({ payload: { data: { id: 'entry-id' } } });
	expect(next).toHaveBeenCalledWith();
});
