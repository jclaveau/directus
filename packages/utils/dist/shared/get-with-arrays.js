/**
 * Basically the same as `get` from `lodash`, but will convert nested array values to arrays, so for example:
 *
 * @example
 * ```js
 * const obj = { value: [{ example: 1 }, { example: 2 }]}
 * get(obj, 'value.example');
 * // => [1, 2]
 * ```
 */
export function get(object, path, defaultValue) {
    let key = path.split('.')[0];
    const follow = path.split('.').slice(1);
    if (key.includes(':'))
        key = key.split(':')[0];
    const result = Array.isArray(object) ? getArrayResult(object, key) : object?.[key];
    if (result !== undefined && follow.length > 0) {
        return get(result, follow.join('.'), defaultValue);
    }
    return result ?? defaultValue;
}
function getArrayResult(object, key) {
    const result = object.map((entry) => entry?.[key]).filter((entry) => entry);
    return result.length > 0 ? result.flat() : undefined;
}
