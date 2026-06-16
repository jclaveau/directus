import async_handler_default from "../../utils/async-handler.js";
import { REFRESH_COOKIE_OPTIONS, SESSION_COOKIE_OPTIONS } from "../../constants.js";
import { createDefaultAccountability } from "../../permissions/utils/create-default-accountability.js";
import { stall } from "../../utils/stall.js";
import { respond } from "../../middleware/respond.js";
import { getIPFromReq } from "../../utils/get-ip-from-req.js";
import { AuthDriver } from "../auth.js";
import { checkLocalAuthDisabled } from "../utils/check-local-disabled.js";
import { AuthenticationService } from "../../services/authentication.js";
import { useEnv } from "@directus/env";
import { InvalidCredentialsError, InvalidPayloadError } from "@directus/errors";
import { Router } from "express";
import { performance } from "perf_hooks";
import Joi from "joi";
import argon2 from "argon2";

//#region src/auth/drivers/local.ts
var LocalAuthDriver = class extends AuthDriver {
	async getUserID(payload) {
		if (!payload["email"]) throw new InvalidCredentialsError();
		const user = await this.knex.select("id").from("directus_users").whereRaw("LOWER(??) = ?", ["email", payload["email"].toLowerCase()]).first();
		if (!user) throw new InvalidCredentialsError();
		return user.id;
	}
	async verify(user, password) {
		if (!user.password || !await argon2.verify(user.password, password)) throw new InvalidCredentialsError();
	}
	async login(user, payload) {
		await this.verify(user, payload["password"]);
	}
};
function createLocalAuthRouter(provider) {
	const env = useEnv();
	const router = Router();
	router.use(checkLocalAuthDisabled);
	const userLoginSchema = Joi.object({
		email: Joi.string().email().required(),
		password: Joi.string().required(),
		mode: Joi.string().valid("cookie", "json", "session"),
		otp: Joi.string()
	}).unknown();
	router.post("/", async_handler_default(async (req, res, next) => {
		const STALL_TIME = env["LOGIN_STALL_TIME"];
		const timeStart = performance.now();
		const accountability = createDefaultAccountability({ ip: getIPFromReq(req) });
		const userAgent = req.get("user-agent")?.substring(0, 1024);
		if (userAgent) accountability.userAgent = userAgent;
		const origin = req.get("origin");
		if (origin) accountability.origin = origin;
		const authenticationService = new AuthenticationService({
			accountability,
			schema: req.schema
		});
		const { error } = userLoginSchema.validate(req.body);
		if (error) {
			await stall(STALL_TIME, timeStart);
			throw new InvalidPayloadError({ reason: error.message });
		}
		const mode = req.body.mode ?? "json";
		const { accessToken, refreshToken, expires } = await authenticationService.login(provider, req.body, {
			session: mode === "session",
			otp: req.body?.otp
		});
		const payload = { expires };
		if (mode === "json") {
			payload.refresh_token = refreshToken;
			payload.access_token = accessToken;
		}
		if (mode === "cookie") {
			res.cookie(env["REFRESH_TOKEN_COOKIE_NAME"], refreshToken, REFRESH_COOKIE_OPTIONS);
			payload.access_token = accessToken;
		}
		if (mode === "session") res.cookie(env["SESSION_COOKIE_NAME"], accessToken, SESSION_COOKIE_OPTIONS);
		res.locals["payload"] = { data: payload };
		return next();
	}), respond);
	return router;
}

//#endregion
export { LocalAuthDriver, createLocalAuthRouter };