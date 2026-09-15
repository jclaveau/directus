import { expect, test } from 'vitest';
import { loadIsolatedVm } from './load-isolated-vm.js';

test('resolves the addon rather than the module namespace around it', async () => {
	const ivm = await loadIsolatedVm();

	expect(typeof ivm.Isolate).toBe('function');
});

test('hands back the cached module on a second call', async () => {
	expect(await loadIsolatedVm()).toBe(await loadIsolatedVm());
});
