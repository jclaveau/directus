//#region src/ai/files/lib/fetch-provider.ts
const UPLOAD_TIMEOUT = 12e4;
async function fetchProvider(url, options, providerName) {
	let response;
	try {
		response = await fetch(url, {
			...options,
			signal: AbortSignal.timeout(UPLOAD_TIMEOUT)
		});
	} catch (error) {
		if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) throw new Error(`${providerName} upload timed out after ${UPLOAD_TIMEOUT / 1e3}s`);
		throw error;
	}
	if (!response.ok) {
		const text = await response.text().catch(() => `HTTP ${response.status}`);
		throw new Error(`${providerName} upload failed: ${text}`);
	}
	try {
		return await response.json();
	} catch (cause) {
		throw new Error(`${providerName} upload succeeded but returned invalid response`, { cause });
	}
}

//#endregion
export { fetchProvider };