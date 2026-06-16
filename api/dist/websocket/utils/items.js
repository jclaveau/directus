import { getService } from "../../utils/get-service.js";
import { FieldsService } from "../../services/fields.js";
import { MetaService } from "../../services/meta.js";
import "../../services/index.js";
import { CollectionsService } from "../../services/collections.js";
import { InvalidPayloadError } from "@directus/errors";

//#region src/websocket/utils/items.ts
/**
* Get items from a collection using the appropriate service
*
* @param subscription Subscription object
* @param accountability Accountability object
* @param schema Schema object
* @param event Event data
* @returns the fetched items
*/
async function getPayload(subscription, accountability, schema, event) {
	const metaService = new MetaService({
		schema,
		accountability
	});
	const result = { event: event?.action ?? "init" };
	switch (subscription.collection) {
		case "directus_collections":
			result["data"] = await getCollectionPayload(subscription, accountability, schema, event);
			break;
		case "directus_fields":
			result["data"] = await getFieldsPayload(subscription, accountability, schema, event);
			break;
		case "directus_relations":
			result["data"] = event?.payload;
			break;
		case "directus_extensions": throw new InvalidPayloadError({ reason: "\"directus_extensions\" is currently not supported." });
		default:
			result["data"] = await getItemsPayload(subscription, accountability, schema, event);
			break;
	}
	const query = subscription.query ?? {};
	if ("meta" in query) result["meta"] = await metaService.getMetaForQuery(subscription.collection, query);
	return result;
}
/**
* Get collection items
*
* @param accountability Accountability object
* @param schema Schema object
* @param event Event data
* @returns the fetched collection data
*/
async function getCollectionPayload(subscription, accountability, schema, event) {
	const service = new CollectionsService({
		schema,
		accountability
	});
	if ("item" in subscription) if (event?.action === "delete") return subscription.item;
	else return await service.readOne(String(subscription.item));
	switch (event?.action) {
		case "create": return await service.readMany([String(event.key)]);
		case "update": return await service.readMany(event.keys.map((key) => String(key)));
		case "delete": return event.keys;
		case void 0:
		default: return await service.readByQuery();
	}
}
/**
* Get fields items
*
* @param accountability Accountability object
* @param schema Schema object
* @param event Event data
* @returns the fetched field data
*/
async function getFieldsPayload(subscription, accountability, schema, event) {
	const service = new FieldsService({
		schema,
		accountability
	});
	if ("item" in subscription) if (event?.action === "delete") return subscription.item;
	else return await service.readOne(subscription.collection, String(subscription.item));
	switch (event?.action) {
		case void 0: return await service.readAll();
		case "delete": return event.keys;
		default: return await service.readOne(event?.payload?.["collection"], event?.payload?.["field"]);
	}
}
/**
* Get items from a collection using the appropriate service
*
* @param subscription Subscription object
* @param accountability Accountability object
* @param schema Schema object
* @param event Event data
* @returns the fetched data
*/
async function getItemsPayload(subscription, accountability, schema, event) {
	const query = subscription.query ?? {};
	const service = getService(subscription.collection, {
		schema,
		accountability
	});
	if ("item" in subscription) if (event?.action === "delete") return subscription.item;
	else return await service.readOne(subscription.item, query);
	switch (event?.action) {
		case "create": return await service.readMany([event.key], query);
		case "update": return await service.readMany(event.keys, query);
		case "delete": return event.keys;
		case void 0:
		default: return await service.readByQuery(query);
	}
}

//#endregion
export { getCollectionPayload, getFieldsPayload, getItemsPayload, getPayload };