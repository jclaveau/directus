import { useLogger } from "../../logger/index.js";
import { ACTION, COLORS, TYPE } from "../../packages/types/dist/index.js";
import database_default from "../../database/index.js";
import { getService } from "../../utils/get-service.js";
import { getSchema } from "../../utils/get-schema.js";
import { isFieldAllowed } from "../../utils/is-field-allowed.js";
import { useStore } from "./store.js";
import { Messenger } from "./messenger.js";
import { verifyPermissions } from "./verify-permissions.js";
import { sanitizePayload } from "./payload-permissions.js";
import { ErrorCode } from "@directus/errors";
import { isDetailedUpdateSyntax, isObject } from "@directus/utils";
import { isEqual, random, uniq } from "lodash-es";
import { createHash } from "crypto";

//#region src/websocket/collab/room.ts
/**
* Store and manage all active collaborative editing rooms
*/
var RoomManager = class {
	rooms = {};
	messenger;
	constructor(messenger = new Messenger()) {
		this.messenger = messenger;
	}
	/**
	* Create a new collaborative editing room or return an existing one matching collection, item and version.
	*/
	async createRoom(collection, item, version, initialChanges) {
		const uid = getRoomHash(collection, item, version);
		if (!(uid in this.rooms)) {
			const room = new Room(uid, collection, item, version, initialChanges, this.messenger);
			this.rooms[uid] = room;
			await room.ensureInitialized();
			await this.messenger.registerRoom(uid);
		}
		this.messenger.setRoomListener(uid, (message) => {
			if (message.action === "close") {
				this.rooms[uid]?.dispose();
				delete this.rooms[uid];
			}
		});
		return this.rooms[uid];
	}
	/**
	* Remove a room from local memory
	*/
	removeRoom(uid) {
		if (this.rooms[uid]) delete this.rooms[uid];
	}
	/**
	* Get an existing room by UID.
	* If the room is not part of the local rooms, it will be loaded from shared memory.
	* The room will not be persisted in local memory.
	*/
	async getRoom(uid) {
		let room = this.rooms[uid];
		if (!room) room = await useStore(uid)(async (store) => {
			if (!await store.has("uid")) return;
			const room$1 = new Room(uid, await store.get("collection"), await store.get("item"), await store.get("version"), await store.get("changes"), this.messenger);
			this.rooms[uid] = room$1;
			return room$1;
		});
		await room?.ensureInitialized();
		return room;
	}
	/**
	* Get all rooms a client is currently in from local memory
	*/
	async getClientRooms(uid) {
		const rooms = [];
		for (const room of Object.values(this.rooms)) if (await room.hasClient(uid)) rooms.push(room);
		return rooms;
	}
	/**
	* Returns all clients that are part of a room in the local memory
	*/
	async getLocalRoomClients() {
		return (await Promise.all(Object.values(this.rooms).map((room) => room.getClients()))).flat();
	}
	/**
	* Remove empty rooms from local memory
	*/
	async cleanupRooms(uids) {
		const rooms = uids ? uids.map((uid) => this.rooms[uid]).filter((room) => !!room) : Object.values(this.rooms);
		for (const room of rooms) if (await room.close()) {
			delete this.rooms[room.uid];
			useLogger().debug(`[Collab] Closed inactive room ${room.getDisplayName()}`);
		}
	}
	/**
	* Forcefully close all local rooms and notify clients.
	*/
	async terminateAll() {
		const rooms = Object.values(this.rooms);
		for (const room of rooms) {
			await room.close({
				force: true,
				reason: {
					type: TYPE.COLLAB,
					action: ACTION.SERVER.ERROR,
					code: ErrorCode.ServiceUnavailable,
					message: "Collaborative editing is disabled"
				},
				terminate: true
			});
			delete this.rooms[room.uid];
		}
		useLogger().debug(`[Collab] Forcefully closed all ${rooms.length} active rooms`);
	}
};
const roomDefaults = {
	changes: {},
	clients: [],
	focuses: {}
};
/**
* Represents a single collaborative editing room for a specific item
*/
var Room = class {
	uid;
	collection;
	item;
	version;
	initialChanges;
	messenger;
	store;
	onUpdateHandler;
	onDeleteHandler;
	constructor(uid, collection, item, version, initialChanges, messenger = new Messenger()) {
		this.uid = uid;
		this.collection = collection;
		this.item = item;
		this.version = version;
		this.initialChanges = initialChanges;
		this.messenger = messenger;
		this.store = useStore(uid, roomDefaults);
		this.onUpdateHandler = async (meta) => {
			const { keys } = meta;
			const target = this.version ?? this.item;
			if (target !== null && !keys.some((key) => String(key) === String(target))) return;
			try {
				const schema = await getSchema();
				const result = await (async () => {
					if (this.version) return (await getService("directus_versions", { schema }).readOne(this.version))["delta"] ?? {};
					const service = getService(collection, { schema });
					return item ? await service.readOne(item) : await service.readSingleton({});
				})();
				const clients = await this.store(async (store) => {
					let changes = await store.get("changes");
					changes = Object.fromEntries(Object.entries(changes).filter(([key, value]) => {
						if (isDetailedUpdateSyntax(value)) return false;
						if (!(key in result)) return !!this.version;
						if (isEqual(value, result[key])) return false;
						if (isObject(value)) {
							const relation = schema.relations.find((r) => r.collection === collection && r.field === key);
							if (relation) {
								const pkField = schema.collections[relation.related_collection]?.primary;
								if (pkField && isEqual(value[pkField], result[key])) return false;
							}
						}
						return true;
					}));
					await store.set("changes", changes);
					return await store.get("clients");
				});
				for (const client of clients) this.send(client.uid, { action: ACTION.SERVER.SAVE });
			} catch (err) {
				useLogger().error(err, `[Collab] External update handler failed for ${collection}/${item ?? "singleton"}`);
			}
		};
		this.onDeleteHandler = async (meta) => {
			try {
				const { keys, collection: eventCollection } = meta;
				const isVersionMatch = this.version && eventCollection === "directus_versions" && keys.some((key) => String(key) === this.version);
				const isItemMatch = eventCollection === collection && (item === null || keys.some((key) => String(key) === String(item)));
				if (!isVersionMatch && !isItemMatch) return;
				await this.sendAll({ action: ACTION.SERVER.DELETE });
				await this.close({ force: true });
			} catch (err) {
				useLogger().error(err, `[Collab] External delete handler failed for ${collection}/${item ?? "singleton"}`);
			}
		};
	}
	/**
	* Ensures that foundational room state (metadata) exists in shared memory even after restarts
	*/
	async ensureInitialized() {
		await this.store(async (store) => {
			if (await store.has("uid")) return;
			await store.set("uid", this.uid);
			await store.set("collection", this.collection);
			await store.set("item", this.item);
			await store.set("version", this.version);
			await store.set("changes", this.initialChanges ?? {});
			await store.set("clients", []);
			await store.set("focuses", {});
		});
	}
	getDisplayName() {
		return [
			this.collection,
			this.item,
			this.version
		].filter(Boolean).join(":");
	}
	async getClients() {
		return this.store((store) => store.get("clients"));
	}
	async getFocuses() {
		return this.store((store) => store.get("focuses"));
	}
	async getChanges() {
		return this.store((store) => store.get("changes"));
	}
	async hasClient(id) {
		return this.store(async (store) => {
			return (await store.get("clients")).findIndex((c) => c.uid === id) !== -1;
		});
	}
	async getFocusByUser(id) {
		return this.store(async (store) => (await store.get("focuses"))[id]);
	}
	async getFocusByField(field) {
		return this.store(async (store) => {
			const focuses = await store.get("focuses");
			return Object.entries(focuses).find(([_, f]) => f === field)?.[0];
		});
	}
	/**
	* Client requesting to join a room. If the client hasn't entered the room already, add a new client.
	* Otherwise all users just will be informed again that the user has joined.
	*/
	async join(client, color) {
		this.messenger.addClient(client);
		let added = false;
		let clientColor;
		if (!await this.hasClient(client.uid)) await this.store(async (store) => {
			const clients$1 = await store.get("clients");
			added = true;
			const existingColors = clients$1.map((c) => c.color);
			const colorsAvailable = COLORS.filter((color$1) => !existingColors.includes(color$1));
			if (colorsAvailable.length === 0) colorsAvailable.push(...COLORS);
			if (color && colorsAvailable.includes(color)) clientColor = color;
			else clientColor = colorsAvailable[random(colorsAvailable.length - 1)];
			clients$1.push({
				uid: client.uid,
				accountability: client.accountability,
				color: clientColor
			});
			await store.set("clients", clients$1);
		});
		if (added && clientColor) await this.sendExcluding({
			action: ACTION.SERVER.JOIN,
			user: client.accountability.user,
			connection: client.uid,
			color: clientColor
		}, client.uid);
		const { changes, focuses, clients } = await this.store(async (store) => {
			return {
				changes: await store.get("changes"),
				focuses: await store.get("focuses"),
				clients: await store.get("clients")
			};
		});
		const schema = await getSchema();
		const knex = database_default();
		const allowedFields = await verifyPermissions(client.accountability, this.collection, this.item, "read", {
			schema,
			knex
		});
		this.send(client.uid, {
			action: ACTION.SERVER.INIT,
			collection: this.collection,
			item: this.item,
			version: this.version,
			changes: await sanitizePayload(changes, this.collection, {
				accountability: client.accountability,
				schema,
				knex,
				itemId: this.item
			}),
			focuses: Object.fromEntries(Object.entries(focuses).filter(([_, field]) => allowedFields === null || isFieldAllowed(allowedFields, field))),
			connection: client.uid,
			users: Array.from(clients).map((client$1) => ({
				user: client$1.accountability.user,
				connection: client$1.uid,
				color: client$1.color
			}))
		});
	}
	/**
	* Leave the room
	*/
	async leave(uid) {
		await this.store(async (store) => {
			const clients = (await store.get("clients")).filter((c) => c.uid !== uid);
			await store.set("clients", clients);
			const focuses = await store.get("focuses");
			if (uid in focuses) {
				delete focuses[uid];
				await store.set("focuses", focuses);
			}
			if (clients.length === 0) await store.set("changes", {});
		});
		this.sendAll({
			action: ACTION.SERVER.LEAVE,
			connection: uid
		});
	}
	/**
	* Propagate an update to other clients
	*/
	async update(sender, changes) {
		const { clients } = await this.store(async (store) => {
			const existing_changes = await store.get("changes");
			Object.assign(existing_changes, changes);
			await store.set("changes", existing_changes);
			return { clients: await store.get("clients") };
		});
		const schema = await getSchema();
		const knex = database_default();
		for (const client of clients) {
			if (client.uid === sender.uid) continue;
			const sanitizedChanges = await sanitizePayload(changes, this.collection, {
				accountability: client.accountability,
				schema,
				knex,
				itemId: this.item
			}) || {};
			for (const field of Object.keys(changes)) if (field in sanitizedChanges) this.send(client.uid, {
				action: ACTION.SERVER.UPDATE,
				field,
				changes: sanitizedChanges[field]
			});
		}
	}
	/**
	* Propagate an unset to other clients
	*/
	async unset(sender, field) {
		const clients = await this.store(async (store) => {
			const changes = await store.get("changes");
			delete changes[field];
			await store.set("changes", changes);
			return await store.get("clients");
		});
		const schema = await getSchema();
		const knex = database_default();
		for (const client of clients) {
			if (client.uid === sender.uid) continue;
			const allowedFields = await verifyPermissions(client.accountability, this.collection, this.item, "read", {
				schema,
				knex
			});
			if (field && allowedFields !== null && !isFieldAllowed(allowedFields, field)) continue;
			this.send(client.uid, {
				action: ACTION.SERVER.DISCARD,
				fields: [field]
			});
		}
	}
	/**
	* Discard specified changes in the room and propagate to other clients
	*/
	async discard(fields) {
		if (fields.length === 0) return;
		const clients = await this.store(async (store) => {
			let changes = await store.get("changes");
			if (fields.includes("*")) changes = {};
			else for (const field of fields) delete changes[field];
			await store.set("changes", changes);
			return await store.get("clients");
		});
		const schema = await getSchema();
		const knex = database_default();
		for (const client of clients) {
			const allowedFields = await verifyPermissions(client.accountability, this.collection, this.item, "read", {
				schema,
				knex
			});
			const sendFields = [];
			if (fields.includes("*") && allowedFields?.includes("*")) sendFields.push("*");
			else if (fields.includes("*")) sendFields.push(...allowedFields ?? []);
			else for (const field of fields) if (allowedFields?.includes("*") || allowedFields?.includes(field)) sendFields.push(field);
			this.send(client.uid, {
				action: ACTION.SERVER.DISCARD,
				fields: uniq(sendFields)
			});
		}
	}
	/**
	* Atomically acquire or release focus and propagate focus state to other clients
	*/
	async focus(sender, field) {
		const result = await this.store(async (store) => {
			const focuses = await store.get("focuses");
			const clients = await store.get("clients");
			if (field === null) {
				const focusedField = focuses[sender.uid];
				delete focuses[sender.uid];
				await store.set("focuses", focuses);
				return {
					success: true,
					clients,
					focusedField
				};
			}
			const currentFocuser = Object.entries(focuses).find(([_, f]) => f === field)?.[0];
			if (currentFocuser && currentFocuser !== sender.uid) return { success: false };
			focuses[sender.uid] = field;
			await store.set("focuses", focuses);
			return {
				success: true,
				clients,
				focusedField: field
			};
		});
		if (!result.success) return false;
		const schema = await getSchema();
		const knex = database_default();
		for (const client of result.clients) {
			if (client.uid === sender.uid) continue;
			const allowedFields = await verifyPermissions(client.accountability, this.collection, this.item, "read", {
				schema,
				knex
			});
			if (result.focusedField && allowedFields !== null && !isFieldAllowed(allowedFields, result.focusedField)) continue;
			this.send(client.uid, {
				action: ACTION.SERVER.FOCUS,
				connection: sender.uid,
				field
			});
		}
		return true;
	}
	async sendAll(message) {
		for (const client of await this.getClients()) this.send(client.uid, message);
	}
	async sendExcluding(message, exclude) {
		for (const client of await this.getClients()) if (client.uid !== exclude) this.send(client.uid, message);
	}
	send(client, message) {
		this.messenger.sendClient(client, {
			...message,
			type: TYPE.COLLAB,
			room: this.uid
		});
	}
	/**
	* Close the room and clean up shared state
	*
	* @param options.force If true, close the room even if active clients are present
	* @param options.reason Optional reason to be sent to clients
	* @param options.terminate If true, forcefully terminate the client connection after closing
	*/
	async close(options = {}) {
		const { force = false, reason, terminate = false } = options;
		let roomClients = [];
		if (force) {
			roomClients = await this.getClients();
			for (const client of roomClients) if (this.messenger.hasClient(client.uid)) {
				if (reason) this.messenger.sendError(client.uid, reason);
				if (terminate) this.messenger.terminateClient(client.uid);
			}
		}
		const closed = await this.store(async (store) => {
			if (!force) {
				if ((await store.get("clients")).length > 0) return false;
			}
			if (!await store.has("uid")) return false;
			await store.delete("uid");
			await store.delete("collection");
			await store.delete("item");
			await store.delete("version");
			await store.delete("changes");
			await store.delete("clients");
			await store.delete("focuses");
			return true;
		});
		if (closed) {
			await this.messenger.unregisterRoom(this.uid);
			this.messenger.sendRoom(this.uid, { action: "close" });
			if (force) {
				for (const client of roomClients) if (!this.messenger.hasClient(client.uid)) {
					if (reason) this.messenger.sendError(client.uid, reason);
					if (terminate) this.messenger.terminateClient(client.uid);
				}
			}
		}
		if (closed || force) this.dispose();
		return closed;
	}
	dispose() {
		this.messenger.removeRoomListener(this.uid);
	}
};
function getRoomHash(collection, item, version) {
	return createHash("sha256").update([
		collection,
		item,
		version
	].join("-")).digest("hex");
}

//#endregion
export { Room, RoomManager, getRoomHash };