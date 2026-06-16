import { IpBlocklist } from "@directus/utils/node";
import { isIP } from "node:net";
import { resolve4, resolve6 } from "node:dns/promises";

//#region src/services/mcp-oauth/utils/cimd-egress.ts
const DEFAULT_DNS_DEADLINE_MS = 1e3;
const IPV4_SPECIAL_USE_CIDRS = [
	"0.0.0.0/8",
	"0.0.0.0/32",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.0.0.0/29",
	"192.0.0.8/32",
	"192.0.0.9/32",
	"192.0.0.10/32",
	"192.0.0.170/32",
	"192.0.0.171/32",
	"192.0.2.0/24",
	"192.31.196.0/24",
	"192.52.193.0/24",
	"192.88.99.2/32",
	"192.168.0.0/16",
	"192.175.48.0/24",
	"198.18.0.0/15",
	"198.51.100.0/24",
	"203.0.113.0/24",
	"240.0.0.0/4",
	"255.255.255.255/32"
];
const IPV6_SPECIAL_USE_CIDRS = [
	"::/128",
	"::1/128",
	"::ffff:0:0/96",
	"64:ff9b::/96",
	"64:ff9b:1::/48",
	"100::/64",
	"100:0:0:1::/64",
	"2001::/23",
	"2001::/32",
	"2001:1::1/128",
	"2001:1::2/128",
	"2001:1::3/128",
	"2001:2::/48",
	"2001:3::/32",
	"2001:4:112::/48",
	"2001:20::/28",
	"2001:30::/28",
	"2001:db8::/32",
	"2002::/16",
	"2620:4f:8000::/48",
	"3fff::/20",
	"5f00::/16",
	"fc00::/7",
	"fe80::/10"
];
const specialUseIpv4Blocklist = new IpBlocklist();
const specialUseIpv6Blocklist = new IpBlocklist();
for (const cidr of IPV4_SPECIAL_USE_CIDRS) specialUseIpv4Blocklist.parseSubnet(cidr);
for (const cidr of IPV6_SPECIAL_USE_CIDRS) specialUseIpv6Blocklist.parseSubnet(cidr);
var CimdEgressError = class extends Error {
	reason;
	constructor(reason, options) {
		super(reason, options);
		this.name = "CimdEgressError";
		this.reason = reason;
	}
};
const defaultResolver = {
	resolve4,
	resolve6
};
/** Fail-closed IP classifier for the CIMD egress policy. */
function isSpecialUseIp(ip) {
	const family = isIP(ip);
	if (family === 0) return true;
	try {
		return family === 4 ? specialUseIpv4Blocklist.check(ip, "ipv4") : specialUseIpv6Blocklist.check(ip, "ipv6");
	} catch {
		return true;
	}
}
function createCimdLookup(options) {
	return (hostname, optionsOrCallback, callback) => {
		const lookupOptions = normalizeLookupOptions(optionsOrCallback);
		let settled = false;
		const settleOnce = (settle) => {
			if (settled) return;
			settled = true;
			settle();
		};
		const validationOptions = { deadlineAt: options.deadlineAt };
		if (options.resolver) validationOptions.resolver = options.resolver;
		validateCimdHostnameEgress(hostname, validationOptions).then((addresses) => {
			const family = lookupOptions.family;
			const selected = selectAddresses(addresses, family);
			if (selected.length === 0) {
				settleOnce(() => callback(new CimdEgressError("cimd_dns_empty_result"), ""));
				return;
			}
			if (lookupOptions.all) {
				settleOnce(() => callback(null, selected));
				return;
			}
			const first = selected[0];
			settleOnce(() => callback(null, first.address, first.family));
		}).catch((error) => {
			settleOnce(() => callback(error, ""));
		});
	};
}
async function validateCimdHostnameEgress(hostname, options = {}) {
	if (isIP(hostname.replace(/^\[|\]$/g, ""))) throw new CimdEgressError("cimd_dns_ip_literal");
	const deadlineAt = options.deadlineAt ?? performance.now() + DEFAULT_DNS_DEADLINE_MS;
	const resolver = options.resolver ?? defaultResolver;
	if (deadlineAt - performance.now() <= 0) throw new CimdEgressError("cimd_dns_timeout");
	return withDeadline(resolveAndValidate(hostname, resolver), deadlineAt);
}
async function resolveAndValidate(hostname, resolver) {
	const [addresses4, addresses6] = await Promise.all([resolveFamily(() => resolver.resolve4(hostname)), resolveFamily(() => resolver.resolve6(hostname))]);
	if (addresses4.length === 0 && addresses6.length === 0) throw new CimdEgressError("cimd_dns_empty_result");
	for (const address of [...addresses4, ...addresses6]) if (isSpecialUseIp(address)) throw new CimdEgressError("cimd_dns_special_use_ip");
	return {
		addresses4,
		addresses6
	};
}
async function resolveFamily(resolve) {
	try {
		return await resolve();
	} catch (error) {
		if (isEmptyDnsResult(error)) return [];
		throw new CimdEgressError("cimd_dns_error", { cause: error });
	}
}
function isEmptyDnsResult(error) {
	return typeof error === "object" && error !== null && "code" in error && (error.code === "ENODATA" || error.code === "ENOTFOUND");
}
async function withDeadline(promise, deadlineAt) {
	const remainingMs = Math.min(DEFAULT_DNS_DEADLINE_MS, deadlineAt - performance.now());
	if (remainingMs <= 0) throw new CimdEgressError("cimd_dns_timeout");
	let timeoutId;
	const timeout = new Promise((_, reject) => {
		timeoutId = setTimeout(() => reject(new CimdEgressError("cimd_dns_timeout")), Math.ceil(remainingMs));
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
}
function normalizeLookupOptions(options) {
	const lookupOptions = options;
	return {
		all: lookupOptions.all === true,
		family: normalizeFamily(lookupOptions.family)
	};
}
function normalizeFamily(family) {
	if (family === 4 || family === "IPv4") return 4;
	if (family === 6 || family === "IPv6") return 6;
	return 0;
}
function selectAddresses(addresses, family) {
	const addresses4 = addresses.addresses4.map((address) => ({
		address,
		family: 4
	}));
	const addresses6 = addresses.addresses6.map((address) => ({
		address,
		family: 6
	}));
	if (family === 4) return addresses4;
	if (family === 6) return addresses6;
	return [...addresses4, ...addresses6];
}

//#endregion
export { CimdEgressError, createCimdLookup, isSpecialUseIp, validateCimdHostnameEgress };