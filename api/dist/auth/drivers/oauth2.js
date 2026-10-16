import { REFRESH_COOKIE_OPTIONS, SESSION_COOKIE_OPTIONS } from "../../constants.js";
import { getConfigFromEnv } from "../../utils/get-config-from-env.js";
import { useLogger } from "../../logger/index.js";
import database_default from "../../database/index.js";
import emitter_default from "../../emitter.js";
import { getSecret } from "../../utils/get-secret.js";
import { AuthenticationService } from "../../services/authentication.js";
import { Url } from "../../utils/url.js";
import { createDefaultAccountability } from "../../permissions/utils/create-default-accountability.js";
import { verifyJWT } from "../../utils/jwt.js";
import { UsersService } from "../../services/users.js";
import async_handler_default from "../../utils/async-handler.js";
import { getIPFromReq } from "../../utils/get-ip-from-req.js";
import { respond } from "../../middleware/respond.js";
import { LocalAuthDriver } from "./local.js";
import { isLoginRedirectAllowed } from "../../utils/is-login-redirect-allowed.js";
import { getAuthProvider } from "../../auth.js";
import { useEnv } from "@directus/env";
import { ErrorCode, InvalidCredentialsError, InvalidPayloadError, InvalidProviderConfigError, InvalidProviderError, InvalidTokenError, ServiceUnavailableError, isDirectusError } from "@directus/errors";
import express, { Router } from "express";
import { parseJSON, toArray } from "@directus/utils";
import { flatten } from "flat";
import jwt from "jsonwebtoken";
import { Issuer, errors, generators } from "openid-client";

//#region src/auth/drivers/oauth2.ts
var OAuth2AuthDriver = class extends LocalAuthDriver {
	client;
	redirectUrl;
	usersService;
	config;
	roleMap;
	constructor(options, config) {
		super(options, config);
		const env = useEnv();
		const logger = useLogger();
		const { authorizeUrl, accessUrl, profileUrl, clientId, clientSecret,...additionalConfig } = config;
		if (!authorizeUrl || !accessUrl || !profileUrl || !clientId || !clientSecret || !additionalConfig["provider"]) {
			logger.error("Invalid provider config");
			throw new InvalidProviderConfigError({ provider: additionalConfig["provider"] });
		}
		this.redirectUrl = new Url(env["PUBLIC_URL"]).addPath("auth", "login", additionalConfig["provider"], "callback").toString();
		this.usersService = new UsersService({
			knex: this.knex,
			schema: this.schema
		});
		this.config = additionalConfig;
		this.roleMap = {};
		const roleMapping = this.config["roleMapping"];
		if (roleMapping) this.roleMap = roleMapping;
		if (roleMapping instanceof Array) {
			logger.error("[OAuth2] Expected a JSON-Object as role mapping, got an Array instead. Make sure you declare the variable with 'json:' prefix.");
			throw new InvalidProviderError();
		}
		const issuer = new Issuer({
			authorization_endpoint: authorizeUrl,
			token_endpoint: accessUrl,
			userinfo_endpoint: profileUrl,
			issuer: additionalConfig["provider"]
		});
		const clientOptionsOverrides = getConfigFromEnv(`AUTH_${config["provider"].toUpperCase()}_CLIENT_`, {
			omitKey: [`AUTH_${config["provider"].toUpperCase()}_CLIENT_ID`, `AUTH_${config["provider"].toUpperCase()}_CLIENT_SECRET`],
			type: "underscore"
		});
		this.client = new issuer.Client({
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uris: [this.redirectUrl],
			response_types: ["code"],
			...clientOptionsOverrides
		});
	}
	generateCodeVerifier() {
		return generators.codeVerifier();
	}
	generateAuthUrl(codeVerifier, prompt = false) {
		const { plainCodeChallenge } = this.config;
		try {
			const codeChallenge = plainCodeChallenge ? codeVerifier : generators.codeChallenge(codeVerifier);
			const paramsConfig = typeof this.config["params"] === "object" ? this.config["params"] : {};
			return this.client.authorizationUrl({
				scope: this.config["scope"] ?? "email",
				access_type: "offline",
				prompt: prompt ? "consent" : void 0,
				...paramsConfig,
				code_challenge: codeChallenge,
				code_challenge_method: plainCodeChallenge ? "plain" : "S256",
				state: codeChallenge
			});
		} catch (e) {
			throw handleError(e);
		}
	}
	async fetchUserId(identifier) {
		return (await this.knex.select("id").from("directus_users").whereRaw("LOWER(??) = ?", ["external_identifier", identifier.toLowerCase()]).first())?.id;
	}
	async getUserID(payload) {
		const logger = useLogger();
		if (!payload["code"] || !payload["codeVerifier"] || !payload["state"]) {
			logger.warn("[OAuth2] No code, codeVerifier or state in payload");
			throw new InvalidCredentialsError();
		}
		const { plainCodeChallenge } = this.config;
		let tokenSet;
		let userInfo;
		try {
			const codeChallenge = plainCodeChallenge ? payload["codeVerifier"] : generators.codeChallenge(payload["codeVerifier"]);
			tokenSet = await this.client.oauthCallback(this.redirectUrl, {
				code: payload["code"],
				state: payload["state"]
			}, {
				code_verifier: payload["codeVerifier"],
				state: codeChallenge
			});
			userInfo = await this.client.userinfo(tokenSet.access_token);
		} catch (e) {
			throw handleError(e);
		}
		let role = this.config["defaultRoleId"];
		const groupClaimName = this.config["groupClaimName"] ?? "groups";
		const groups = userInfo[groupClaimName] ? toArray(userInfo[groupClaimName]) : [];
		if (groups.length > 0) {
			for (const key in this.roleMap) if (groups.includes(key)) {
				role = this.roleMap[key];
				break;
			}
		} else if (Object.keys(this.roleMap).length > 0) logger.debug(`[OAuth2] Configured group claim with name "${groupClaimName}" does not exist or is empty.`);
		userInfo = flatten(userInfo);
		const { provider, emailKey, identifierKey, allowPublicRegistration, syncUserInfo } = this.config;
		const email = userInfo[emailKey ?? "email"] ? String(userInfo[emailKey ?? "email"]) : void 0;
		const identifier = userInfo[identifierKey] ? String(userInfo[identifierKey]) : email;
		if (!identifier) {
			logger.warn(`[OAuth2] Failed to find user identifier for provider "${provider}"`);
			throw new InvalidCredentialsError();
		}
		const userPayload = {
			provider,
			first_name: userInfo[this.config["firstNameKey"]],
			last_name: userInfo[this.config["lastNameKey"]],
			email,
			external_identifier: identifier,
			role,
			auth_data: tokenSet.refresh_token && JSON.stringify({ refreshToken: tokenSet.refresh_token })
		};
		const userId = await this.fetchUserId(identifier);
		if (userId) {
			let emitPayload = { auth_data: userPayload.auth_data };
			if (this.config["roleMapping"]) emitPayload["role"] = role;
			if (syncUserInfo) emitPayload = {
				...emitPayload,
				first_name: userPayload.first_name,
				last_name: userPayload.last_name,
				email: userPayload.email
			};
			const updatedUserPayload$1 = await emitter_default.emitFilter(`auth.update`, emitPayload, {
				identifier,
				provider: this.config["provider"],
				providerPayload: {
					accessToken: tokenSet.access_token,
					idToken: tokenSet.id_token,
					userInfo
				}
			}, {
				database: database_default(),
				schema: this.schema,
				accountability: null
			});
			if (Object.values(updatedUserPayload$1).some((value) => value !== void 0)) await this.usersService.updateOne(userId, updatedUserPayload$1);
			return userId;
		}
		if (!allowPublicRegistration) {
			logger.warn(`[OAuth2] User doesn't exist, and public registration not allowed for provider "${provider}"`);
			throw new InvalidCredentialsError();
		}
		const updatedUserPayload = await emitter_default.emitFilter(`auth.create`, userPayload, {
			identifier,
			provider: this.config["provider"],
			providerPayload: {
				accessToken: tokenSet.access_token,
				idToken: tokenSet.id_token,
				userInfo
			}
		}, {
			database: database_default(),
			schema: this.schema,
			accountability: null
		});
		try {
			await this.usersService.createOne(updatedUserPayload);
		} catch (e) {
			if (isDirectusError(e, ErrorCode.RecordNotUnique)) {
				logger.warn(e, "[OAuth2] Failed to register user. User not unique");
				throw new InvalidProviderError();
			}
			throw e;
		}
		return await this.fetchUserId(identifier);
	}
	async login(user) {
		return this.refresh(user);
	}
	async refresh(user) {
		const logger = useLogger();
		let authData = user.auth_data;
		if (typeof authData === "string") try {
			authData = parseJSON(authData);
		} catch {
			logger.warn(`[OAuth2] Session data isn't valid JSON: ${authData}`);
		}
		if (authData?.["refreshToken"]) try {
			const tokenSet = await this.client.refresh(authData["refreshToken"]);
			if (tokenSet.refresh_token) await this.usersService.updateOne(user.id, { auth_data: JSON.stringify({ refreshToken: tokenSet.refresh_token }) });
		} catch (e) {
			throw handleError(e);
		}
	}
};
const handleError = (e) => {
	const logger = useLogger();
	if (e instanceof errors.OPError) {
		if (e.error === "invalid_grant") {
			logger.warn(e, `[OAuth2] Invalid grant`);
			return new InvalidTokenError();
		}
		logger.warn(e, `[OAuth2] Unknown OP error`);
		return new ServiceUnavailableError({
			service: "oauth2",
			reason: `Service returned unexpected response: ${e.error_description}`
		});
	} else if (e instanceof errors.RPError) {
		logger.warn(e, `[OAuth2] Unknown RP error`);
		return new InvalidCredentialsError();
	}
	logger.warn(e, `[OAuth2] Unknown error`);
	return e;
};
function createOAuth2AuthRouter(providerName) {
	const router = Router();
	const env = useEnv();
	router.get("/", (req, res) => {
		const provider = getAuthProvider(providerName);
		const codeVerifier = provider.generateCodeVerifier();
		const prompt = !!req.query["prompt"];
		const redirect = req.query["redirect"];
		if (isLoginRedirectAllowed(redirect, providerName) === false) throw new InvalidPayloadError({ reason: `URL "${redirect}" can't be used to redirect after login` });
		const token = jwt.sign({
			verifier: codeVerifier,
			redirect,
			prompt
		}, getSecret(), {
			expiresIn: "5m",
			issuer: "directus"
		});
		res.cookie(`oauth2.${providerName}`, token, {
			httpOnly: true,
			sameSite: "lax"
		});
		return res.redirect(provider.generateAuthUrl(codeVerifier, prompt));
	}, respond);
	router.post("/callback", express.urlencoded({ extended: false }), (req, res) => {
		res.redirect(303, `./callback?${new URLSearchParams(req.body)}`);
	}, respond);
	router.get("/callback", async_handler_default(async (req, res, next) => {
		const logger = useLogger();
		let tokenData;
		try {
			tokenData = verifyJWT(req.cookies[`oauth2.${providerName}`], getSecret());
		} catch (e) {
			logger.warn(e, `[OAuth2] Couldn't verify OAuth2 cookie`);
			throw new InvalidCredentialsError();
		}
		const { verifier, redirect, prompt } = tokenData;
		const accountability = createDefaultAccountability({ ip: getIPFromReq(req) });
		const userAgent = req.get("user-agent")?.substring(0, 1024);
		if (userAgent) accountability.userAgent = userAgent;
		const origin = req.get("origin");
		if (origin) accountability.origin = origin;
		const authenticationService = new AuthenticationService({
			accountability,
			schema: req.schema
		});
		const authMode = env[`AUTH_${providerName.toUpperCase()}_MODE`] ?? "session";
		let authResponse;
		try {
			res.clearCookie(`oauth2.${providerName}`);
			authResponse = await authenticationService.login(providerName, {
				code: req.query["code"],
				codeVerifier: verifier,
				state: req.query["state"]
			}, { session: authMode === "session" });
		} catch (error) {
			if (isDirectusError(error, ErrorCode.InvalidToken) && !prompt) return res.redirect(`./?${redirect ? `redirect=${redirect}&` : ""}prompt=true`);
			if (redirect) {
				let reason = "UNKNOWN_EXCEPTION";
				if (isDirectusError(error)) reason = error.code;
				else logger.warn(error, `[OAuth2] Unexpected error during OAuth2 login`);
				return res.redirect(`${redirect.split("?")[0]}?reason=${reason}`);
			}
			logger.warn(error, `[OAuth2] Unexpected error during OAuth2 login`);
			throw error;
		}
		const { accessToken, refreshToken, expires } = authResponse;
		if (redirect) {
			if (authMode === "session") res.cookie(env["SESSION_COOKIE_NAME"], accessToken, SESSION_COOKIE_OPTIONS);
			else res.cookie(env["REFRESH_TOKEN_COOKIE_NAME"], refreshToken, REFRESH_COOKIE_OPTIONS);
			return res.redirect(redirect);
		}
		res.locals["payload"] = { data: {
			access_token: accessToken,
			refresh_token: refreshToken,
			expires
		} };
		next();
	}), respond);
	return router;
}

//#endregion
export { OAuth2AuthDriver, createOAuth2AuthRouter };