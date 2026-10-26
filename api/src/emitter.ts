import type {
	ActionHandler,
	EventContext,
	FilterHandler,
	InitHandler,
	MutationEventContext,
	WrittenEventContext,
} from '@directus/types';
import { InvalidPayloadError } from '@directus/errors';
import { oneLine } from '@directus/utils';
import EventEmitter2 from 'eventemitter2';
import getDatabase from './database/index.js';
import { useLogger } from './logger/index.js';

export class Emitter {
	private filterEmitter;
	private lastFilterEmitter;
	private actionEmitter;
	private initEmitter;

	constructor() {
		const emitterOptions = {
			wildcard: true,
			verboseMemoryLeak: true,
			delimiter: '.',

			// This will ignore the "unspecified event" error
			ignoreErrors: true,
		};

		this.filterEmitter = new EventEmitter2(emitterOptions);
		this.lastFilterEmitter = new EventEmitter2(emitterOptions);
		this.actionEmitter = new EventEmitter2(emitterOptions);
		this.initEmitter = new EventEmitter2(emitterOptions);
	}

	private getDefaultContext(): EventContext {
		return {
			database: getDatabase(),
			accountability: null,
			schema: null,
		};
	}

	public async emitFilter<TIn = unknown, TOut = TIn>(
		event: string | string[],
		payload: TIn,
		meta: Record<string, any>,
		context: EventContext | MutationEventContext | null = null,
	): Promise<TIn | TOut> {
		let updatedPayload: TIn | TOut = payload;

		for (const { event, listeners } of this.filterListenersOf<TIn, TOut>(event)) {
			for (const listener of listeners) {
				const result = await listener(
					updatedPayload as TIn,
					{ event, ...meta, originalPayload: payload },
					context ?? this.getDefaultContext(),
				);

				if (result !== undefined) {
					updatedPayload = result;
				}
			}
		}

		return updatedPayload;
	}

	/**
	 * Hand every filter of these events the rows a mutation already wrote. No
	 * answer has a reader, so a filter answering anything is refused, naming the
	 * event it listens on.
	 */
	public async emitWrittenFilter(
		event: string | string[],
		payload: unknown,
		meta: Record<string, any>,
		context: WrittenEventContext,
	): Promise<void> {
		const eventListeners = this.filterListenersOf(event);

		for (const { event: listenedEvent, listeners } of eventListeners) {
			for (const listener of listeners) {
				const answer = await listener(
					payload,
					{ event: listenedEvent, ...meta, originalPayload: payload },
					context,
				);

				if (answer !== undefined) {
					throw new InvalidPayloadError({
						reason: oneLine`
							A "${listenedEvent}" filter hook must return nothing: the rows are
							already written
						`,
					});
				}
			}
		}
	}

	/**
	 * The filters of each event, then the last filters of each: a last filter
	 * runs after every other filter of every event emitted, so it sees the
	 * payload all of them left.
	 */
	private filterListenersOf<TIn = unknown, TOut = TIn>(event: string | string[]) {
		const events = Array.isArray(event)
			? event
			: [event];

		const listenersOf = (filterEmitter: EventEmitter2) => {
			return events.map((event) => {
				return {
					event,
					listeners: filterEmitter.listeners(event) as FilterHandler<TIn, TOut>[],
				};
			});
		};

		return [
			...listenersOf(this.filterEmitter),
			...listenersOf(this.lastFilterEmitter),
		];
	}

	public hasFilterListeners(event: string | string[]): boolean {
		const events = Array.isArray(event)
			? event
			: [event];

		return events.some((name) => {
			return this.filterEmitter.listeners(name).length > 0
				|| this.lastFilterEmitter.listeners(name).length > 0;
		});
	}

	public hasActionListeners(event: string | string[]): boolean {
		const events = Array.isArray(event)
			? event
			: [event];

		return events.some((name) => this.actionEmitter.listeners(name).length > 0);
	}

	public async emitAction(
		event: string | string[],
		meta: Record<string, any>,
		context: EventContext | null = null,
	): Promise<void> {
		const logger = useLogger();
		const events = Array.isArray(event) ? event : [event];

		// Run every event's listeners in parallel and await them together, so a slow
		// handler on one event doesn't serialize behind the others.
		await Promise.all(
			events.map((event) =>
				this.actionEmitter.emitAsync(event, { event, ...meta }, context ?? this.getDefaultContext()).catch((err) => {
					logger.warn(`An error was thrown while executing action "${event}"`);
					logger.warn(err);
				}),
			),
		);
	}

	public async emitInit(event: string, meta: Record<string, any>): Promise<void> {
		const logger = useLogger();

		try {
			await this.initEmitter.emitAsync(event, { event, ...meta });
		} catch (err: any) {
			logger.warn(`An error was thrown while executing init "${event}"`);
			logger.warn(err);
		}
	}

	public onFilter<TIn = unknown, TOut = TIn>(
		event: string,
		handler: FilterHandler<TIn, TOut>,
		options?: { runsLast?: boolean },
	): void {
		if (options?.runsLast) {
			this.lastFilterEmitter.on(event, handler);
			return;
		}

		this.filterEmitter.on(event, handler);
	}

	public onAction(event: string, handler: ActionHandler): void {
		this.actionEmitter.on(event, handler);
	}

	public onInit(event: string, handler: InitHandler): void {
		this.initEmitter.on(event, handler);
	}

	public offFilter<TIn = unknown, TOut = TIn>(event: string, handler: FilterHandler<TIn, TOut>): void {
		this.filterEmitter.off(event, handler);
		this.lastFilterEmitter.off(event, handler);
	}

	public offAction(event: string, handler: ActionHandler): void {
		this.actionEmitter.off(event, handler);
	}

	public offInit(event: string, handler: InitHandler): void {
		this.initEmitter.off(event, handler);
	}

	public offAll(): void {
		this.filterEmitter.removeAllListeners();
		this.lastFilterEmitter.removeAllListeners();
		this.actionEmitter.removeAllListeners();
		this.initEmitter.removeAllListeners();
	}
}

const emitter = new Emitter();

export const useEmitter = () => emitter;

export default emitter;
