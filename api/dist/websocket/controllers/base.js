import { useLogger } from "../../logger/index.js";
import emitter_default from "../../emitter.js";
import { createRateLimiter } from "../../rate-limiter.js";
import { createDefaultAccountability } from "../../permissions/utils/create-default-accountability.js";
import { getIPFromReq } from "../../utils/get-ip-from-req.js";
import { getAccountabilityForToken } from "../../utils/get-accountability-for-token.js";
import { WebSocketError, handleWebSocketError } from "../errors.js";
import { getExpiresAtForToken } from "../utils/get-expires-at-for-token.js";
import { authenticateConnection, authenticationSuccess } from "../authenticate.js";
import { AuthMode, WebSocketAuthMessage, WebSocketMessage } from "../messages.js";
import { getMessageType } from "../utils/message.js";
import { waitForAnyMessage, waitForMessageType } from "../utils/wait-for-message.js";
import { useEnv } from "@directus/env";
import { InvalidProviderConfigError, TokenExpiredError } from "@directus/errors";
import { parseJSON, toBoolean } from "@directus/utils";
import { randomUUID } from "node:crypto";
import { parse } from "url";
import { fromZodError } from "zod-validation-error";
import cookie from "cookie";
import { WebSocketServer } from "ws";

//#region src/websocket/controllers/base.ts
const TOKEN_CHECK_INTERVAL = 900 * 1e3;
const logger = useLogger();
var SocketController = class {
	server;
	clients;
	authentication;
	endpoint;
	maxConnections;
	rateLimiter;
	authInterval;
	constructor(httpServer, configPrefix) {
		this.server = new WebSocketServer({
			noServer: true,
			autoPong: false
		});
		this.clients = /* @__PURE__ */ new Set();
		this.authInterval = null;
		const { endpoint, authentication, maxConnections } = this.getEnvironmentConfig(configPrefix);
		this.endpoint = endpoint;
		this.authentication = authentication;
		this.maxConnections = maxConnections;
		this.rateLimiter = this.getRateLimiter();
		httpServer.on("upgrade", this.handleUpgrade.bind(this));
		this.checkClientTokens();
	}
	getEnvironmentConfig(configPrefix) {
		const env = useEnv();
		const endpoint = String(env[`${configPrefix}_PATH`]);
		const authMode = AuthMode.safeParse(String(env[`${configPrefix}_AUTH`]).toLowerCase());
		const authTimeout = Number(env[`${configPrefix}_AUTH_TIMEOUT`]) * 1e3;
		const maxConnections = `${configPrefix}_CONN_LIMIT` in env ? Number(env[`${configPrefix}_CONN_LIMIT`]) : Number.POSITIVE_INFINITY;
		if (!authMode.success) throw new InvalidProviderConfigError({
			provider: "ws",
			reason: fromZodError(authMode.error, { prefix: `${configPrefix}_AUTH` }).message
		});
		return {
			endpoint,
			maxConnections,
			authentication: {
				mode: authMode.data,
				timeout: authTimeout
			}
		};
	}
	getRateLimiter() {
		if (toBoolean(useEnv()["RATE_LIMITER_ENABLED"]) === true) return createRateLimiter("RATE_LIMITER", { keyPrefix: "websocket" });
		return null;
	}
	catchInvalidMessages(ws) {
		/**
		* This fix was done to prevent the API from crashing on receiving invalid WebSocket frames
		* https://github.com/directus/directus/security/advisories/GHSA-hmgw-9jrg-hf2m
		* https://github.com/websockets/ws/issues/2098
		*/
		ws._socket.prependListener("data", (data) => data.toString());
		ws.on("error", (error) => {
			if (error.message) logger.debug(error.message);
		});
	}
	async handleUpgrade(request, socket, head) {
		const { pathname, query } = parse(request.url, true);
		if (pathname !== this.endpoint) return;
		if (this.clients.size >= this.maxConnections) {
			logger.debug("WebSocket upgrade denied - max connections reached");
			socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
			socket.destroy();
			return;
		}
		const env = useEnv();
		const cookies = request.headers.cookie ? cookie.parse(request.headers.cookie) : {};
		const sessionCookieName = env["SESSION_COOKIE_NAME"];
		const accountabilityOverrides = { ip: getIPFromReq(request) ?? null };
		const userAgent = request.headers["user-agent"]?.substring(0, 1024);
		if (userAgent) accountabilityOverrides.userAgent = userAgent;
		const origin = request.headers["origin"];
		if (origin) accountabilityOverrides.origin = origin;
		const context = {
			request,
			socket,
			head,
			accountabilityOverrides
		};
		if (this.authentication.mode === "strict" || query["access_token"] || cookies[sessionCookieName]) {
			let token = null;
			if (typeof query["access_token"] === "string") token = query["access_token"];
			else if (typeof cookies[sessionCookieName] === "string") token = cookies[sessionCookieName] ?? null;
			await this.handleTokenUpgrade(context, token);
			return;
		}
		if (this.authentication.mode === "handshake") {
			await this.handleHandshakeUpgrade(context);
			return;
		}
		this.server.handleUpgrade(request, socket, head, async (ws) => {
			this.catchInvalidMessages(ws);
			const state = {
				accountability: createDefaultAccountability(accountabilityOverrides),
				expires_at: null
			};
			this.server.emit("connection", ws, state);
		});
	}
	async handleTokenUpgrade({ request, socket, head, accountabilityOverrides }, token) {
		let accountability = null;
		let expires_at = null;
		if (token) try {
			accountability = await getAccountabilityForToken(token);
			expires_at = getExpiresAtForToken(token);
		} catch {
			accountability = null;
			expires_at = null;
		}
		if (!token || !accountability || !accountability.user) {
			logger.debug("WebSocket upgrade denied - " + JSON.stringify(accountability || "invalid"));
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return;
		}
		try {
			this.checkUserRequirements(accountability);
		} catch {
			logger.debug("WebSocket upgrade denied - " + JSON.stringify(accountability || "invalid"));
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return;
		}
		Object.assign(accountability, accountabilityOverrides);
		this.server.handleUpgrade(request, socket, head, async (ws) => {
			this.catchInvalidMessages(ws);
			const state = {
				accountability,
				expires_at
			};
			this.server.emit("connection", ws, state);
		});
	}
	async handleHandshakeUpgrade({ request, socket, head, accountabilityOverrides }) {
		this.server.handleUpgrade(request, socket, head, async (ws) => {
			this.catchInvalidMessages(ws);
			try {
				const payload = await waitForAnyMessage(ws, this.authentication.timeout);
				if (getMessageType(payload) !== "auth") throw new Error();
				const state = await authenticateConnection(WebSocketAuthMessage.parse(payload));
				if (state.accountability) Object.assign(state.accountability, accountabilityOverrides);
				this.checkUserRequirements(state.accountability);
				ws.send(authenticationSuccess(payload["uid"], state.refresh_token));
				this.server.emit("connection", ws, state);
			} catch {
				logger.debug("WebSocket authentication handshake failed");
				handleWebSocketError(ws, new WebSocketError("auth", "AUTH_FAILED", "Authentication handshake failed."), "auth");
				ws.close();
			}
		});
	}
	createClient(ws, { accountability, expires_at }) {
		const client = ws;
		client.accountability = accountability;
		client.expires_at = expires_at;
		client.uid = randomUUID();
		client.auth_timer = null;
		ws.on("message", async (data) => {
			if (this.rateLimiter !== null) try {
				await this.rateLimiter.consume(client.uid);
			} catch (limit) {
				handleWebSocketError(client, new WebSocketError("server", "REQUESTS_EXCEEDED", `Too many messages, retry after ${limit?.msBeforeNext ?? this.rateLimiter.msDuration}ms.`), "server");
				logger.debug(`WebSocket#${client.uid} is rate limited`);
				return;
			}
			let message;
			try {
				message = this.parseMessage(data.toString());
			} catch (err) {
				handleWebSocketError(client, err, "server");
				return;
			}
			if (getMessageType(message) === "auth") {
				try {
					await this.handleAuthRequest(client, WebSocketAuthMessage.parse(message));
				} catch {}
				return;
			}
			logger.trace(`WebSocket#${client.uid} - ${JSON.stringify(message)}`);
			ws.emit("parsed-message", message);
		});
		ws.on("error", () => {
			logger.debug(`WebSocket#${client.uid} connection errored`);
			if (client.auth_timer) {
				clearTimeout(client.auth_timer);
				client.auth_timer = null;
			}
			this.clients.delete(client);
		});
		ws.on("close", () => {
			logger.debug(`WebSocket#${client.uid} connection closed`);
			if (client.auth_timer) {
				clearTimeout(client.auth_timer);
				client.auth_timer = null;
			}
			this.clients.delete(client);
		});
		logger.debug(`WebSocket#${client.uid} connected`);
		if (accountability) logger.trace(`WebSocket#${client.uid} authenticated as ${JSON.stringify(accountability)}`);
		this.setTokenExpireTimer(client);
		this.clients.add(client);
		return client;
	}
	parseMessage(data) {
		let message;
		try {
			message = WebSocketMessage.parse(parseJSON(data));
		} catch {
			throw new WebSocketError("server", "INVALID_PAYLOAD", "Unable to parse the incoming message.");
		}
		return message;
	}
	async handleAuthRequest(client, message) {
		try {
			const { accountability, expires_at, refresh_token } = await authenticateConnection(message);
			this.checkUserRequirements(accountability);
			/**
			* Re-use the existing ip, userAgent and origin accountability properties.
			* They are only sent in the original connection request
			*/
			if (accountability && client.accountability) Object.assign(accountability, {
				ip: client.accountability.ip,
				userAgent: client.accountability.userAgent,
				origin: client.accountability.origin
			});
			client.accountability = accountability;
			client.expires_at = expires_at;
			this.setTokenExpireTimer(client);
			emitter_default.emitAction("websocket.auth.success", { client });
			client.send(authenticationSuccess(message.uid, refresh_token));
			logger.trace(`WebSocket#${client.uid} authenticated as ${JSON.stringify(client.accountability)}`);
		} catch (error) {
			logger.trace(`WebSocket#${client.uid} failed authentication`);
			emitter_default.emitAction("websocket.auth.failure", { client });
			client.accountability = null;
			client.expires_at = null;
			handleWebSocketError(client, error instanceof WebSocketError ? error : new WebSocketError("auth", "AUTH_FAILED", "Authentication failed.", message.uid), "auth");
			if (this.authentication.mode !== "public") client.close();
		}
	}
	checkUserRequirements(_accountability) {}
	setTokenExpireTimer(client) {
		if (client.auth_timer !== null) {
			clearTimeout(client.auth_timer);
			client.auth_timer = null;
		}
		if (!client.expires_at) return;
		const expiresIn = client.expires_at * 1e3 - Date.now();
		if (expiresIn > TOKEN_CHECK_INTERVAL) return;
		client.auth_timer = setTimeout(() => {
			client.accountability = null;
			client.expires_at = null;
			handleWebSocketError(client, new TokenExpiredError(), "auth");
			waitForMessageType(client, "auth", this.authentication.timeout).catch((msg) => {
				handleWebSocketError(client, new WebSocketError("auth", "AUTH_TIMEOUT", "Authentication timed out.", msg?.uid), "auth");
				if (this.authentication.mode !== "public") client.close();
			});
		}, expiresIn);
	}
	checkClientTokens() {
		this.authInterval = setInterval(() => {
			if (this.clients.size === 0) return;
			for (const client of this.clients) {
				if (client.expires_at === null || client.auth_timer !== null) continue;
				this.setTokenExpireTimer(client);
			}
		}, TOKEN_CHECK_INTERVAL);
	}
	terminate() {
		if (this.authInterval) clearInterval(this.authInterval);
		this.clients.forEach((client) => {
			if (client.auth_timer) clearTimeout(client.auth_timer);
		});
		this.server.clients.forEach((ws) => {
			ws.terminate();
		});
	}
};

//#endregion
export { SocketController as default };