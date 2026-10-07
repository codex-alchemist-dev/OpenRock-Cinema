// Relative coordinates. The language writes `(~2, ~, ~-3)` for "2 east, same height, 3 north of where the cutscene
// started"; the compiler keeps each such component as { rel: n }. At play time the runtime replaces every one with
// origin + n, deeply, in event arguments and cast positions, so the ops only ever see plain numbers.
"use strict";

const isRel = v => v !== null && typeof v === "object" && !Array.isArray(v) && typeof v.rel === "number" && Object.keys(v).length === 1;

/** @param {*} value any JSON-ish value  @param {{x:number,y:number,z:number}} origin */
function resolveRelative(value, origin) {
    if (Array.isArray(value)) {
        if (value.length === 3 && value.some(isRel)) return value.map((c, i) => (isRel(c) ? origin[["x", "y", "z"][i]] + c.rel : c));
        return value.map(v => resolveRelative(v, origin));
    }
    if (value !== null && typeof value === "object" && !isRel(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRelative(v, origin)]));
    return value;
}

module.exports = { resolveRelative, isRel };
