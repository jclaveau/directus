"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortByObjectValues = exports.sortByExternalOrder = void 0;
function sortByExternalOrder(order, key) {
    return (a, b) => {
        const indexOfA = order.indexOf(a[key]);
        const indexOfB = order.indexOf(b[key]);
        if (indexOfA >= 0 && indexOfB >= 0)
            return indexOfA - indexOfB;
        if (indexOfA >= 0) {
            return -1;
        }
        return 0;
    };
}
exports.sortByExternalOrder = sortByExternalOrder;
function sortByObjectValues(object, key) {
    const order = Object.values(object);
    return (a, b) => order.indexOf(a[key]) - order.indexOf(b[key]);
}
exports.sortByObjectValues = sortByObjectValues;
