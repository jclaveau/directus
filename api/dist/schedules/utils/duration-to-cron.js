import { random } from "lodash-es";

//#region src/schedules/utils/duration-to-cron.ts
const HOURS_IN_SECONDS = 3600;
const ALLOWED_HOURS = new Set([
	1,
	2,
	3,
	4,
	6,
	8,
	12
]);
/**
* Convert a duration in seconds into a cron expression
*
* - Honored intervals (hours): 1, 2, 3, 4, 6, 8, 12.
* - Random hour offset within [0, hours) spreads load across phase groups.
* - Any duration outside interval falls back to daily.
*
*   3600 (1h)   → fires every hour at random minute and second
*   7200 (2h)   → fires every 2h, phase offset 0 or 1
*   25200 (7h)  → daily fallback
*/
function durationToCron(duration) {
	const second = random(0, 59);
	const minute = random(0, 59);
	if (duration > 0 && duration % HOURS_IN_SECONDS === 0) {
		const hours = duration / HOURS_IN_SECONDS;
		if (ALLOWED_HOURS.has(hours)) return `${second} ${minute} ${hours === 1 ? "*" : random(0, hours - 1)}/${hours} * * *`;
	}
	return `${second} ${minute} ${random(0, 23)} * * *`;
}

//#endregion
export { durationToCron };