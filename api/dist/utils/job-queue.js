//#region src/utils/job-queue.ts
var JobQueue = class {
	running;
	jobs;
	constructor() {
		this.running = false;
		this.jobs = [];
	}
	enqueue(job) {
		this.jobs.push(job);
		if (!this.running) this.run();
	}
	async run() {
		this.running = true;
		try {
			while (this.jobs.length > 0) await this.jobs.shift()();
		} finally {
			this.running = false;
		}
	}
	get size() {
		return this.jobs.length;
	}
};

//#endregion
export { JobQueue };