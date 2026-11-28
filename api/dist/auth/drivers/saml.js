import { REFRESH_COOKIE_OPTIONS, SESSION_COOKIE_OPTIONS } from "../../constants.js";
import { getConfigFromEnv } from "../../utils/get-config-from-env.js";
import { useLogger } from "../../logger/index.js";
import database_default from "../../database/index.js";
import emitter_default from "../../emitter.js";
import { AuthenticationService } from "../../services/authentication.js";
import { UsersService } from "../../services/users.js";
import async_handler_default from "../../utils/async-handler.js";
import { respond } from "../../middleware/respond.js";
import { LocalAuthDriver } from "./local.js";
import { isLoginRedirectAllowed } from "../../utils/is-login-redirect-allowed.js";
import { getAuthProvider } from "../../auth.js";
import { useEnv } from "@directus/env";
import { ErrorCode, InvalidCredentialsError, InvalidPayloadError, InvalidProviderError, isDirectusError } from "@directus/errors";
import express, { Router } from "express";
import * as validator from "@authenio/samlify-node-xmllint";
import * as samlify from "samlify";

//#region src/auth/drivers/saml.ts
samlify.setSchemaValidator(validator);
var SAMLAuthDriver = class extends LocalAuthDriver {
	sp;
	idp;
	usersService;
	config;
	constructor(options, config) {
		super(options, config);
		this.config = config;
		this.usersService = new UsersService({
			knex: this.knex,
			schema: this.schema
		});
		this.sp = samlify.ServiceProvider(getConfigFromEnv(`AUTH_${config["provider"].toUpperCase()}_SP`));
		this.idp = samlify.IdentityProvider(getConfigFromEnv(`AUTH_${config["provider"].toUpperCase()}_IDP`));
	}
	async fetchUserID(identifier) {
		return (await this.knex.select("id").from("directus_users").whereRaw("LOWER(??) = ?", ["external_identifier", identifier.toLowerCase()]).first())?.id;
	}
	async getUserID(payload) {
		const logger = useLogger();
		const { provider, emailKey, identifierKey, givenNameKey, familyNameKey, allowPublicRegistration } = this.config;
		const email = payload[emailKey ?? "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"];
		const identifier = payload[identifierKey || "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"];
		if (!identifier) {
			logger.warn(`[SAML] Failed to find user identifier for provider "${provider}"`);
			throw new InvalidCredentialsError();
		}
		const userID = await this.fetchUserID(identifier);
		if (userID) return userID;
		if (!allowPublicRegistration) {
			logger.warn(`[SAML] User doesn't exist, and public registration not allowed for provider "${provider}"`);
			throw new InvalidCredentialsError();
		}
		const userPayload = {
			provider,
			first_name: payload[givenNameKey ?? "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"],
			last_name: payload[familyNameKey ?? "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"],
			email,
			external_identifier: identifier.toLowerCase(),
			role: this.config["defaultRoleId"]
		};
		const updatedUserPayload = await emitter_default.emitFilter(`auth.create`, userPayload, {
			identifier: identifier.toLowerCase(),
			provider: this.config["provider"],
			providerPayload: { ...payload }
		}, {
			database: database_default(),
			schema: this.schema,
			accountability: null
		});
		try {
			return await this.usersService.createOne(updatedUserPayload);
		} catch (error) {
			if (isDirectusError(error, ErrorCode.RecordNotUnique)) {
				logger.warn(error, "[SAML] Failed to register user. User not unique");
				throw new InvalidProviderError();
			}
			throw error;
		}
	}
	async login(_user) {}
};
function createSAMLAuthRouter(providerName) {
	const router = Router();
	const env = useEnv();
	router.get("/metadata", async_handler_default(async (_req, res) => {
		const { sp } = getAuthProvider(providerName);
		return res.header("Content-Type", "text/xml").send(sp.getMetadata());
	}));
	router.get("/", async_handler_default(async (req, res) => {
		const { sp, idp } = getAuthProvider(providerName);
		const { context: url } = sp.createLoginRequest(idp, "redirect");
		const parsedUrl = new URL(url);
		if (req.query["redirect"]) {
			const redirect = req.query["redirect"];
			if (isLoginRedirectAllowed(redirect, providerName) === false) throw new InvalidPayloadError({ reason: `URL "${redirect}" can't be used to redirect after login` });
			parsedUrl.searchParams.append("RelayState", redirect);
		}
		return res.redirect(parsedUrl.toString());
	}));
	router.post("/logout", async_handler_default(async (req, res) => {
		const { sp, idp } = getAuthProvider(providerName);
		const { context } = sp.createLogoutRequest(idp, "redirect", req.body);
		const authService = new AuthenticationService({
			accountability: req.accountability,
			schema: req.schema
		});
		const sessionCookieName = env["SESSION_COOKIE_NAME"];
		if (req.cookies[sessionCookieName]) {
			await authService.logout(req.cookies[sessionCookieName]);
			res.clearCookie(sessionCookieName, SESSION_COOKIE_OPTIONS);
		}
		return res.redirect(context);
	}));
	router.post("/acs", express.urlencoded({ extended: false }), async_handler_default(async (req, res, next) => {
		const logger = useLogger();
		const relayState = req.body?.RelayState;
		const authMode = env[`AUTH_${providerName.toUpperCase()}_MODE`] ?? "session";
		try {
			const { sp, idp } = getAuthProvider(providerName);
			const { extract } = await sp.parseLoginResponse(idp, "post", req);
			const { accessToken, refreshToken, expires } = await new AuthenticationService({
				accountability: req.accountability,
				schema: req.schema
			}).login(providerName, extract.attributes, { session: authMode === "session" });
			res.locals["payload"] = { data: {
				access_token: accessToken,
				refresh_token: refreshToken,
				expires
			} };
			if (relayState) {
				if (authMode === "session") res.cookie(env["SESSION_COOKIE_NAME"], accessToken, SESSION_COOKIE_OPTIONS);
				else res.cookie(env["REFRESH_TOKEN_COOKIE_NAME"], refreshToken, REFRESH_COOKIE_OPTIONS);
				return res.redirect(relayState);
			}
			return next();
		} catch (error) {
			if (relayState) {
				let reason = "UNKNOWN_EXCEPTION";
				if (isDirectusError(error)) reason = error.code;
				else logger.warn(error, `[SAML] Unexpected error during SAML login`);
				return res.redirect(`${relayState.split("?")[0]}?reason=${reason}`);
			}
			logger.warn(error, `[SAML] Unexpected error during SAML login`);
			throw error;
		}
	}), respond);
	return router;
}

//#endregion
export { SAMLAuthDriver, createSAMLAuthRouter };