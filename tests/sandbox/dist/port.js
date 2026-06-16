import requestPort, { portNumbers } from "get-port";

//#region src/port.ts
async function getPort(port) {
	if (port === void 0) return requestPort();
	else if (typeof port !== "object") return requestPort({ port: Number(port) });
	else return requestPort({ port: portNumbers(Number(port.min), Number(port.max)) });
}

//#endregion
export { getPort };