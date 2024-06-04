import { isObject } from './is-object.js';
export function isVueComponent(input) {
    if (!isObject(input))
        return false;
    // A Vue component usually provides a 'setup' and/or 'render' function
    // (unfortunately there is no more accurate way to find out, but this should be enough for most cases)
    return typeof input['setup'] === 'function' || typeof input['render'] === 'function';
}
