import { useLock } from "../../lock/lib/use-lock.js";
import "../../lock/index.js";
import { waitTimeout } from "./utils/wait-timeout.js";
import { ERRORS } from "@tus/utils";

//#region src/services/tus/lockers.ts
/**
* TusLocker is an implementation of the Locker interface that manages locks in memory or using Redis.
* This class is designed for exclusive access control over resources, often used in scenarios like upload management.
*
* Locking Behavior:
* - When the `lock` method is invoked for an already locked resource, the `cancelReq` callback is called.
*   This signals to the current lock holder that another process is requesting the lock, encouraging them to release it as soon as possible.
* - The lock attempt continues until the specified timeout is reached. If the timeout expires and the lock is still not
*   available, an error is thrown to indicate lock acquisition failure.
*
* Lock Acquisition and Release:
* - The `lock` method implements a wait mechanism, allowing a lock request to either succeed when the lock becomes available,
*   or fail after the timeout period.
* - The `unlock` method releases a lock, making the resource available for other requests.
*/
var TusLocker = class {
	lockTimeout;
	acquireTimeout;
	constructor(options) {
		this.acquireTimeout = options?.acquireLockTimeout ?? 1e3 * 30;
		this.lockTimeout = options?.lockTimeout ?? 1e3 * 60;
	}
	newLock(id) {
		return new KvLock(id, this.lockTimeout, this.acquireTimeout);
	}
};
var KvLock = class {
	kv;
	constructor(id, lockTimeout = 1e3 * 60, acquireTimeout = 1e3 * 30) {
		this.id = id;
		this.lockTimeout = lockTimeout;
		this.acquireTimeout = acquireTimeout;
		this.kv = useLock();
	}
	async lock(signal, cancelReq) {
		const abortController = new AbortController();
		const abortSignal = AbortSignal.any([signal, abortController.signal]);
		const lock = await Promise.race([waitTimeout(this.acquireTimeout, abortSignal), this.acquireLock(this.id, cancelReq, abortSignal)]);
		abortController.abort();
		if (!lock) throw ERRORS.ERR_LOCK_TIMEOUT;
	}
	async acquireLock(id, requestRelease, signal) {
		const lockTime = await this.kv.get(id);
		if (signal.aborted) return typeof lockTime !== "undefined";
		const now = Date.now();
		if (!lockTime || Number(lockTime) < now - this.lockTimeout) {
			await this.kv.set(id, now);
			return true;
		}
		await requestRelease();
		return await new Promise((resolve, reject) => {
			setImmediate(() => {
				this.acquireLock(id, requestRelease, signal).then(resolve).catch(reject);
			});
		});
	}
	async unlock() {
		await this.kv.delete(this.id);
	}
};
let _locker = void 0;
function getTusLocker() {
	if (!_locker) _locker = new TusLocker();
	return _locker;
}

//#endregion
export { KvLock, TusLocker, getTusLocker };