import { useBus } from "../../bus/lib/use-bus.js";
import "../../bus/index.js";
import { getSchema } from "../../utils/get-schema.js";
import { getPayload } from "../../websocket/utils/items.js";
import { getQuery } from "./schema/parse-query.js";
import { EventEmitter, on } from "events";

//#region src/services/graphql/subscription.ts
const messages = createPubSub(new EventEmitter());
function bindPubSub() {
	useBus().subscribe("websocket.event", (message) => {
		messages.publish(`${message["collection"]}_mutated`, message);
	});
}
function createSubscriptionGenerator(gql, event) {
	return async function* (_x, _y, _z, request) {
		const fields = await parseFields(gql, request);
		const args = parseArguments(request);
		for await (const payload of messages.subscribe(event)) {
			const eventData = payload;
			if ("event" in args && eventData["action"] !== args["event"]) continue;
			const schema = await getSchema();
			const subscription = {
				collection: eventData["collection"],
				event: eventData["action"],
				query: { fields }
			};
			if (eventData["action"] === "delete") for (const key of eventData.keys) yield { [event]: {
				key,
				data: null,
				event: eventData["action"]
			} };
			if (eventData["action"] === "create") try {
				subscription.item = eventData["key"];
				const result = await getPayload(subscription, gql.accountability, schema, eventData);
				yield { [event]: {
					key: eventData["key"],
					data: result["data"],
					event: eventData["action"]
				} };
			} catch {}
			if (eventData["action"] === "update") for (const key of eventData["keys"]) try {
				subscription.item = key;
				const result = await getPayload(subscription, gql.accountability, schema, eventData);
				yield { [event]: {
					key,
					data: result["data"],
					event: eventData["action"]
				} };
			} catch {}
		}
	};
}
function createPubSub(emitter) {
	return {
		publish: (event, payload) => void emitter.emit(event, payload),
		subscribe: async function* (event) {
			const asyncIterator = on(emitter, event);
			for await (const [value] of asyncIterator) yield value;
		}
	};
}
async function parseFields(gql, request) {
	const dataSelections = (request.fieldNodes[0]?.selectionSet?.selections ?? []).reduce((result, selection) => {
		if (selection.kind === "Field" && selection.name.value === "data" && selection.selectionSet?.kind === "SelectionSet") return selection.selectionSet.selections;
		return result;
	}, []);
	const { fields } = await getQuery({}, gql.schema, dataSelections, request.variableValues, gql.accountability);
	return fields ?? [];
}
function parseArguments(request) {
	return (request.fieldNodes[0]?.arguments ?? []).reduce((result, current) => {
		if ("value" in current.value && typeof current.value.value === "string") result[current.name.value] = current.value.value;
		return result;
	}, {});
}

//#endregion
export { bindPubSub, createSubscriptionGenerator };