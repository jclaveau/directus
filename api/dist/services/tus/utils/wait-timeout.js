//#region src/services/tus/utils/wait-timeout.ts
function waitTimeout(timeout, signal) {
	return new Promise((resolve) => {
		const handler = setTimeout(() => {
			resolve(false);
		}, timeout);
		const abortListener = () => {
			clearTimeout(handler);
			signal.removeEventListener("abort", abortListener);
			resolve(false);
		};
		signal.addEventListener("abort", abortListener);
	});
}

//#endregion
export { waitTimeout };