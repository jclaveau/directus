import http from "http";
import https from "https";
import dns from "dns";

//#region src/request/request-tracker.ts
var RequestTracker = class {
	requests = [];
	verbose;
	logToConsole;
	originalHttpRequest;
	originalHttpsRequest;
	originalDnsLookup;
	constructor(options = {}) {
		this.verbose = options.verbose !== false;
		this.logToConsole = options.logToConsole !== false;
		this.originalHttpRequest = http.request;
		this.originalHttpsRequest = https.request;
		this.originalDnsLookup = dns.lookup;
	}
	start() {
		const originalHttpRequest = http.request;
		http.request = ((...args) => {
			const req = originalHttpRequest(...args);
			this._trackRequest("http", args, req);
			return req;
		});
		const originalHttpsRequest = https.request;
		https.request = ((...args) => {
			const req = originalHttpsRequest(...args);
			this._trackRequest("https", args, req);
			return req;
		});
		if (this.logToConsole) console.log("🔍 Request tracker started");
	}
	stop() {
		http.request = this.originalHttpRequest;
		https.request = this.originalHttpsRequest;
		dns.lookup = this.originalDnsLookup;
		if (this.logToConsole) console.log("🛑 Request tracker stopped");
	}
	_trackRequest(protocol, args, req) {
		const options = this._parseRequestArgs(args);
		const startTime = Date.now();
		const requestInfo = {
			protocol,
			method: options.method || "GET",
			host: options.hostname || options.host || "localhost",
			port: options.port || (protocol === "https" ? 443 : 80),
			path: options.path || "/",
			timestamp: (/* @__PURE__ */ new Date()).toISOString(),
			startTime,
			headers: options.headers || {}
		};
		if (this.verbose && this.logToConsole) console.log(`\n📡 ${requestInfo.method} ${protocol}://${requestInfo.host}:${requestInfo.port}${requestInfo.path}`);
		req.on("response", (res) => {
			const duration = Date.now() - startTime;
			requestInfo.statusCode = res.statusCode;
			requestInfo.duration = duration;
			requestInfo.responseHeaders = res.headers;
			if (this.verbose && this.logToConsole) console.log(`✅ Response: ${res.statusCode} (${duration}ms)`);
			this.requests.push(requestInfo);
		});
		req.on("error", (err) => {
			const duration = Date.now() - startTime;
			requestInfo.error = err.message;
			requestInfo.duration = duration;
			if (this.verbose && this.logToConsole) console.log(`❌ Error: ${err.message} (${duration}ms)`);
			this.requests.push(requestInfo);
		});
	}
	_parseRequestArgs(args) {
		if (typeof args[0] === "string") {
			const url = new URL(args[0]);
			return {
				hostname: url.hostname,
				port: url.port,
				path: url.pathname + url.search,
				method: args[1]?.method || "GET",
				headers: args[1]?.headers || {}
			};
		}
		return args[0] || {};
	}
	getRequests() {
		return this.requests;
	}
	getSummary() {
		const httpRequests = this.requests.filter((r) => "protocol" in r);
		return {
			total: this.requests.length,
			http: httpRequests.filter((r) => r.protocol === "http").length,
			https: httpRequests.filter((r) => r.protocol === "https").length,
			errors: this.requests.filter((r) => "error" in r && r.error).length,
			avgDuration: this._calculateAvgDuration(httpRequests),
			hosts: [...new Set(httpRequests.map((r) => r.host))]
		};
	}
	_calculateAvgDuration(requests) {
		const durations = requests.filter((r) => r.duration).map((r) => r.duration);
		if (durations.length === 0) return 0;
		return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
	}
	printSummary() {
		const summary = this.getSummary();
		console.log("\n📊 Request Summary:");
		console.log(`   Total requests: ${summary.total}`);
		console.log(`   HTTP: ${summary.http} | HTTPS: ${summary.https} | DNS: ${summary.dns}`);
		console.log(`   Errors: ${summary.errors}`);
		console.log(`   Avg duration: ${summary.avgDuration}ms`);
		console.log(`   Unique hosts: ${summary.hosts.join(", ")}`);
	}
	clear() {
		this.requests = [];
	}
};
var request_tracker_default = RequestTracker;

//#endregion
export { request_tracker_default as default };