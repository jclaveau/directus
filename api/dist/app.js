import { getConfigFromEnv } from "./utils/get-config-from-env.js";
import { createExpressLogger, useLogger } from "./logger/index.js";
import { initAIDevTools } from "./ai/devtools/index.js";
import { initAITelemetry } from "./ai/telemetry/index.js";
import { isInstalled, validateDatabaseConnection, validateDatabaseExtensions, validateMigrations } from "./database/index.js";
import emitter_default from "./emitter.js";
import schedule from "./schedules/license.js";
import { Url } from "./utils/url.js";
import { getEntitlementManager } from "./license/entitlements/manager.js";
import { getFlowManager } from "./flows.js";
import { getExtensionManager } from "./extensions/index.js";
import { registerAuthProviders } from "./auth.js";
import { ensureDeploymentWebhooks, registerDeploymentDrivers } from "./deployment.js";
import { getLicenseManager } from "./license/manager.js";
import "./license/index.js";
import { aiRouter } from "./ai/chat/router.js";
import { aiFilesRouter } from "./ai/files/router.js";
import access_default from "./controllers/access.js";
import activity_default from "./controllers/activity.js";
import assets_default from "./controllers/assets.js";
import auth_default from "./controllers/auth.js";
import collections_default from "./controllers/collections.js";
import comments_default from "./controllers/comments.js";
import dashboards_default from "./controllers/dashboards.js";
import deployment_webhooks_default from "./controllers/deployment-webhooks.js";
import deployment_default from "./controllers/deployment.js";
import extensions_default from "./controllers/extensions.js";
import fields_default from "./controllers/fields.js";
import files_default from "./controllers/files.js";
import flows_default from "./controllers/flows.js";
import folders_default from "./controllers/folders.js";
import graphql_default from "./controllers/graphql.js";
import items_default from "./controllers/items.js";
import license_default from "./controllers/license.js";
import mcp_default from "./controllers/mcp/index.js";
import oauth_clients_default from "./controllers/mcp/oauth-clients.js";
import { mcpOAuthProtectedRouter, mcpOAuthPublicRouter } from "./controllers/mcp/oauth.js";
import metrics_default from "./controllers/metrics.js";
import not_found_default from "./controllers/not-found.js";
import notifications_default from "./controllers/notifications.js";
import operations_default from "./controllers/operations.js";
import panels_default from "./controllers/panels.js";
import permissions_default from "./controllers/permissions.js";
import policies_default from "./controllers/policies.js";
import presets_default from "./controllers/presets.js";
import relations_default from "./controllers/relations.js";
import revisions_default from "./controllers/revisions.js";
import roles_default from "./controllers/roles.js";
import schema_default from "./controllers/schema.js";
import server_default from "./controllers/server.js";
import settings_default from "./controllers/settings.js";
import shares_default from "./controllers/shares.js";
import translations_default from "./controllers/translations.js";
import tus_default from "./controllers/tus.js";
import users_default from "./controllers/users.js";
import utils_default from "./controllers/utils.js";
import versions_default from "./controllers/versions.js";
import authenticate_default from "./middleware/authenticate.js";
import cache_default from "./middleware/cache.js";
import cors_default from "./middleware/cors.js";
import { errorHandler } from "./middleware/error-handler.js";
import extract_token_default from "./middleware/extract-token.js";
import mcp_oauth_guard_default from "./middleware/mcp-oauth-guard.js";
import rate_limiter_global_default from "./middleware/rate-limiter-global.js";
import rate_limiter_ip_default from "./middleware/rate-limiter-ip.js";
import request_counter_default from "./middleware/request-counter.js";
import sanitize_query_default from "./middleware/sanitize-query.js";
import schema_default$1 from "./middleware/schema.js";
import schedule$1 from "./schedules/metrics.js";
import scheduleOAuthCleanup from "./schedules/oauth-cleanup.js";
import schedule$2 from "./schedules/project.js";
import schedule$3 from "./schedules/retention.js";
import schedule$4 from "./schedules/telemetry.js";
import schedule$5 from "./schedules/tus.js";
import { validateStorage } from "./utils/validate-storage.js";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "path";
import { useEnv } from "@directus/env";
import { InvalidPayloadError, ServiceUnavailableError } from "@directus/errors";
import { handlePressure } from "@directus/pressure";
import { toBoolean } from "@directus/utils";
import cookieParser from "cookie-parser";
import express from "express";
import { merge } from "lodash-es";
import qs from "qs";

//#region src/app.ts
const require = createRequire(import.meta.url);
async function createApp() {
	const env = useEnv();
	const logger = useLogger();
	const helmet = await import("helmet");
	await validateDatabaseConnection();
	if (await isInstalled() === false) {
		logger.error(`Database doesn't have Directus tables installed.`);
		process.exit(1);
	}
	if (await validateMigrations() === false) logger.warn(`Database migrations have not all been run`);
	if (!env["SECRET"]) logger.warn(`"SECRET" env variable is missing. Using a random value instead. Tokens will not persist between restarts. This is not appropriate for production usage.`);
	if (typeof env["SECRET"] === "string" && Buffer.byteLength(env["SECRET"]) < 32) logger.warn("\"SECRET\" env variable is shorter than 32 bytes which is insecure. This is not appropriate for production usage.");
	if (!new Url(env["PUBLIC_URL"]).isAbsolute()) logger.warn("\"PUBLIC_URL\" should be a full URL");
	if (env["MCP_OAUTH_ENABLED"] === true) {
		if (toBoolean(env["MCP_ENABLED"]) !== true) {
			logger.warn("MCP_OAUTH_ENABLED requires MCP_ENABLED=true. OAuth disabled.");
			env["MCP_OAUTH_ENABLED"] = false;
		}
	}
	await validateDatabaseExtensions();
	await validateStorage();
	await getLicenseManager().initialize();
	getEntitlementManager().initialize();
	await registerAuthProviders();
	registerDeploymentDrivers();
	await ensureDeploymentWebhooks();
	const extensionManager = getExtensionManager();
	const flowManager = getFlowManager();
	await extensionManager.initialize();
	await flowManager.initialize();
	const app = express();
	app.disable("x-powered-by");
	app.set("trust proxy", env["IP_TRUST_PROXY"]);
	app.set("query parser", (str) => qs.parse(str, {
		depth: Number(env["QUERYSTRING_MAX_PARSE_DEPTH"]),
		arrayLimit: Number(env["QUERYSTRING_ARRAY_LIMIT"])
	}));
	if (env["PRESSURE_LIMITER_ENABLED"]) {
		const sampleInterval = Number(env["PRESSURE_LIMITER_SAMPLE_INTERVAL"]);
		if (Number.isNaN(sampleInterval) === true || Number.isFinite(sampleInterval) === false) throw new Error(`Invalid value for PRESSURE_LIMITER_SAMPLE_INTERVAL environment variable`);
		app.use(handlePressure({
			sampleInterval,
			maxEventLoopUtilization: env["PRESSURE_LIMITER_MAX_EVENT_LOOP_UTILIZATION"],
			maxEventLoopDelay: env["PRESSURE_LIMITER_MAX_EVENT_LOOP_DELAY"],
			maxMemoryRss: env["PRESSURE_LIMITER_MAX_MEMORY_RSS"],
			maxMemoryHeapUsed: env["PRESSURE_LIMITER_MAX_MEMORY_HEAP_USED"],
			error: new ServiceUnavailableError({
				service: "api",
				reason: "Under pressure"
			}),
			retryAfter: env["PRESSURE_LIMITER_RETRY_AFTER"]
		}));
	}
	app.use(helmet.contentSecurityPolicy(merge({
		useDefaults: true,
		directives: {
			scriptSrc: ["'self'", "'unsafe-eval'"],
			upgradeInsecureRequests: null,
			workerSrc: ["'self'", "blob:"],
			childSrc: ["'self'", "blob:"],
			imgSrc: [
				"'self'",
				"data:",
				"blob:",
				"https://raw.githubusercontent.com",
				"https://avatars.githubusercontent.com"
			],
			mediaSrc: ["'self'"],
			connectSrc: [
				"'self'",
				"https://*",
				"wss://*"
			]
		}
	}, getConfigFromEnv("CONTENT_SECURITY_POLICY_"))));
	if (env["CROSS_ORIGIN_OPENER_POLICY_ENABLED"]) app.use(helmet.crossOriginOpenerPolicy({ policy: env["CROSS_ORIGIN_OPENER_POLICY"] ?? "same-origin-allow-popups" }));
	if (env["HSTS_ENABLED"]) app.use(helmet.hsts(getConfigFromEnv("HSTS_", { omitPrefix: "HSTS_ENABLED" })));
	await emitter_default.emitInit("app.before", { app });
	await emitter_default.emitInit("middlewares.before", { app });
	app.use(createExpressLogger());
	app.use((_req, res, next) => {
		res.setHeader("X-Powered-By", "Directus");
		next();
	});
	if (env["CORS_ENABLED"] === true) app.use(cors_default);
	app.use((req, res, next) => {
		express.json({
			limit: env["MAX_PAYLOAD_SIZE"],
			verify: (req$1, _res, buf) => {
				req$1.rawBody = buf;
			}
		})(req, res, (err) => {
			if (err) return next(new InvalidPayloadError({ reason: err.message }));
			return next();
		});
	});
	app.use(cookieParser());
	app.use(extract_token_default);
	app.get("/", (_req, res, next) => {
		if (env["ROOT_REDIRECT"]) res.redirect(env["ROOT_REDIRECT"]);
		else next();
	});
	app.get("/robots.txt", (_, res) => {
		res.set("Content-Type", "text/plain");
		res.status(200);
		res.send(env["ROBOTS_TXT"]);
	});
	if (env["SERVE_APP"]) {
		const adminPath = require.resolve("@directus/app");
		const adminUrl = new Url(env["PUBLIC_URL"]).addPath("admin");
		const embeds = extensionManager.getEmbeds();
		const htmlWithVars = (await readFile(adminPath, "utf8")).replace(/<base \/>/, `<base href="${adminUrl.toString({ rootRelative: true })}/" />`).replace("<!-- directus-embed-head -->", embeds.head).replace("<!-- directus-embed-body -->", embeds.body);
		const sendHtml = (_req, res) => {
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("Vary", "Origin, Cache-Control");
			res.send(htmlWithVars);
		};
		const setStaticHeaders = (res) => {
			res.setHeader("Cache-Control", "max-age=31536000, immutable");
			res.setHeader("Vary", "Origin, Cache-Control");
		};
		app.get("/admin", sendHtml);
		app.use("/admin", express.static(path.join(adminPath, ".."), { setHeaders: setStaticHeaders }));
		app.use("/admin/*", sendHtml);
	}
	if (env["RATE_LIMITER_GLOBAL_ENABLED"] === true) app.use(rate_limiter_global_default);
	if (env["RATE_LIMITER_ENABLED"] === true) app.use(rate_limiter_ip_default);
	app.get("/server/ping", (_req, res) => res.send("pong"));
	app.use("/deployments/webhooks", deployment_webhooks_default);
	if (env["MCP_OAUTH_ENABLED"] === true) app.use(mcpOAuthPublicRouter);
	app.use(authenticate_default);
	app.use(mcp_oauth_guard_default);
	if (env["MCP_OAUTH_ENABLED"] === true) app.use(mcpOAuthProtectedRouter);
	app.use(schema_default$1);
	app.use(sanitize_query_default);
	app.use(request_counter_default);
	app.use(cache_default);
	await emitter_default.emitInit("middlewares.after", { app });
	await emitter_default.emitInit("routes.before", { app });
	app.use("/auth", auth_default);
	app.use("/graphql", graphql_default);
	app.use("/activity", activity_default);
	app.use("/access", access_default);
	app.use("/assets", assets_default);
	app.use("/collections", collections_default);
	app.use("/comments", comments_default);
	app.use("/dashboards", dashboards_default);
	app.use("/deployments", deployment_default);
	app.use("/extensions", extensions_default);
	app.use("/fields", fields_default);
	if (env["TUS_ENABLED"] === true) app.use("/files/tus", tus_default);
	app.use("/files", files_default);
	app.use("/flows", flows_default);
	app.use("/folders", folders_default);
	app.use("/items", items_default);
	app.use("/license", license_default);
	if (toBoolean(env["MCP_ENABLED"]) === true) app.use("/mcp", mcp_default);
	if (toBoolean(env["AI_ENABLED"]) === true) {
		await initAIDevTools();
		await initAITelemetry();
		app.use("/ai", aiRouter);
		app.use("/ai/files", aiFilesRouter);
	}
	if (env["METRICS_ENABLED"] === true) app.use("/metrics", metrics_default);
	app.use("/notifications", notifications_default);
	app.use("/operations", operations_default);
	app.use("/panels", panels_default);
	app.use("/permissions", permissions_default);
	app.use("/policies", policies_default);
	app.use("/presets", presets_default);
	app.use("/translations", translations_default);
	app.use("/relations", relations_default);
	app.use("/revisions", revisions_default);
	app.use("/roles", roles_default);
	if (toBoolean(env["MCP_OAUTH_ENABLED"]) === true) app.use("/mcp-oauth/clients", oauth_clients_default);
	app.use("/schema", schema_default);
	app.use("/server", server_default);
	app.use("/settings", settings_default);
	app.use("/shares", shares_default);
	app.use("/users", users_default);
	app.use("/utils", utils_default);
	app.use("/versions", versions_default);
	await emitter_default.emitInit("routes.custom.before", { app });
	app.use(extensionManager.getEndpointRouter());
	await emitter_default.emitInit("routes.custom.after", { app });
	app.use(not_found_default);
	app.use(errorHandler);
	await emitter_default.emitInit("routes.after", { app });
	await schedule$3();
	await schedule$4();
	await schedule$5();
	await schedule$1();
	await schedule$2();
	await schedule();
	if (env["MCP_OAUTH_ENABLED"] === true) await scheduleOAuthCleanup();
	await emitter_default.emitInit("app.after", { app });
	return app;
}

//#endregion
export { createApp as default };