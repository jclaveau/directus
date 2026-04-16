import http from 'http';
interface TrackerOptions {
    verbose?: boolean;
    logToConsole?: boolean;
}
interface RequestInfo {
    protocol: string;
    method: string;
    host: string;
    port: number;
    path: string;
    timestamp: string;
    startTime: number;
    headers: Record<string, string | string[] | undefined>;
    statusCode?: number;
    duration?: number;
    responseHeaders?: http.IncomingHttpHeaders;
    error?: string;
}
interface DnsInfo {
    type: 'dns';
    hostname: string;
    address: string | null;
    duration: number;
    timestamp: string;
    error: string | null;
}
interface RequestSummary {
    total: number;
    http: number;
    https: number;
    dns?: number;
    errors: number;
    avgDuration: number;
    hosts: string[];
}
type TrackedRequest = RequestInfo | DnsInfo;
declare class RequestTracker {
    private requests;
    private verbose;
    private logToConsole;
    private originalHttpRequest;
    private originalHttpsRequest;
    private originalDnsLookup;
    constructor(options?: TrackerOptions);
    start(): void;
    stop(): void;
    private _trackRequest;
    private _parseRequestArgs;
    getRequests(): TrackedRequest[];
    getSummary(): RequestSummary;
    private _calculateAvgDuration;
    printSummary(): void;
    clear(): void;
}
export default RequestTracker;
export type { TrackerOptions, RequestInfo, DnsInfo, RequestSummary, TrackedRequest };
