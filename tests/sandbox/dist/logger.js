import chalk from "chalk";

//#region src/logger.ts
const logLevels = [
	"fatal",
	"error",
	"warn",
	"info",
	"debug",
	"trace"
];
const listeners = {};
function createLogger(env, opts, ...groups) {
	return {
		addGroup: (group) => {
			return createLogger(env, opts, ...groups, group);
		},
		fatal: (msg) => log(env, opts, msg, "fatal", ...groups),
		error: (msg) => log(env, opts, msg, "error", ...groups),
		warn: (msg) => log(env, opts, msg, "warn", ...groups),
		info: (msg) => log(env, opts, msg, "info", ...groups),
		debug: (msg) => log(env, opts, msg, "debug", ...groups),
		pipe: (stream, type) => {
			if (stream) stream.on("data", (data) => log(env, opts, String(data), type, ...groups));
		},
		onLog: (listener) => {
			const key = groups.join(".");
			if (!listeners[key]) listeners[key] = [];
			listeners[key].push(listener);
		}
	};
}
function logLevel(level) {
	return logLevels.findIndex((l) => l === String(level).toLowerCase());
}
const logLevelColor = {
	debug: "blue",
	error: "red",
	fatal: "black",
	info: "green",
	warn: "yellow",
	trace: "blueBright"
};
function log(env, opts, message, type = "info", ...groups) {
	const formattedMessage = groups.map((group) => chalk.blueBright(`[${group}] `)).join("") + chalk[logLevelColor[type]](`[${type}] `) + message + (message.endsWith("\n") ? "" : "\n");
	if (logLevel(env.LOG_LEVEL ?? "info") >= logLevel(type) && (!opts.silent || type === "error" || type === "fatal")) process.stdout.write(formattedMessage);
	for (const [key, listener] of Object.entries(listeners)) if (groups.join(".").startsWith(key)) listener.forEach((l) => l(message, type, groups));
}

//#endregion
export { createLogger };