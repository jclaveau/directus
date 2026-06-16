import { useLogger } from "../../logger/index.js";
import { ClientMessage, TYPE } from "../../packages/types/dist/index.js";
import database_default from "../../database/index.js";
import { validateItemAccess } from "../../permissions/modules/validate-access/lib/validate-item-access.js";
import emitter_default from "../../emitter.js";
import { scheduleSynchronizedJob } from "../../utils/schedule.js";
import { getSchema } from "../../utils/get-schema.js";
import { SettingsService } from "../../services/settings.js";
import { getMessageType } from "../utils/message.js";
import { isFieldAllowed } from "../../utils/is-field-allowed.js";
import { IRRELEVANT_COLLECTIONS } from "./constants.js";
import { Messenger } from "./messenger.js";
import { verifyPermissions } from "./verify-permissions.js";
import { validateChanges } from "./payload-permissions.js";
import { RoomManager } from "./room.js";
import { useEnv } from "@directus/env";
import { ForbiddenError, InvalidPayloadError, ServiceUnavailableError } from "@directus/errors";
import { toArray } from "@directus/utils";
import { difference, intersection, isEmpty, upperFirst } from "lodash-es";

//#region src/websocket/collab/collab.ts
const env = useEnv();
const CLUSTER_CLEANUP_CRON = String(env["WEBSOCKETS_COLLAB_CLUSTER_CLEANUP_CRON"]);
const LOCAL_CLEANUP_INTERVAL = Number(env["WEBSOCKETS_COLLAB_LOCAL_CLEANUP_INTERVAL"]);
/**
* Handler responsible for subscriptions
*/
var CollabHandler = class {
	roomManager;
	messenger = new Messenger();
	enabled = false;
	initialized;
	initializePromise;
	settingsService;
	cleanupJob;
	cleanupInterval;
	busHandler;
	eventQueue = Promise.resolve();
	/**
	* Initialize the handler
	*/
	constructor() {
		this.roomManager = new RoomManager(this.messenger);
		this.initialized = this.initialize();
		this.bindWebSocket();
		this.startBackgroundJobs();
	}
	initialize(force = false) {
		if (this.initialized && !force) return this.initialized;
		if (this.initializePromise) return this.initializePromise;
		this.initializePromise = (async () => {
			try {
				if (!this.settingsService) this.settingsService = new SettingsService({ schema: await getSchema() });
				this.enabled = (await this.settingsService.readSingleton({ fields: ["collaborative_editing_enabled"] }))?.["collaborative_editing_enabled"] ?? false;
			} catch (err) {
				useLogger().error(err, "[Collab] Failed to initialize collaborative editing settings");
			} finally {
				this.initializePromise = void 0;
			}
		})();
		if (!this.initialized) this.initialized = this.initializePromise;
		return this.initializePromise;
	}
	bindWebSocket() {
		/**
		* Listen for all system events via bus to ensure once-only delivery and consistency across instances
		*
		* Local updates:
		* Service -> Emitter -> Hooks -> Bus -> CollabHandler -> Room -> Local Clients
		*
		* Remote updates:
		* Service (Node B) -> Emitter (Node B) -> Hooks (Node B) -> Bus -> CollabHandler (Node A) -> Room (Node A) -> Remote Clients
		*/
		this.busHandler = (event) => {
			this.eventQueue = this.eventQueue.then(async () => {
				if (event.collection === "directus_settings" && event.action === "update" && "collaborative_editing_enabled" in event.payload) {
					useLogger().debug(`[Collab] [Node ${this.messenger.uid}] Settings update via bus, triggering handler`);
					this.initialize(true).then(() => {
						if (!this.enabled) try {
							useLogger().debug(`[Collab] [Node ${this.messenger.uid}] Collaborative editing disabled, terminating all rooms`);
							this.roomManager.terminateAll();
						} catch (err) {
							useLogger().error(err, "[Collab] Collaborative editing disabling terminateAll failed");
						}
					}).catch((err) => {
						useLogger().error(err, "[Collab] Collaborative editing re-initialization failed");
					});
					return;
				}
				if (event.action === "create" || IRRELEVANT_COLLECTIONS.includes(event.collection)) return;
				if (event.action === "update" || event.action === "delete") {
					let keys = [];
					if (Array.isArray(event.keys)) keys = event.keys;
					else if (event.key) keys = [event.key];
					else if (event.payload && event.action === "delete") keys = toArray(event.payload);
					event.keys = keys;
					const roomsToUpdate = Object.values(this.roomManager.rooms).filter((room) => {
						if (room.version) return event.collection === "directus_versions" && keys.some((key) => String(key) === room.version);
						if (room.collection !== event.collection || event.collection === "directus_versions") return false;
						if (room.item === null) return true;
						return keys.some((key) => String(key) === String(room.item));
					});
					if (roomsToUpdate.length === 0) return;
					await Promise.all(roomsToUpdate.map(async (room) => {
						let relevantKeys;
						if (room.version) relevantKeys = [room.version];
						else if (room.item) relevantKeys = [room.item];
						else relevantKeys = keys;
						const singleKeyedEvent = {
							...event,
							keys: relevantKeys
						};
						if (event.action === "delete") await room.onDeleteHandler(singleKeyedEvent);
						else await room.onUpdateHandler(singleKeyedEvent);
					}));
				}
			}).catch((err) => {
				useLogger().error(err, `[Collab] Bus message processing failed for ${event.collection}/${event.action}`);
			});
		};
		this.messenger.messenger.subscribe("websocket.event", this.busHandler);
		emitter_default.onAction("websocket.connect", ({ client }) => {
			this.messenger.addClient(client);
		});
		emitter_default.onAction("websocket.message", async ({ client, message }) => {
			if (getMessageType(message) !== TYPE.COLLAB) return;
			try {
				await this.ensureEnabled();
			} catch (error$1) {
				if (error$1 instanceof ServiceUnavailableError && error$1.message.includes("Collaborative editing is disabled")) {
					this.messenger.handleError(client.uid, error$1, message.action);
					this.messenger.terminateClient(client.uid);
					return;
				}
				throw error$1;
			}
			const { data, error } = ClientMessage.safeParse(message);
			if (!data) {
				this.messenger.handleError(client.uid, new InvalidPayloadError({ reason: `Couldn't parse payload. ${error.message}` }));
				return;
			}
			try {
				await this[`on${upperFirst(data.action)}`](client, message);
			} catch (error$1) {
				this.messenger.handleError(client.uid, error$1, data?.action);
			}
		});
		emitter_default.onAction("websocket.error", ({ client }) => this.onLeave(client));
		emitter_default.onAction("websocket.close", ({ client }) => this.onLeave(client));
	}
	startBackgroundJobs() {
		this.cleanupJob = scheduleSynchronizedJob("collab", CLUSTER_CLEANUP_CRON, async () => {
			const { inactive } = await this.messenger.pruneDeadInstances();
			for (const roomUid of inactive.rooms) {
				const room = await this.roomManager.getRoom(roomUid);
				if (room) {
					for (const client of inactive.clients) if (await room.hasClient(client)) {
						useLogger().debug(`[Collab] Removing dead client ${client} from room ${roomUid}`);
						await room.leave(client);
					}
					if (await room.close()) this.roomManager.removeRoom(room.uid);
				}
			}
		});
		this.cleanupInterval = setInterval(async () => {
			try {
				const globalClients = await this.messenger.getGlobalClients();
				const invalidClients = difference((await this.roomManager.getLocalRoomClients()).map((client) => client.uid), globalClients);
				for (const client of invalidClients) {
					const rooms = await this.roomManager.getClientRooms(client);
					for (const room of rooms) {
						useLogger().debug(`[Collab] Removing invalid client ${client} from room ${room.getDisplayName()}`);
						await room.leave(client);
					}
				}
				await this.roomManager.cleanupRooms();
			} catch (err) {
				useLogger().error(err, "[Collab] Local cleanup interval failed");
			}
		}, LOCAL_CLEANUP_INTERVAL);
	}
	/**
	* Terminate the handler and stop background jobs
	*/
	async terminate() {
		await this.cleanupJob?.stop();
		if (this.cleanupInterval) clearInterval(this.cleanupInterval);
		if (this.busHandler) await this.messenger.messenger.unsubscribe("websocket.event", this.busHandler);
	}
	/**
	* Ensure collaborative editing is enabled and initialized
	*/
	async ensureEnabled() {
		await this.initialized;
		if (!this.enabled) throw new ServiceUnavailableError({
			reason: "Collaborative editing is disabled",
			service: "collab"
		});
	}
	/**
	* Join a collaborative editing room
	*/
	async onJoin(client, message) {
		if (client.accountability?.share) throw new ForbiddenError({ reason: "Collaborative editing is not supported for shares" });
		const schema = await getSchema();
		const db = database_default();
		try {
			const { accessAllowed } = await validateItemAccess({
				accountability: client.accountability,
				action: "read",
				collection: message.collection,
				primaryKeys: schema.collections[message.collection]?.singleton ? [] : [message.item]
			}, {
				knex: db,
				schema
			});
			if (!accessAllowed) throw new ForbiddenError();
			if (message.version) {
				const { accessAllowed: versionAccessAllowed } = await validateItemAccess({
					accountability: client.accountability,
					action: "read",
					collection: "directus_versions",
					primaryKeys: [message.version]
				}, {
					knex: db,
					schema
				});
				if (!versionAccessAllowed) throw new ForbiddenError();
			}
		} catch {
			throw new ForbiddenError({ reason: `No permission to access item or it does not exist` });
		}
		if (message.initialChanges) await validateChanges(message.initialChanges, message.collection, message.item, {
			knex: db,
			schema,
			accountability: client.accountability
		});
		await (await this.roomManager.createRoom(message.collection, message.item, message.version ?? null, message.initialChanges)).join(client, message.color);
	}
	/**
	* Leave a collaborative editing room
	*/
	async onLeave(client, message) {
		if (message?.room) {
			const room = await this.roomManager.getRoom(message.room);
			if (!room || !await room.hasClient(client.uid)) throw new ForbiddenError({ reason: `No access to room "${message.room}" or it does not exist` });
			await room.leave(client.uid);
		} else {
			const rooms = await this.roomManager.getClientRooms(client.uid);
			for (const room of rooms) await room.leave(client.uid);
		}
	}
	/**
	* Update a field value
	*/
	async onUpdate(client, message) {
		const knex = database_default();
		const schema = await getSchema();
		const room = await this.roomManager.getRoom(message.room);
		if (!room || !await room.hasClient(client.uid)) throw new ForbiddenError({ reason: `No access to room ${message.room} or room does not exist` });
		await this.checkFieldsAccess(client, room, message.field, "update", {
			knex,
			schema
		});
		let focus = await room.getFocusByUser(client.uid);
		if (message.changes !== void 0) {
			if (focus !== message.field) {
				await room.focus(client, message.field);
				focus = await room.getFocusByUser(client.uid);
			}
			if (!focus || focus !== message.field) throw new ForbiddenError({ reason: `Cannot update field ${message.field} without focusing on it first` });
			await validateChanges({ [message.field]: message.changes }, room.collection, room.item, {
				knex,
				schema,
				accountability: client.accountability
			});
			await room.update(client, { [message.field]: message.changes });
		} else {
			const currentFocuser = await room.getFocusByField(message.field);
			if (currentFocuser && currentFocuser !== client.uid) throw new ForbiddenError({ reason: `Field ${message.field} is already focused by another user` });
			await room.unset(client, message.field);
		}
	}
	/**
	* Update multiple field values
	*/
	async onUpdateAll(client, message) {
		if (isEmpty(message.changes)) return;
		const room = await this.roomManager.getRoom(message.room);
		if (!room || !await room.hasClient(client.uid)) throw new ForbiddenError({ reason: `No access to room ${message.room} or room does not exist` });
		const collection = room.collection;
		const knex = database_default();
		const schema = await getSchema();
		const fields = Object.keys(message.changes ?? {});
		for (const key of fields) {
			const focus = await room.getFocusByField(key);
			if (focus && focus !== client.uid) delete message.changes?.[key];
		}
		if (!isEmpty(message.changes)) {
			await validateChanges(message.changes, collection, room.item, {
				knex,
				schema,
				accountability: client.accountability
			});
			await room.update(client, message.changes);
		}
	}
	/**
	* Update focus state
	*/
	async onFocus(client, message) {
		const room = await this.roomManager.getRoom(message.room);
		if (!room || !await room.hasClient(client.uid)) throw new ForbiddenError({ reason: `No access to room ${message.room} or room does not exist` });
		if (message.field) await this.checkFieldsAccess(client, room, message.field, "focus on");
		if (!await room.focus(client, message.field ?? null)) throw new ForbiddenError({ reason: `Field ${message.field} is already focused by another user` });
	}
	/**
	* Discard specified changes in the room
	*/
	async onDiscard(client, message) {
		const room = await this.roomManager.getRoom(message.room);
		if (!room || !await room.hasClient(client.uid)) throw new ForbiddenError({ reason: `No access to room ${message.room} or room does not exist` });
		const knex = database_default();
		const schema = await getSchema();
		const allowedFields = await this.getAllowedFields(client, room, knex, schema);
		if (!allowedFields || allowedFields.length === 0) throw new ForbiddenError({ reason: `No permission to discard fields or item does not exist` });
		await room.discard(allowedFields);
	}
	/**
	* Verify field access for both READ and UPDATE permissions
	*/
	async checkFieldsAccess(client, room, fields, errorAction, options = {}) {
		const knex = options.knex ?? database_default();
		const schema = options.schema ?? await getSchema();
		const allowedFields = await this.getAllowedFields(client, room, knex, schema);
		const fieldsArray = Array.isArray(fields) ? fields : [fields];
		for (const field of fieldsArray) if (!!!schema.collections[room.collection]?.fields[field] || allowedFields && !isFieldAllowed(allowedFields, field)) throw new ForbiddenError({ reason: `No permission to ${errorAction} field ${field} or field does not exist` });
	}
	async getAllowedFields(client, room, knex, schema) {
		const [read, update] = await Promise.all([verifyPermissions(client.accountability, room.collection, room.item, "read", {
			knex,
			schema
		}), verifyPermissions(client.accountability, room.collection, room.item, "update", {
			knex,
			schema
		})]);
		if (read === null && update === null) return null;
		if (read === null) return update;
		if (update === null) return read;
		if (read.includes("*") && update.includes("*")) return ["*"];
		if (read.includes("*")) return update;
		if (update.includes("*")) return read;
		return intersection(read, update);
	}
};

//#endregion
export { CollabHandler };