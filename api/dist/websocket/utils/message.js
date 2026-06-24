//#region src/websocket/utils/message.ts
const fmtMessage = (type, data = {}, uid) => {
	const message = {
		type,
		...data
	};
	if (uid !== void 0) message["uid"] = uid;
	return JSON.stringify(message);
};
const safeSend = async (client, data, delay = 100) => {
	if (client.readyState !== client.OPEN) return false;
	if (client.bufferedAmount > 0) return new Promise((resolve) => {
		setTimeout(() => {
			safeSend(client, data, delay).then((success) => resolve(success));
		}, delay);
	});
	client.send(data);
	return true;
};
function getMessageType(message) {
	return typeof message !== "object" || Array.isArray(message) || message === null ? "" : String(message.type);
}

//#endregion
export { fmtMessage, getMessageType, safeSend };