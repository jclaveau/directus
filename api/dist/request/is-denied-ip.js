import { useLogger } from "../logger/index.js";
import { useEnv } from "@directus/env";
import { IpBlocklist } from "@directus/utils/node";

//#region src/request/is-denied-ip.ts
function isDeniedIp(ip) {
	const env = useEnv();
	const logger = useLogger();
	const ipDenyList = env["IMPORT_IP_DENY_LIST"];
	if (ipDenyList.length === 0) return false;
	const blockList = new IpBlocklist();
	let blockNetworkInterfaces = false;
	try {
		for (const blockNetworkRaw of ipDenyList) {
			const blockNetwork = blockNetworkRaw.trim();
			if (blockNetwork === "0.0.0.0") {
				blockNetworkInterfaces = true;
				blockList.parseSubnet("0.0.0.0/8");
				blockList.parseAddress("::");
				continue;
			}
			if (blockNetwork.includes("-")) {
				blockList.parseRange(blockNetwork);
				continue;
			}
			if (blockNetwork.includes("/")) {
				blockList.parseSubnet(blockNetwork);
				continue;
			}
			blockList.parseAddress(blockNetwork);
		}
		if (blockNetworkInterfaces) blockList.addLocalNetworkInterfaces();
	} catch (error) {
		logger.warn(`Cannot verify IP address due to invalid "IMPORT_IP_DENY_LIST" config`);
		logger.warn(error);
		return true;
	}
	return blockList.checkAddress(ip);
}

//#endregion
export { isDeniedIp };