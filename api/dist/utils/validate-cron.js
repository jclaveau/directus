import { CronExpressionParser } from "cron-parser";

//#region src/utils/validate-cron.ts
function validateCron(rule) {
	try {
		CronExpressionParser.parse(rule);
	} catch {
		return false;
	}
	return true;
}

//#endregion
export { validateCron };