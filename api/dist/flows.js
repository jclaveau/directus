import { pick } from "./utils/lodash-es-used.js";
import { useLogger } from "./logger/index.js";
import { useBus } from "./bus/lib/use-bus.js";
import "./bus/index.js";
import database_default from "./database/index.js";
import emitter_default from "./emitter.js";
import { fetchPolicies } from "./permissions/lib/fetch-policies.js";
import { fetchPermissions } from "./permissions/lib/fetch-permissions.js";
import { ActivityService } from "./services/activity.js";
import { createScopedCacheExtensionHandle } from "./extensions/lib/scoped-cache-handle.js";
import { scheduleSynchronizedJob, validateCron } from "./utils/schedule.js";
import { getSchema } from "./utils/get-schema.js";
import { FlowsService } from "./services/flows.js";
import { RevisionsService } from "./services/revisions.js";
import { constructFlowTree } from "./utils/construct-flow-tree.js";
import { JobQueue } from "./utils/job-queue.js";
import { redactObject } from "./utils/redact-object.js";
import { services_exports } from "./services/index.js";
import { getService } from "./utils/get-service.js";
import { useEnv } from "@directus/env";
import { ForbiddenError } from "@directus/errors";
import { applyOptionsData, deepMap, getRedactedString, isValidJSON, parseJSON, toArray } from "@directus/utils";
import { Action } from "@directus/constants";
import { isSystemCollection } from "@directus/system-data";
import { get } from "micromustache";

//#region src/flows.ts
let flowManager;
function getFlowManager() {
	if (flowManager) return flowManager;
	flowManager = new FlowManager();
	return flowManager;
}
const TRIGGER_KEY = "$trigger";
const ACCOUNTABILITY_KEY = "$accountability";
const LAST_KEY = "$last";
const ENV_KEY = "$env";
function flowEventRoutes(flowOptions) {
	if (!flowOptions["scope"]) return [];
	return toArray(flowOptions["scope"]).flatMap((scope) => {
		if (![
			"items.create",
			"items.update",
			"items.delete"
		].includes(scope)) return [{
			eventName: scope,
			triggerEvent: scope,
			payloadShape: "row"
		}];
		if (!flowOptions["collections"]) return [];
		return toArray(flowOptions["collections"]).flatMap((collection) => {
			return collectionEventRoutes(scope, collection);
		});
	});
}
function collectionEventRoutes(scope, collection) {
	const triggerEvent = isSystemCollection(collection) ? `${collection.substring(9)}.${scope.split(".")[1]}` : `${collection}.${scope}`;
	if (scope === "items.update") return [{
		eventName: triggerEvent,
		triggerEvent,
		payloadShape: "update-groups"
	}];
	if (scope === "items.delete") return [{
		eventName: triggerEvent,
		triggerEvent,
		payloadShape: "row"
	}];
	const rowRoute = {
		eventName: `${triggerEvent}.one`,
		triggerEvent,
		payloadShape: "row"
	};
	if (!isSystemCollection(collection)) return [rowRoute];
	return [rowRoute, {
		eventName: triggerEvent,
		triggerEvent,
		payloadShape: "service-create"
	}];
}
var FlowManager = class {
	isLoaded = false;
	operations = /* @__PURE__ */ new Map();
	triggerHandlers = [];
	operationFlowHandlers = {};
	webhookFlowHandlers = {};
	reloadQueue;
	envs;
	constructor() {
		const env = useEnv();
		const logger = useLogger();
		this.reloadQueue = new JobQueue();
		this.envs = env["FLOWS_ENV_ALLOW_LIST"] ? pick(env, toArray(env["FLOWS_ENV_ALLOW_LIST"])) : {};
		useBus().subscribe("flows", (event) => {
			if (event["type"] === "reload") this.reloadQueue.enqueue(async () => {
				if (this.isLoaded) {
					await this.unload();
					await this.load();
				} else logger.warn("Flows have to be loaded before they can be reloaded");
			});
		});
	}
	async initialize() {
		if (!this.isLoaded) await this.load();
	}
	async reload() {
		useBus().publish("flows", { type: "reload" });
	}
	addOperation(id, operation) {
		this.operations.set(id, operation);
	}
	removeOperation(id) {
		this.operations.delete(id);
	}
	async runOperationFlow(id, data, context) {
		const logger = useLogger();
		if (!(id in this.operationFlowHandlers)) {
			logger.warn(`Couldn't find operation triggered flow with id "${id}"`);
			return null;
		}
		const handler = this.operationFlowHandlers[id];
		return handler(data, context);
	}
	async runWebhookFlow(id, data, context) {
		const logger = useLogger();
		if (!(id in this.webhookFlowHandlers)) {
			logger.warn(`Couldn't find webhook or manual triggered flow with id "${id}"`);
			throw new ForbiddenError();
		}
		const handler = this.webhookFlowHandlers[id];
		return handler(data, context);
	}
	async load() {
		const logger = useLogger();
		const flowTrees = (await new FlowsService({
			knex: database_default(),
			schema: await getSchema()
		}).readByQuery({
			filter: { status: { _eq: "active" } },
			fields: ["*", "operations.*"],
			limit: -1
		})).map((flow) => constructFlowTree(flow));
		for (const flow of flowTrees) if (flow.trigger === "event") {
			if (flow.options["type"] === "filter") {
				const handlers = flowEventRoutes(flow.options).map((route) => {
					return {
						type: "filter",
						name: route.eventName,
						handler: this.filterFlowHandler(flow, route)
					};
				});
				handlers.forEach(({ name, handler }) => emitter_default.onFilter(name, handler));
				this.triggerHandlers.push({
					id: flow.id,
					events: handlers
				});
			} else if (flow.options["type"] === "action") {
				const handlers = flowEventRoutes(flow.options).map((route) => {
					return {
						type: "action",
						name: route.eventName,
						handler: this.actionFlowHandler(flow, route)
					};
				});
				handlers.forEach(({ name, handler }) => emitter_default.onAction(name, handler));
				this.triggerHandlers.push({
					id: flow.id,
					events: handlers
				});
			}
		} else if (flow.trigger === "schedule") if (validateCron(flow.options["cron"])) {
			const job = scheduleSynchronizedJob(flow.id, flow.options["cron"], async () => {
				try {
					await this.executeFlow(flow);
				} catch (error) {
					logger.error(error);
				}
			});
			this.triggerHandlers.push({
				id: flow.id,
				events: [{
					type: flow.trigger,
					job
				}]
			});
		} else logger.warn(`Couldn't register cron trigger. Provided cron is invalid: ${flow.options["cron"]}`);
		else if (flow.trigger === "operation") {
			const handler = (data, context) => this.executeFlow(flow, data, context);
			this.operationFlowHandlers[flow.id] = handler;
		} else if (flow.trigger === "webhook") {
			const method = flow.options?.["method"] ?? "GET";
			const handler = async (data, context) => {
				let cacheEnabled = true;
				if (method === "GET") cacheEnabled = flow.options["cacheEnabled"] !== false;
				if (flow.options["async"]) {
					this.executeFlow(flow, data, context);
					return {
						result: void 0,
						cacheEnabled
					};
				} else return {
					result: await this.executeFlow(flow, data, context),
					cacheEnabled
				};
			};
			flow.options["return"] = flow.options["return"] ?? "$last";
			this.webhookFlowHandlers[`${method}-${flow.id}`] = handler;
		} else if (flow.trigger === "manual") {
			const handler = async (data, context) => {
				const enabledCollections = flow.options?.["collections"] ?? [];
				const requireSelection = flow.options?.["requireSelection"] ?? true;
				const targetCollection = data?.["body"].collection;
				const targetKeys = data?.["body"].keys;
				if (!targetCollection) {
					logger.warn(`Manual trigger requires "collection" to be specified in the payload`);
					throw new ForbiddenError();
				}
				if (enabledCollections.length === 0) {
					logger.warn(`There is no collections configured for this manual trigger`);
					throw new ForbiddenError();
				}
				if (!enabledCollections.includes(targetCollection)) {
					logger.warn(`Specified collection must be one of: ${enabledCollections.join(", ")}.`);
					throw new ForbiddenError();
				}
				if (requireSelection && (!targetKeys || !Array.isArray(targetKeys))) {
					logger.warn(`Manual trigger requires "keys" to be specified in the payload`);
					throw new ForbiddenError();
				}
				if (requireSelection && targetKeys.length === 0) {
					logger.warn(`Manual trigger requires at least one key to be specified in the payload`);
					throw new ForbiddenError();
				}
				const accountability = context?.["accountability"];
				if (!accountability) {
					logger.warn(`Manual flows are only triggerable when authenticated`);
					throw new ForbiddenError();
				}
				if (accountability.admin === false) {
					const database = context["database"] ?? database_default();
					const schema = context["schema"] ?? await getSchema({ database });
					if ((await fetchPermissions({
						policies: await fetchPolicies(accountability, {
							schema,
							knex: database
						}),
						accountability,
						action: "read",
						collections: [targetCollection]
					}, {
						schema,
						knex: database
					})).length === 0) {
						logger.warn(`Triggering ${targetCollection} is not allowed`);
						throw new ForbiddenError();
					}
					if (Array.isArray(targetKeys) && targetKeys.length > 0) {
						const service = getService(targetCollection, {
							schema,
							accountability,
							knex: database
						});
						const primaryField = schema.collections[targetCollection].primary;
						const allowedKeys = (await service.readMany(targetKeys, { fields: [primaryField] }, { emitEvents: false })).map((key) => String(key[primaryField]));
						if (targetKeys.some((key) => !allowedKeys.includes(String(key)))) {
							logger.warn(`Triggering keys ${targetKeys} is not allowed`);
							throw new ForbiddenError();
						}
					}
				}
				if (flow.options["async"]) {
					this.executeFlow(flow, data, context);
					return { result: void 0 };
				} else return { result: await this.executeFlow(flow, data, context) };
			};
			flow.options["return"] = "$last";
			this.webhookFlowHandlers[`POST-${flow.id}`] = handler;
		}
		this.isLoaded = true;
	}
	async unload() {
		for (const trigger of this.triggerHandlers) for (const event of trigger.events) switch (event.type) {
			case "filter":
				emitter_default.offFilter(event.name, event.handler);
				break;
			case "action":
				emitter_default.offAction(event.name, event.handler);
				break;
			case "schedule":
				await event.job.stop();
				break;
		}
		this.triggerHandlers = [];
		this.operationFlowHandlers = {};
		this.webhookFlowHandlers = {};
		this.isLoaded = false;
	}
	/**
	* One run per update group, its trigger shaped like the single update the flow
	* was written for; a returned value replaces that group's data.
	*/
	filterFlowHandler(flow, route) {
		const runFlow = (payload, meta, context) => {
			return this.executeFlow(flow, {
				payload,
				...meta,
				event: route.triggerEvent
			}, {
				accountability: context["accountability"],
				database: context["database"],
				getSchema: context["schema"] ? () => context["schema"] : getSchema
			});
		};
		if (route.payloadShape === "row") return runFlow;
		return async (payload, meta, context) => {
			if (!Array.isArray(payload)) return runFlow(payload, meta, context);
			if (route.payloadShape === "service-create") return;
			const groupsAfterFlow = [];
			for (const group of payload) {
				const dataAfterFlow = await runFlow(group.data, {
					...meta,
					keys: group.keys,
					originalPayload: group.data
				}, context);
				groupsAfterFlow.push({
					data: dataAfterFlow === void 0 ? group.data : dataAfterFlow,
					keys: group.keys
				});
			}
			return groupsAfterFlow;
		};
	}
	actionFlowHandler(flow, route) {
		const runFlow = (meta, context) => {
			return this.executeFlow(flow, {
				...meta,
				event: route.triggerEvent
			}, {
				accountability: context["accountability"],
				database: database_default(),
				getSchema: context["schema"] ? () => context["schema"] : getSchema
			});
		};
		if (route.payloadShape === "row") return runFlow;
		return async (meta, context) => {
			if (!Array.isArray(meta["payload"])) {
				await runFlow(meta, context);
				return;
			}
			if (route.payloadShape === "service-create") return;
			for (const group of meta["payload"]) try {
				await runFlow({
					payload: group.data,
					keys: group.keys,
					collection: meta["collection"]
				}, context);
			} catch (error) {
				const logger = useLogger();
				logger.warn(`An error was thrown while executing action "${meta["event"]}"`);
				logger.warn(error);
			}
		};
	}
	async executeFlow(flow, data = null, context = {}) {
		const database = context["database"] ?? database_default();
		const schema = context["schema"] ?? await getSchema({ database });
		const keyedData = {
			[TRIGGER_KEY]: data,
			[LAST_KEY]: data,
			[ACCOUNTABILITY_KEY]: context?.["accountability"] ?? null,
			[ENV_KEY]: this.envs
		};
		let nextOperation = flow.operation;
		let lastOperationStatus = "unknown";
		const steps = [];
		while (nextOperation !== null) {
			const { successor, data: data$1, status, options } = await this.executeOperation(nextOperation, keyedData, context);
			keyedData[nextOperation.key] = data$1;
			keyedData[LAST_KEY] = data$1;
			lastOperationStatus = status;
			steps.push({
				operation: nextOperation.id,
				key: nextOperation.key,
				status,
				options
			});
			nextOperation = successor;
		}
		if (flow.accountability !== null) {
			const activityService = new ActivityService({
				knex: database,
				schema
			});
			const accountability = context?.["accountability"];
			const activity = await activityService.createOne({
				action: Action.RUN,
				user: accountability?.user ?? null,
				collection: "directus_flows",
				ip: accountability?.ip ?? null,
				user_agent: accountability?.userAgent ?? null,
				origin: accountability?.origin ?? null,
				item: flow.id
			});
			if (flow.accountability === "all") await new RevisionsService({
				knex: database,
				schema
			}).createOne({
				activity,
				collection: "directus_flows",
				item: flow.id,
				data: {
					steps: steps.map((step) => redactObject(step, { values: this.envs }, getRedactedString)),
					data: redactObject(keyedData, {
						keys: [
							[
								"**",
								"headers",
								"authorization"
							],
							[
								"**",
								"headers",
								"cookie"
							],
							[
								"**",
								"query",
								"access_token"
							],
							[
								"**",
								"payload",
								"password"
							]
						],
						values: this.envs
					}, getRedactedString)
				}
			});
		}
		if ((flow.trigger === "manual" || flow.trigger === "webhook") && flow.options["async"] !== true && flow.options["error_on_reject"] === true && lastOperationStatus === "reject") throw keyedData[LAST_KEY];
		if (flow.trigger === "event" && flow.options["type"] === "filter" && lastOperationStatus === "reject") throw keyedData[LAST_KEY];
		if (flow.options["return"] === "$all") return keyedData;
		else if (flow.options["return"]) return get(keyedData, flow.options["return"]);
	}
	async executeOperation(operation, keyedData, context = {}) {
		const logger = useLogger();
		if (!this.operations.has(operation.type)) {
			logger.warn(`Couldn't find operation ${operation.type}`);
			return {
				successor: null,
				status: "unknown",
				data: null,
				options: null
			};
		}
		const handler = this.operations.get(operation.type);
		let optionData = keyedData;
		if (operation.type === "log") optionData = redactObject(keyedData, { keys: [
			[
				"**",
				"headers",
				"authorization"
			],
			[
				"**",
				"headers",
				"cookie"
			],
			[
				"**",
				"query",
				"access_token"
			],
			[
				"**",
				"payload",
				"password"
			],
			[
				"**",
				"payload",
				"token"
			],
			[
				"**",
				"payload",
				"tfa_secret"
			],
			[
				"**",
				"payload",
				"external_identifier"
			],
			[
				"**",
				"payload",
				"auth_data"
			]
		] }, getRedactedString);
		let options = operation.options;
		try {
			options = applyOptionsData(options, optionData);
			let result = await handler(options, {
				services: services_exports,
				env: useEnv(),
				database: database_default(),
				logger,
				getSchema,
				scopedCache: createScopedCacheExtensionHandle(getSchema),
				data: keyedData,
				accountability: null,
				...context
			});
			JSON.stringify(result ?? null);
			if (typeof result === "object" && result !== null) result = deepMap(result, (value) => value === void 0 ? null : value);
			return {
				successor: operation.resolve,
				status: "resolve",
				data: result ?? null,
				options
			};
		} catch (error) {
			let data;
			if (error instanceof Error) {
				delete error.stack;
				data = error;
			} else if (typeof error === "string") data = isValidJSON(error) ? parseJSON(error) : error;
			else data = error ?? null;
			return {
				successor: operation.reject,
				status: "reject",
				data,
				options
			};
		}
	}
};

//#endregion
export { getFlowManager };