export type MessageHandler<T = unknown> = (payload: T) => void;

export interface Bus {
	/**
	 * Publish a message to subscribed clients in the given channel
	 *
	 * @param channel Channel to publish to
	 * @param payload Value to send to the subscribed clients
	 */
	publish<T = unknown>(channel: string, payload: T): Promise<void>;

	/**
	 * Subscribe to messages in the given channel
	 *
	 * @param channel Channel to subscribe to
	 * @param callback Payload that was published to the given channel
	 */
	subscribe<T = unknown>(channel: string, callback: MessageHandler<T>): Promise<void>;

	/**
	 * Unsubscribe from a channel
	 *
	 * @param channel Channel to unsubscribe from
	 * @param callback Callback to remove from the stack
	 */
	unsubscribe<T = unknown>(channel: string, callback: MessageHandler<T>): Promise<void>;

	/**
	 * Call back once the channels are subscribed again after a lost connection
	 *
	 * Pub/sub keeps nothing for a subscriber that is away, so whatever was
	 * published in between is gone: this is the moment to ask for it again.
	 *
	 * @param callback Called after every resubscribe, never on the first connection
	 */
	onResubscribe(callback: () => void): void;
}
