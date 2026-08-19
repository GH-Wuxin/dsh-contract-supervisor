function isPlainObject(value) {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
export function deepFreeze(value) {
    if (Array.isArray(value)) {
        for (const item of value) {
            deepFreeze(item);
        }
        return Object.freeze(value);
    }
    if (isPlainObject(value)) {
        for (const key of Object.keys(value)) {
            deepFreeze(value[key]);
        }
        return Object.freeze(value);
    }
    return value;
}
export function deepCloneAndFreeze(value) {
    if (Array.isArray(value)) {
        const cloned = value.map((item) => deepCloneAndFreeze(item));
        return Object.freeze(cloned);
    }
    if (isPlainObject(value)) {
        const cloned = {};
        for (const key of Object.keys(value)) {
            cloned[key] = deepCloneAndFreeze(value[key]);
        }
        return Object.freeze(cloned);
    }
    return value;
}
//# sourceMappingURL=immutable.js.map