export type { SupervisedProcessEnv } from './lib/env.js';
export {
	connectToSupervisor,
	disconnectFromSupervisor,
	listSupervisedApps,
	reloadApp,
	scaleApp,
	sendToSupervisedProcess,
	supervisorAvailable,
} from './lib/client.js';
