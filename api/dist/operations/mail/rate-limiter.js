import { createRateLimiter } from "../../rate-limiter.js";
import { useEnv } from "@directus/env";
import { EmailLimitExceededError } from "@directus/errors";
import { toBoolean } from "@directus/utils";
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";

//#region src/operations/mail/rate-limiter.ts
let emailRateLimiter;
const env = useEnv();
if (toBoolean(env["RATE_LIMITER_EMAIL_FLOWS_ENABLED"]) === true) emailRateLimiter = createRateLimiter("RATE_LIMITER_EMAIL_FLOWS");
async function useFlowsEmailRateLimiter(flow_id) {
	if (!emailRateLimiter) return;
	try {
		await emailRateLimiter.consume(flow_id, 1);
	} catch (err) {
		if (err instanceof RateLimiterRes) throw new EmailLimitExceededError({
			points: "RATE_LIMITER_EMAIL_FLOWS_POINTS" in env ? Number(env["RATE_LIMITER_EMAIL_FLOWS_POINTS"]) : void 0,
			duration: "RATE_LIMITER_EMAIL_FLOWS_DURATION" in env ? Number(env["RATE_LIMITER_EMAIL_FLOWS_DURATION"]) : void 0,
			message: "RATE_LIMITER_EMAIL_FLOWS_ERROR_MESSAGE" in env ? String(env["RATE_LIMITER_EMAIL_FLOWS_ERROR_MESSAGE"]) : void 0
		});
		throw err;
	}
}

//#endregion
export { useFlowsEmailRateLimiter };