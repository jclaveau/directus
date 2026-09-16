export type { SupervisedProcessEnv } from './lib/env.js';
export type { WorkerMessage } from './lib/client.js';
export {
	connectToSupervisor,
	disconnectFromSupervisor,
	listSupervisedApps,
	releaseWorker,
	reloadApp,
	scaleApp,
	sendToSupervisedProcess,
	supervisorAvailable,
	watchWorkerMessages,
} from './lib/client.js';
