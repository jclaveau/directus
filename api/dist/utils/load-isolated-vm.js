//#region src/utils/load-isolated-vm.ts
async function loadIsolatedVm() {
	return (await import("isolated-vm")).default;
}

//#endregion
export { loadIsolatedVm };