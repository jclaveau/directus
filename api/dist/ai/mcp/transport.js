//#region src/ai/mcp/transport.ts
var DirectusTransport = class {
	res;
	onerror;
	onmessage;
	onclose;
	constructor(res) {
		this.res = res;
	}
	async start() {}
	async send(message) {
		this.res.json(message);
	}
	async close() {}
};

//#endregion
export { DirectusTransport };