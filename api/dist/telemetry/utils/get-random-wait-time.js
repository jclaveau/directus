//#region src/telemetry/utils/get-random-wait-time.ts
/**
* Returns randomized value between 0 and 1.8e+6 (30min in ms) intended to be used as the randomized wait for
* telemetry tracking
*/
const getRandomWaitTime = () => Math.floor(Math.random() * 18e5);

//#endregion
export { getRandomWaitTime };