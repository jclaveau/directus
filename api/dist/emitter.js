import { useLogger } from "./logger/index.js";
import database_default from "./database/index.js";
import ee2 from "eventemitter2";

//#region src/emitter.ts
var Emitter = class {
	filterEmitter;
	actionEmitter;
	initEmitter;
	constructor() {
		const emitterOptions = {
			wildcard: true,
			verboseMemoryLeak: true,
			delimiter: ".",
			ignoreErrors: true
		};
		this.filterEmitter = new ee2.EventEmitter2(emitterOptions);
		this.actionEmitter = new ee2.EventEmitter2(emitterOptions);
		this.initEmitter = new ee2.EventEmitter2(emitterOptions);
	}
	getDefaultContext() {
		return {
			database: database_default(),
			accountability: null,
			schema: null
		};
	}
	async emitFilter(event, payload, meta, context = null) {
		const eventListeners = (Array.isArray(event) ? event : [event]).map((event$1) => ({
			event: event$1,
			listeners: this.filterEmitter.listeners(event$1)
		}));
		let updatedPayload = payload;
		for (const { event: event$1, listeners } of eventListeners) for (const listener of listeners) {
			const result = await listener(updatedPayload, {
				event: event$1,
				...meta
			}, context ?? this.getDefaultContext());
			if (result !== void 0) updatedPayload = result;
		}
		return updatedPayload;
	}
	emitAction(event, meta, context = null) {
		const logger = useLogger();
		const events = Array.isArray(event) ? event : [event];
		for (const event$1 of events) this.actionEmitter.emitAsync(event$1, {
			event: event$1,
			...meta
		}, context ?? this.getDefaultContext()).catch((err) => {
			logger.warn(`An error was thrown while executing action "${event$1}"`);
			logger.warn(err);
		});
	}
	async emitInit(event, meta) {
		const logger = useLogger();
		try {
			await this.initEmitter.emitAsync(event, {
				event,
				...meta
			});
		} catch (err) {
			logger.warn(`An error was thrown while executing init "${event}"`);
			logger.warn(err);
		}
	}
	onFilter(event, handler) {
		this.filterEmitter.on(event, handler);
	}
	onAction(event, handler) {
		this.actionEmitter.on(event, handler);
	}
	onInit(event, handler) {
		this.initEmitter.on(event, handler);
	}
	offFilter(event, handler) {
		this.filterEmitter.off(event, handler);
	}
	offAction(event, handler) {
		this.actionEmitter.off(event, handler);
	}
	offInit(event, handler) {
		this.initEmitter.off(event, handler);
	}
	offAll() {
		this.filterEmitter.removeAllListeners();
		this.actionEmitter.removeAllListeners();
		this.initEmitter.removeAllListeners();
	}
};
const emitter = new Emitter();
const useEmitter = () => emitter;
var emitter_default = emitter;

//#endregion
export { Emitter, emitter_default as default, useEmitter };