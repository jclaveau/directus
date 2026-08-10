import { nanoid } from 'nanoid';

/**
 * This process's identity on the bus, stable for its lifetime. Shared by the logs
 * stream and the processes report so a log line and the process that emitted it
 * carry the same id across the two admin pages.
 */
export const nodeId = nanoid(8);
