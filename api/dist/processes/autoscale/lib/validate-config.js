import { InvalidPayloadError } from "@directus/errors";
import { AUTOSCALE_BOUNDS } from "@directus/constants";

//#region src/processes/autoscale/lib/validate-config.ts
/**
* Everything wrong with a configuration, in the words of the fields it names.
*
* The loop clamps rather than refuses, because it has to act on whatever the
* environment and the key hold — it cannot answer anyone. A write can, and
* silently correcting one is the worse failure of the two: an operator who
* raised a ceiling during an incident and watched the pool ignore it has no
* way to tell a corrected value from a refused one.
*
* Judged on the whole configuration, not on the patch: a floor is only too
* high against the ceiling it will actually sit under, and that ceiling is
* usually a field nobody is changing.
*/
function configProblems(config) {
	const problems = [];
	for (const [field, bound] of Object.entries(AUTOSCALE_BOUNDS)) {
		const value = config[field];
		if (Number.isInteger(value) === false) {
			problems.push(`'${field}' has to be a whole number of ${bound.unit}`);
			continue;
		}
		if (value < bound.low || value > bound.high) problems.push(`'${field}' is ${value} and has to be between ${bound.low} and ${bound.high} ${bound.unit}`);
	}
	if (config.appName.trim() === "") problems.push(`'appName' has to name the pm2 app to scale`);
	if (config.minWorkers > config.maxWorkers) problems.push(`'minWorkers' is ${config.minWorkers}, above the 'maxWorkers' ceiling of ${config.maxWorkers}`);
	if (config.prewarmWorkers > config.maxWorkers) problems.push(`'prewarmWorkers' is ${config.prewarmWorkers}, above the 'maxWorkers' ceiling of ${config.maxWorkers}`);
	if (config.releaseCpuThreshold >= config.scaleCpuThreshold) problems.push(`'releaseCpuThreshold' is ${config.releaseCpuThreshold}% and has to stay under the 'scaleCpuThreshold' of ${config.scaleCpuThreshold}%`);
	return problems;
}
/** The same, as the answer a write gets: every problem at once, or nothing. */
function assertUsableConfig(config) {
	const problems = configProblems(config);
	if (problems.length > 0) throw new InvalidPayloadError({ reason: problems.join("; ") });
}

//#endregion
export { assertUsableConfig, configProblems };