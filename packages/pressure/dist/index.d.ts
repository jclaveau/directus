import { RequestHandler } from "express";

//#region src/monitor.d.ts
type PressureMonitorOptions = {
  maxEventLoopDelay?: number | false;
  maxEventLoopUtilization?: number | false;
  maxMemoryHeapUsed?: number | false;
  maxMemoryRss?: number | false;
  sampleInterval?: number;
  resolution?: number;
};
declare class PressureMonitor {
  private memoryHeapUsed;
  private memoryRss;
  private eventLoopDelay;
  private eventLoopUtilization;
  private options;
  private histogram;
  private timeout;
  constructor(options?: PressureMonitorOptions);
  get overloaded(): boolean;
  private updateUsage;
  private updateMemoryUsage;
  private updateEventLoopUsage;
}
//#endregion
//#region src/express.d.ts
declare const handlePressure: (options: PressureMonitorOptions & {
  error?: Error;
  retryAfter?: string;
}) => RequestHandler;
//#endregion
export { PressureMonitor, PressureMonitorOptions, handlePressure };