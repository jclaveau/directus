export const MANAGED_BY_SUBSCRIPTIONS = '@scalabus/subscriptions';

export const WEBHOOK_MOUNT_PATH = '/subscriptions/webhooks';

/** Statuses after which the provider never changes the subscription again. */
export const TERMINAL_STATUSES = ['canceled', 'expired', 'incomplete_expired'];
