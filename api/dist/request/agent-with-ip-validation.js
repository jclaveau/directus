import { isDeniedIp } from "./is-denied-ip.js";
import { isIP } from "node:net";

//#region src/request/agent-with-ip-validation.ts
const deniedError = (domain) => /* @__PURE__ */ new Error(`Requested domain "${domain}" resolves to a denied IP address`);
/** Extends a HTTP agent with IP validation */
const agentWithIpValidation = (agent) => {
	const _agent = agent;
	const { createConnection } = _agent;
	_agent.createConnection = function(options, oncreate) {
		const { host } = options;
		if (!host) throw new Error("Request cannot be verified due to missing host");
		if (isIP(host) !== 0 && isDeniedIp(host)) throw deniedError(host);
		const socket = createConnection?.call(this, options, oncreate);
		if (!socket) throw new Error("Request cannot be verified due to lost socket");
		socket.on("lookup", (error, address) => {
			if (error || !isDeniedIp(address)) return;
			return socket.destroy(deniedError(host));
		});
		return socket;
	};
	return agent;
};

//#endregion
export { agentWithIpValidation };