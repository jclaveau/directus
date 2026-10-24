import { useEnv } from "@directus/env";

//#region src/utils/get-address.ts
function getAddress(server) {
	const env = useEnv();
	const address = server.address();
	if (address === null) {
		if (env["UNIX_SOCKET_PATH"]) return env["UNIX_SOCKET_PATH"];
		return `${env["HOST"]}:${env["PORT"]}`;
	}
	if (typeof address === "string") return address;
	return `${address.address}:${address.port}`;
}

//#endregion
export { getAddress };