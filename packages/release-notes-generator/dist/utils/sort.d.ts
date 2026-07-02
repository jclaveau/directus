export declare function sortByExternalOrder<T, O extends T[K][], K extends keyof T>(order: O, key: K): (a: T, b: T) => number;
export declare function sortByObjectValues<T, O extends Record<any, T[K]>, K extends keyof T>(object: O, key: K): (a: T, b: T) => number;
