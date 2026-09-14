/**
 * The boolean variables the processes read, checked at boot wherever one of
 * them boots.
 *
 * Listed once rather than at each entry: the autoscaler and the server read
 * the same deployment's environment, and a check only one of them ran would
 * let the other come up on a value it reads as false.
 */
export const PROCESSES_BOOLEAN_ENV = [
	'PM2_AUTOSCALE_ENABLED',
	'PM2_AUTOSCALE_DRILL_ENABLED',
];
