import async_handler_default from "../../utils/async-handler.js";
import { useLogger } from "../../logger/index.js";
import { REFRESH_COOKIE_OPTIONS, SESSION_COOKIE_OPTIONS } from "../../constants.js";
import database_default from "../../database/index.js";
import emitter_default from "../../emitter.js";
import { createDefaultAccountability } from "../../permissions/utils/create-default-accountability.js";
import { getSchema } from "../../utils/get-schema.js";
import { respond } from "../../middleware/respond.js";
import { getIPFromReq } from "../../utils/get-ip-from-req.js";
import { AuthDriver } from "../auth.js";
import { checkSsoEnabled } from "../utils/check-sso-enabled.js";
import { AuthenticationService } from "../../services/authentication.js";
import { useEnv } from "@directus/env";
import { ErrorCode, InvalidCredentialsError, InvalidPayloadError, InvalidProviderConfigError, InvalidProviderError, ServiceUnavailableError, UnexpectedResponseError, isDirectusError } from "@directus/errors";
import { Router } from "express";
import Joi from "joi";
import { Client, InappropriateAuthError, InsufficientAccessError, InvalidCredentialsError as InvalidCredentialsError$1 } from "ldapts";

//#region src/auth/drivers/ldap.ts
const INVALID_ACCOUNT_FLAGS = 8388626;
var LDAPAuthDriver = class extends AuthDriver {
	bindClient;
	config;
	constructor(options, config) {
		super(options, config);
		const logger = useLogger();
		const { bindDn, bindPassword, userDn, provider, clientUrl } = config;
		if (bindDn === void 0 || bindPassword === void 0 || !userDn || !provider || !clientUrl && !config["client"]?.socketPath) {
			logger.error("Invalid provider config");
			throw new InvalidProviderConfigError({ provider });
		}
		this.bindClient = new Client({
			url: clientUrl,
			...typeof config["client"] === "object" ? config["client"] : {}
		});
		this.config = config;
	}
	async validateBindClient() {
		const logger = useLogger();
		const { bindDn, bindPassword, provider } = this.config;
		try {
			await this.bindClient.bind(bindDn, bindPassword);
			const { searchEntries } = await this.bindClient.search(bindDn, { scope: "base" });
			if (searchEntries.length === 0) {
				logger.warn("[LDAP] Failed to find bind user record");
				throw new UnexpectedResponseError();
			}
		} catch (err) {
			const error = handleError(err);
			if (isDirectusError(error, ErrorCode.InvalidCredentials)) {
				logger.warn("Invalid bind user");
				throw new InvalidProviderConfigError({ provider });
			}
			throw error;
		}
	}
	async fetchUserInfo(baseDn, filter, scope) {
		let { firstNameAttribute, lastNameAttribute, mailAttribute } = this.config;
		firstNameAttribute ??= "givenName";
		lastNameAttribute ??= "sn";
		mailAttribute ??= "mail";
		try {
			const searchOptions = { attributes: [
				"uid",
				firstNameAttribute,
				lastNameAttribute,
				mailAttribute,
				"userAccountControl"
			] };
			if (filter !== void 0) searchOptions.filter = filter;
			if (scope !== void 0) searchOptions.scope = scope;
			const { searchEntries } = await this.bindClient.search(baseDn, searchOptions);
			if (searchEntries.length === 0) return;
			const entry = searchEntries[0];
			const user = {
				dn: entry["dn"],
				userAccountControl: Number(getEntryValue(entry["userAccountControl"]) ?? 0)
			};
			const firstName = getEntryValue(entry[firstNameAttribute]);
			if (firstName) user.firstName = firstName;
			const lastName = getEntryValue(entry[lastNameAttribute]);
			if (lastName) user.lastName = lastName;
			const email = getEntryValue(entry[mailAttribute]);
			if (email) user.email = email;
			const uid = getEntryValue(entry["uid"]);
			if (uid) user.uid = uid;
			return user;
		} catch (err) {
			throw handleError(err);
		}
	}
	async fetchUserGroups(baseDn, filter, scope) {
		try {
			const searchOptions = { attributes: ["cn"] };
			if (filter !== void 0) searchOptions.filter = filter;
			if (scope !== void 0) searchOptions.scope = scope;
			const { searchEntries } = await this.bindClient.search(baseDn, searchOptions);
			const userGroups = [];
			for (const entry of searchEntries) {
				const cn = entry["cn"];
				if (Array.isArray(cn)) userGroups.push(...cn.map((v) => String(v)));
				else if (cn) userGroups.push(String(cn));
			}
			return userGroups;
		} catch (err) {
			throw handleError(err);
		}
	}
	async fetchUserId(userDn) {
		return (await this.knex.select("id").from("directus_users").orWhereRaw("LOWER(??) = ?", ["external_identifier", userDn.toLowerCase()]).first())?.id;
	}
	async getUserID(payload) {
		if (!payload["identifier"]) throw new InvalidCredentialsError();
		const logger = useLogger();
		await this.validateBindClient();
		const { userDn, userScope, userAttribute, groupDn, groupScope, groupAttribute, defaultRoleId, syncUserInfo } = this.config;
		const userInfo = await this.fetchUserInfo(userDn, `(${validateLDAPAttribute(userAttribute ?? "cn")}=${escapeFilterValue(payload["identifier"])})`, userScope ?? "one");
		if (!userInfo?.dn) throw new InvalidCredentialsError();
		let userRole;
		if (groupDn) {
			const groupAttr = groupAttribute ?? "member";
			const memberValue = groupAttr.toLowerCase() === "memberuid" && userInfo.uid ? userInfo.uid : userInfo.dn;
			const userGroups = await this.fetchUserGroups(groupDn, `(${validateLDAPAttribute(groupAttr)}=${escapeFilterValue(memberValue)})`, groupScope ?? "one");
			if (userGroups.length) userRole = await this.knex.select("id").from("directus_roles").whereRaw(`LOWER(??) IN (${userGroups.map(() => "?")})`, ["name", ...userGroups.map((group) => group.toLowerCase())]).first();
		}
		const userId = await this.fetchUserId(userInfo.dn);
		if (userId) {
			let emitPayload = {};
			if (groupDn) emitPayload = { role: userRole?.id ?? defaultRoleId ?? null };
			if (syncUserInfo) emitPayload = {
				...emitPayload,
				first_name: userInfo.firstName,
				last_name: userInfo.lastName,
				email: userInfo.email
			};
			const schema$1 = await getSchema();
			const updatedUserPayload$1 = await emitter_default.emitFilter(`auth.update`, emitPayload, {
				identifier: userInfo.dn,
				provider: this.config["provider"],
				providerPayload: {
					userInfo,
					userRole
				}
			}, {
				database: database_default(),
				schema: schema$1,
				accountability: null
			});
			await this.getUsersService(schema$1).updateOne(userId, updatedUserPayload$1);
			return userId;
		}
		if (!userInfo) throw new InvalidCredentialsError();
		const userPayload = {
			provider: this.config["provider"],
			first_name: userInfo.firstName,
			last_name: userInfo.lastName,
			email: userInfo.email,
			external_identifier: userInfo.dn,
			role: userRole?.id ?? defaultRoleId
		};
		const schema = await getSchema();
		const updatedUserPayload = await emitter_default.emitFilter(`auth.create`, userPayload, {
			identifier: userInfo.dn,
			provider: this.config["provider"],
			providerPayload: {
				userInfo,
				userRole
			}
		}, {
			database: database_default(),
			schema,
			accountability: null
		});
		try {
			await this.getUsersService(schema).createOne(updatedUserPayload);
		} catch (e) {
			if (isDirectusError(e, ErrorCode.RecordNotUnique)) {
				logger.warn(e, "[LDAP] Failed to register user. User not unique");
				throw new InvalidProviderError();
			}
			throw e;
		}
		return await this.fetchUserId(userInfo.dn);
	}
	async verify(user, password) {
		if (!user.external_identifier || !password) throw new InvalidCredentialsError();
		const clientConfig = typeof this.config["client"] === "object" ? this.config["client"] : {};
		const client = new Client({
			url: this.config["clientUrl"],
			...clientConfig
		});
		try {
			await client.bind(user.external_identifier, password);
		} catch (err) {
			throw handleError(err);
		} finally {
			await client.unbind().catch(() => {});
		}
	}
	async login(user, payload) {
		await this.verify(user, payload["password"]);
	}
	async refresh(user) {
		await this.validateBindClient();
		const userInfo = await this.fetchUserInfo(user.external_identifier, void 0, "base");
		if (userInfo?.userAccountControl && userInfo.userAccountControl & INVALID_ACCOUNT_FLAGS) throw new InvalidCredentialsError();
	}
};
const handleError = (e) => {
	if (e instanceof InappropriateAuthError || e instanceof InvalidCredentialsError$1 || e instanceof InsufficientAccessError) return new InvalidCredentialsError();
	if (e instanceof Error) return new ServiceUnavailableError({
		service: "ldap",
		reason: `Service returned unexpected error: ${e.message}`
	});
	return new ServiceUnavailableError({
		service: "ldap",
		reason: "Service returned unexpected error"
	});
};
const getEntryValue = (value) => {
	if (value === void 0) return void 0;
	if (Buffer.isBuffer(value)) return value.toString();
	if (Array.isArray(value)) {
		const first = value[0];
		if (Buffer.isBuffer(first)) return first.toString();
		return first;
	}
	return value;
};
/**
* Escape special characters in LDAP filter values according to RFC 4515
*/
const escapeFilterValue = (value) => {
	return value.replace(/\\/g, "\\5c").replace(/\*/g, "\\2a").replace(/\(/g, "\\28").replace(/\)/g, "\\29").replace(/\0/g, "\\00");
};
/**
* Validate LDAP attribute name according to RFC 4512
*/
const validateLDAPAttribute = (name) => {
	if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(name) === false) throw new Error(`Invalid LDAP attribute name: "${name}"`);
	return name;
};
function createLDAPAuthRouter(provider) {
	const router = Router();
	const loginSchema = Joi.object({
		identifier: Joi.string().required(),
		password: Joi.string().required(),
		mode: Joi.string().valid("cookie", "json", "session"),
		otp: Joi.string()
	}).unknown();
	router.use(checkSsoEnabled);
	router.post("/", async_handler_default(async (req, res, next) => {
		const env = useEnv();
		const accountability = createDefaultAccountability({ ip: getIPFromReq(req) });
		const userAgent = req.get("user-agent")?.substring(0, 1024);
		if (userAgent) accountability.userAgent = userAgent;
		const origin = req.get("origin");
		if (origin) accountability.origin = origin;
		const authenticationService = new AuthenticationService({
			accountability,
			schema: req.schema
		});
		const { error } = loginSchema.validate(req.body);
		if (error) throw new InvalidPayloadError({ reason: error.message });
		const mode = req.body.mode ?? "json";
		const { accessToken, refreshToken, expires } = await authenticationService.login(provider, req.body, {
			session: mode === "session",
			otp: req.body?.otp
		});
		const payload = {
			access_token: accessToken,
			expires
		};
		if (mode === "json") payload.refresh_token = refreshToken;
		if (mode === "cookie") res.cookie(env["REFRESH_TOKEN_COOKIE_NAME"], refreshToken, REFRESH_COOKIE_OPTIONS);
		if (mode === "session") res.cookie(env["SESSION_COOKIE_NAME"], accessToken, SESSION_COOKIE_OPTIONS);
		res.locals["payload"] = { data: payload };
		return next();
	}), respond);
	return router;
}

//#endregion
export { LDAPAuthDriver, createLDAPAuthRouter };