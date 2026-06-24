import { getConfigFromEnv } from "../utils/get-config-from-env.js";
import { LogsStream } from "./logs-stream.js";
import { redactQuery } from "./redact-query.js";
import { useEnv } from "@directus/env";
import { REDACTED_TEXT, toArray, toBoolean } from "@directus/utils";
import { merge } from "lodash-es";
import { URL } from "node:url";
import { pino } from "pino";
import { pinoHttp, stdSerializers } from "pino-http";
import { httpPrintFactory } from "pino-http-print";
import { build } from "pino-pretty";

//#region src/logger/index.ts
const _cache = {
	logger: void 0,
	logsStream: void 0,
	httpLogsStream: void 0
};
const useLogger = () => {
	if (_cache.logger) return _cache.logger;
	_cache.logger = createLogger();
	return _cache.logger;
};
const getLogsStream = (pretty) => {
	if (_cache.logsStream) return _cache.logsStream;
	_cache.logsStream = new LogsStream(pretty ? "basic" : false);
	return _cache.logsStream;
};
const getHttpLogsStream = (pretty) => {
	if (_cache.httpLogsStream) return _cache.httpLogsStream;
	_cache.httpLogsStream = new LogsStream(pretty ? "http" : false);
	return _cache.httpLogsStream;
};
const getLoggerLevelValue = (level) => {
	return pino.levels.values[level] || pino.levels.values["info"];
};
const createLogger = () => {
	const env = useEnv();
	const pinoOptions = {
		level: env["LOG_LEVEL"] || "info",
		redact: {
			paths: ["req.headers.authorization", "req.headers.cookie"],
			censor: REDACTED_TEXT
		}
	};
	const loggerEnvConfig = getConfigFromEnv("LOGGER_", { omitPrefix: "LOGGER_HTTP" });
	if (loggerEnvConfig["levels"]) {
		const customLogLevels = {};
		for (const el of toArray(loggerEnvConfig["levels"])) {
			const key_val = el.split(":");
			customLogLevels[key_val[0].trim()] = key_val[1].trim();
		}
		pinoOptions.formatters = { level(label, number) {
			return {
				severity: customLogLevels[label] || "info",
				level: number
			};
		} };
		delete loggerEnvConfig["levels"];
	}
	const mergedOptions = merge(pinoOptions, loggerEnvConfig);
	const streams = [];
	if (env["LOG_STYLE"] !== "raw") streams.push({
		level: mergedOptions.level,
		stream: build({
			ignore: "hostname,pid",
			sync: true
		})
	});
	else streams.push({
		level: mergedOptions.level,
		stream: process.stdout
	});
	if (toBoolean(env["WEBSOCKETS_LOGS_ENABLED"])) {
		const wsLevel = env["WEBSOCKETS_LOGS_LEVEL"] || "info";
		if (getLoggerLevelValue(wsLevel) < getLoggerLevelValue(mergedOptions.level)) mergedOptions.level = wsLevel;
		streams.push({
			level: wsLevel,
			stream: getLogsStream(env["WEBSOCKETS_LOGS_STYLE"] !== "raw")
		});
	}
	return pino(mergedOptions, pino.multistream(streams));
};
const createExpressLogger = () => {
	const env = useEnv();
	const httpLoggerEnvConfig = getConfigFromEnv("LOGGER_HTTP", { omitPrefix: "LOGGER_HTTP_LOGGER" });
	const loggerEnvConfig = getConfigFromEnv("LOGGER_", { omitPrefix: "LOGGER_HTTP" });
	const httpLoggerOptions = {
		level: env["LOG_LEVEL"] || "info",
		redact: {
			paths: ["req.headers.authorization", "req.headers.cookie"],
			censor: REDACTED_TEXT
		}
	};
	if (env["LOG_STYLE"] === "raw" || toBoolean(env["WEBSOCKETS_LOGS_ENABLED"])) httpLoggerOptions.redact = {
		paths: [
			"req.headers.authorization",
			"req.headers.cookie",
			"res.headers",
			"req.query.access_token"
		],
		censor: (value, pathParts) => {
			if (pathParts.join(".") === "res.headers") {
				if ("set-cookie" in value) value["set-cookie"] = REDACTED_TEXT;
				return value;
			}
			return REDACTED_TEXT;
		}
	};
	if (loggerEnvConfig["levels"]) {
		const customLogLevels = {};
		for (const el of toArray(loggerEnvConfig["levels"])) {
			const key_val = el.split(":");
			customLogLevels[key_val[0].trim()] = key_val[1].trim();
		}
		httpLoggerOptions.formatters = { level(label, number) {
			return {
				severity: customLogLevels[label] || "info",
				level: number
			};
		} };
		delete loggerEnvConfig["levels"];
	}
	if (env["LOG_HTTP_IGNORE_PATHS"]) {
		const ignorePathsSet = new Set(env["LOG_HTTP_IGNORE_PATHS"]);
		httpLoggerEnvConfig["autoLogging"] = { ignore: (req) => {
			if (!req.url) return false;
			const { pathname } = new URL(req.url, "http://example.com/");
			return ignorePathsSet.has(pathname);
		} };
	}
	const mergedHttpOptions = merge(httpLoggerOptions, loggerEnvConfig);
	const streams = [];
	if (env["LOG_STYLE"] !== "raw") {
		const pinoHttpPretty = httpPrintFactory({
			all: true,
			translateTime: "SYS:HH:MM:ss",
			relativeUrl: true,
			prettyOptions: {
				ignore: "hostname,pid",
				sync: true
			}
		});
		streams.push({
			level: mergedHttpOptions.level,
			stream: pinoHttpPretty(process.stdout)
		});
	} else streams.push({
		level: mergedHttpOptions.level,
		stream: process.stdout
	});
	if (toBoolean(env["WEBSOCKETS_LOGS_ENABLED"])) {
		const wsLevel = env["WEBSOCKETS_LOGS_LEVEL"] || "info";
		if (getLoggerLevelValue(wsLevel) < getLoggerLevelValue(mergedHttpOptions.level)) mergedHttpOptions.level = wsLevel;
		streams.push({
			level: wsLevel,
			stream: getHttpLogsStream(env["WEBSOCKETS_LOGS_STYLE"] !== "raw")
		});
	}
	return pinoHttp({
		logger: pino(mergedHttpOptions, pino.multistream(streams)),
		...httpLoggerEnvConfig,
		serializers: { req(request) {
			const output = stdSerializers.req(request);
			output.url = redactQuery(output.url);
			return output;
		} }
	});
};

//#endregion
export { _cache, createExpressLogger, createLogger, getHttpLogsStream, getLoggerLevelValue, getLogsStream, useLogger };