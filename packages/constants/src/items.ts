/**
 * Keys of a nested relational mutation input (the `Alterations` type in `@directus/types`):
 * `create` new children, `update` existing children by primary key, `delete` children by primary key.
 */
export const ALTERATIONS_KEYS = ['create', 'update', 'delete'] as const;
