export function waitTimeout(timeout: number, signal: AbortSignal) { // bb-out-of-scope: #709 file storage
	return new Promise<boolean>((resolve) => {
		const handler = setTimeout(() => {
			resolve(false);
		}, timeout);

		const abortListener = () => {
			clearTimeout(handler);
			signal.removeEventListener('abort', abortListener);
			resolve(false);
		};

		signal.addEventListener('abort', abortListener);
	});
}
