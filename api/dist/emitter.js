import { useLogger } from "./logger/index.js";
import database_default from "./database/index.js";
import { InvalidPayloadError } from "@directus/errors";
import { oneLine } from "@directus/utils";
import EventEmitter2 from "eventemitter2";

//#region src/emitter.ts
var Emitter = class {
	filterEmitter;
	lastFilterEmitter;
	actionEmitter;
	initEmitter;
	constructor() {
		const emitterOptions = {
			wildcard: true,
			verboseMemoryLeak: true,
			delimiter: ".",
			ignoreErrors: true
		};
		this.filterEmitter = new EventEmitter2(emitterOptions);
		this.lastFilterEmitter = new EventEmitter2(emitterOptions);
		this.actionEmitter = new EventEmitter2(emitterOptions);
		this.initEmitter = new EventEmitter2(emitterOptions);
	}
	getDefaultContext() {
		return {
			database: database_default(),
			accountability: null,
			schema: null
		};
	}
	async emitFilter(event, payload, meta, context = null) {
		const eventListeners = this.filterListenersOf(event);
		let updatedPayload = payload;
		for (const { event: event$1, listeners } of eventListeners) for (const listener of listeners) {
			const result = await listener(updatedPayload, {
				event: event$1,
				...meta,
				originalPayload: payload
			}, context ?? this.getDefaultContext());
			if (result !== void 0) updatedPayload = result;
		}
		return updatedPayload;
	}
	/**
	* Hand every filter of these events the rows a mutation already wrote. No
	* answer has a reader, so a filter answering anything is refused, naming the
	* event it listens on.
	*/
	async emitWrittenFilter(event, payload, meta, context) {
		const eventListeners = this.filterListenersOf(event);
		for (const { event: listenedEvent, listeners } of eventListeners) for (const listener of listeners) if (await listener(payload, {
			event: listenedEvent,
			...meta,
			originalPayload: payload
		}, context) !== void 0) throw new InvalidPayloadError({ reason: oneLine`
							A "${listenedEvent}" filter hook must return nothing: the rows are
							already written
						` });
	}
	/**
	* The filters of each event, then the last filters of each: a last filter
	* runs after every other filter of every event emitted, so it sees the
	* payload all of them left.
	*/
	filterListenersOf(event) {
		const events = Array.isArray(event) ? event : [event];
		const listenersOf = (filterEmitter) => {
			return events.map((event$1) => {
				return {
					event: event$1,
					listeners: filterEmitter.listeners(event$1)
				};
			});
		};
		return [...listenersOf(this.filterEmitter), ...listenersOf(this.lastFilterEmitter)];
	}
	hasFilterListeners(event) {
		return (Array.isArray(event) ? event : [event]).some((name) => {
			return this.filterEmitter.listeners(name).length > 0 || this.lastFilterEmitter.listeners(name).length > 0;
		});
	}
	hasActionListeners(event) {
		return (Array.isArray(event) ? event : [event]).some((name) => this.actionEmitter.listeners(name).length > 0);
	}
	async emitAction(event, meta, context = null) {
		const logger = useLogger();
		const events = Array.isArray(event) ? event : [event];
		await Promise.all(events.map((event$1) => this.actionEmitter.emitAsync(event$1, {
			event: event$1,
			...meta
		}, context ?? this.getDefaultContext()).catch((err) => {
			logger.warn(`An error was thrown while executing action "${event$1}"`);
			logger.warn(err);
		})));
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
	onFilter(event, handler, options) {
		if (options?.runsLast) {
			this.lastFilterEmitter.on(event, handler);
			return;
		}
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
		this.lastFilterEmitter.off(event, handler);
	}
	offAction(event, handler) {
		this.actionEmitter.off(event, handler);
	}
	offInit(event, handler) {
		this.initEmitter.off(event, handler);
	}
	offAll() {
		this.filterEmitter.removeAllListeners();
		this.lastFilterEmitter.removeAllListeners();
		this.actionEmitter.removeAllListeners();
		this.initEmitter.removeAllListeners();
	}
};
const emitter = new Emitter();
const useEmitter = () => emitter;
var emitter_default = emitter;

//#endregion
export { Emitter, emitter_default as default, useEmitter };