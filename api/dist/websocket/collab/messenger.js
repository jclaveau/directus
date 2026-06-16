import { useBus } from "../../bus/lib/use-bus.js";
import "../../bus/index.js";
import { useLogger } from "../../logger/index.js";
import { COLLAB_BUS, TYPE } from "../../packages/types/dist/index.js";
import { useStore } from "./store.js";
import { useEnv } from "@directus/env";
import { isDirectusError } from "@directus/errors";
import { randomUUID } from "crypto";

//#region src/websocket/collab/messenger.ts
const env = useEnv();
const INSTANCE_TIMEOUT = Number(env["WEBSOCKETS_COLLAB_INSTANCE_TIMEOUT"]);
var Messenger = class {
	uid;
	store;
	clients = {};
	orders = {};
	messenger = useBus();
	roomListeners = {};
	constructor() {
		this.uid = randomUUID();
		this.store = useStore("registry", { instances: {} });
		this.store(async (store) => {
			const instances = await store.get("instances");
			instances[this.uid] = {
				clients: [],
				rooms: []
			};
			await store.set("instances", instances);
		}).catch((err) => {
			useLogger().error(err, "[Collab] Failed to register instance in registry");
		});
		this.messenger.subscribe(COLLAB_BUS, (message) => {
			if (message.type === "send") {
				const client = this.clients[message.client];
				if (client) {
					const order = this.orders[client.uid] ?? 0;
					this.orders[client.uid] = order + 1;
					client.send(JSON.stringify({
						...message.message,
						order
					}));
				}
			} else if (message.type === "error") {
				const client = this.clients[message.client];
				if (client) client.send(JSON.stringify(message.message));
			} else if (message.type === "terminate") this.clients[message.client]?.close();
			else if (message.type === "room") this.roomListeners[message.room]?.(message);
			else if (message.type === "ping" && message.instance === this.uid) this.messenger.publish(COLLAB_BUS, {
				type: "pong",
				instance: this.uid
			});
		});
	}
	hasClient(client) {
		return client in this.clients;
	}
	setRoomListener(room, callback) {
		this.roomListeners[room] = callback;
	}
	removeRoomListener(room) {
		delete this.roomListeners[room];
	}
	addClient(client) {
		if (client.uid in this.clients) return;
		this.clients[client.uid] = client;
		this.orders[client.uid] = 0;
		this.store(async (store) => {
			const instances = await store.get("instances");
			if (!instances[this.uid]) instances[this.uid] = {
				clients: [],
				rooms: []
			};
			instances[this.uid].clients = [...instances[this.uid].clients ?? [], client.uid];
			await store.set("instances", instances);
		}).catch((err) => {
			useLogger().error(err, `[Collab] Failed to add client ${client.uid} to registry`);
		});
		client.on("close", () => {
			this.removeClient(client.uid);
		});
	}
	removeClient(uid) {
		delete this.clients[uid];
		delete this.orders[uid];
		this.store(async (store) => {
			const instances = await store.get("instances");
			if (instances[this.uid]) {
				instances[this.uid].clients = (instances[this.uid].clients ?? []).filter((clientId) => clientId !== uid);
				await store.set("instances", instances);
			}
		}).catch((err) => {
			useLogger().error(err, `[Collab] Failed to remove client ${uid} from registry`);
		});
	}
	async registerRoom(uid) {
		await this.store(async (store) => {
			const instances = await store.get("instances");
			if (!instances[this.uid]) instances[this.uid] = {
				clients: [],
				rooms: []
			};
			if (!instances[this.uid].rooms.includes(uid)) {
				instances[this.uid].rooms.push(uid);
				await store.set("instances", instances);
			}
		});
	}
	async unregisterRoom(uid) {
		await this.store(async (store) => {
			const instances = await store.get("instances");
			if (instances[this.uid]) {
				instances[this.uid].rooms = (instances[this.uid].rooms ?? []).filter((roomUid) => roomUid !== uid);
				await store.set("instances", instances);
			}
		});
	}
	async getLocalClients() {
		return Object.keys(this.clients);
	}
	async getGlobalClients() {
		const instances = await this.store(async (store) => await store.get("instances"));
		return Object.values(instances).map((instance) => instance.clients).flat();
	}
	async pruneDeadInstances() {
		const instances = await this.store(async (store) => await store.get("instances"));
		const inactiveInstances = new Set(Object.keys(instances));
		inactiveInstances.delete(this.uid);
		const pongCollector = (message) => {
			if (message.type === "pong") inactiveInstances.delete(message.instance);
		};
		this.messenger.subscribe(COLLAB_BUS, pongCollector);
		for (const instance of inactiveInstances) this.messenger.publish(COLLAB_BUS, {
			type: "ping",
			instance
		});
		await new Promise((resolve) => {
			setTimeout(resolve, INSTANCE_TIMEOUT);
		});
		this.messenger.unsubscribe(COLLAB_BUS, pongCollector);
		const dead = {
			clients: [],
			rooms: []
		};
		if (inactiveInstances.size === 0) return {
			inactive: dead,
			active: Object.values(instances).map((instance) => instance.clients).flat()
		};
		const current = await this.store(async (store) => {
			const current$1 = await store.get("instances");
			let changed = false;
			for (const deadId of inactiveInstances) if (current$1[deadId]) {
				dead.clients.push(...current$1[deadId].clients ?? []);
				dead.rooms.push(...current$1[deadId].rooms ?? []);
				delete current$1[deadId];
				changed = true;
			}
			if (changed) await store.set("instances", current$1);
			return current$1;
		});
		return {
			inactive: dead,
			active: Object.values(current).map((instance) => instance.clients).flat()
		};
	}
	sendRoom(room, message) {
		this.messenger.publish(COLLAB_BUS, {
			type: "room",
			room,
			...message
		});
	}
	sendClient(client, message) {
		const localClient = this.clients[client];
		if (localClient) {
			const order = this.orders[client] ?? 0;
			this.orders[client] = order + 1;
			localClient.send(JSON.stringify({
				...message,
				order
			}));
		} else this.messenger.publish(COLLAB_BUS, {
			type: "send",
			client,
			message
		});
	}
	terminateClient(client) {
		const localClient = this.clients[client];
		if (localClient) setTimeout(() => {
			localClient.close();
		}, 250);
		else this.messenger.publish(COLLAB_BUS, {
			type: "terminate",
			client
		});
	}
	sendError(client, error) {
		const localClient = this.clients[client];
		if (localClient) localClient.send(JSON.stringify(error));
		else this.messenger.publish(COLLAB_BUS, {
			type: "error",
			client,
			message: error
		});
	}
	handleError(client, error, action) {
		let message;
		if (isDirectusError(error)) message = {
			action: "error",
			type: TYPE.COLLAB,
			code: error.code,
			trigger: action,
			message: error.message
		};
		else {
			useLogger().error(`WebSocket unhandled exception ${JSON.stringify({
				type: TYPE.COLLAB,
				error
			})}`);
			return;
		}
		this.sendError(client, message);
	}
};

//#endregion
export { Messenger };