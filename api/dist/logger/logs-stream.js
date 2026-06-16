import { useBus } from "../bus/lib/use-bus.js";
import "../bus/index.js";
import { Writable } from "stream";
import { nanoid } from "nanoid";

//#region src/logger/logs-stream.ts
const nodeId = nanoid(8);
var LogsStream = class extends Writable {
	messenger;
	pretty;
	constructor(pretty) {
		super({ objectMode: true });
		this.messenger = useBus();
		this.pretty = pretty;
	}
	_write(chunk, _encoding, callback) {
		if (!this.pretty) {
			this.messenger.publish("logs", `{"log":${chunk},"nodeId":"${nodeId}"}`);
			return callback();
		}
		const log = JSON.parse(chunk);
		if (this.pretty === "http" && log.req?.method && log.req?.url && log.res?.statusCode && log.responseTime) {
			this.messenger.publish("logs", JSON.stringify({
				log: {
					level: log["level"],
					time: log["time"],
					msg: `${log.req.method} ${log.req.url} ${log.res.statusCode} ${log.responseTime}ms`
				},
				nodeId
			}));
			return callback();
		}
		this.messenger.publish("logs", JSON.stringify({
			log: {
				level: log["level"],
				time: log["time"],
				msg: log["msg"]
			},
			nodeId
		}));
		callback();
	}
};

//#endregion
export { LogsStream };