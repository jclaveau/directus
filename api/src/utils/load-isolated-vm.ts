type IsolatedVm = typeof import('isolated-vm');

// Loaded on demand: the isolated-vm addon costs RSS in every process that loads it,
// which an instance that never runs a sandboxed extension or a script operation
// shouldn't pay. The module cache makes every call after the first one free.
export async function loadIsolatedVm(): Promise<IsolatedVm> {
	return (await import('isolated-vm')).default;
}
