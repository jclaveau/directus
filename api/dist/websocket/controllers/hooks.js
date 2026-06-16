import { useBus } from "../../bus/lib/use-bus.js";
import "../../bus/index.js";
import emitter_default from "../../emitter.js";
import { systemCollectionNames } from "@directus/system-data";

//#region src/websocket/controllers/hooks.ts
let actionsRegistered = false;
function registerWebSocketEvents() {
	if (actionsRegistered) return;
	actionsRegistered = true;
	registerActionHooks(["items", ...systemCollectionNames.filter((collection) => ![
		"directus_migrations",
		"directus_fields",
		"directus_relations",
		"directus_files",
		"directus_sessions"
	].includes(collection)).map((collection) => collection.replace("directus_", ""))]);
	registerFieldsHooks();
	registerFilesHooks();
	registerRelationsHooks();
	registerSortHooks();
}
function registerActionHooks(modules) {
	for (const module of modules) {
		registerAction(module + ".create", ({ key, collection, payload = {} }) => ({
			collection,
			action: "create",
			key,
			payload
		}));
		registerAction(module + ".update", ({ keys, collection, payload = {} }) => ({
			collection,
			action: "update",
			keys,
			payload
		}));
		registerAction(module + ".delete", ({ keys, collection, payload = [] }) => ({
			collection,
			action: "delete",
			keys,
			payload
		}));
	}
}
function registerFieldsHooks() {
	registerAction("fields.create", ({ key, payload = {} }) => ({
		collection: "directus_fields",
		action: "create",
		key,
		payload
	}));
	registerAction("fields.update", ({ keys, payload = {} }) => ({
		collection: "directus_fields",
		action: "update",
		keys,
		payload
	}));
	registerAction("fields.delete", ({ keys, payload = [] }) => ({
		collection: "directus_fields",
		action: "delete",
		keys,
		payload
	}));
}
function registerFilesHooks() {
	registerAction("files.upload", ({ key, collection, payload = {} }) => ({
		collection,
		action: "create",
		key,
		payload
	}));
	registerAction("files.update", ({ keys, collection, payload = {} }) => ({
		collection,
		action: "update",
		keys,
		payload
	}));
	registerAction("files.delete", ({ keys, collection, payload = [] }) => ({
		collection,
		action: "delete",
		keys,
		payload
	}));
}
function registerRelationsHooks() {
	registerAction("relations.create", ({ key, payload = {} }) => ({
		collection: "directus_relations",
		action: "create",
		key,
		payload: {
			...payload,
			key
		}
	}));
	registerAction("relations.update", ({ keys, payload = {} }) => ({
		collection: "directus_relations",
		action: "update",
		keys,
		payload
	}));
	registerAction("relations.delete", ({ collection, payload = [] }) => ({
		collection: "directus_relations",
		action: "delete",
		keys: payload,
		payload: {
			collection,
			fields: payload
		}
	}));
}
function registerSortHooks() {
	registerAction("items.sort", ({ collection, item }) => ({
		collection,
		action: "update",
		keys: [item],
		payload: {}
	}));
}
/**
* Wrapper for emitter.onAction to hook into system events
* @param event The action event to watch
* @param transform Transformer function
*/
function registerAction(event, transform) {
	const messenger = useBus();
	emitter_default.onAction(event, (data) => {
		messenger.publish("websocket.event", transform(data));
	});
}

//#endregion
export { registerWebSocketEvents };