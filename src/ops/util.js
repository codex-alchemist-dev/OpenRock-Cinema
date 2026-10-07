// Shared helpers for the default Bedrock op handlers. Every handler gets `(ctx, args, event)` from the player and the
// injected `bedrock` (the @minecraft/server exports: world, system, InputPermissionCategory, EasingType, ...).
"use strict";

const TICKS_PER_SECOND = 20;
const seconds = ticks => ticks / TICKS_PER_SECOND;
const vec = a => ({ x: a[0], y: a[1], z: a[2] });
const clone = v => ({ x: v.x, y: v.y, z: v.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

/** Cinema ease names -> Bedrock EasingType names. The bare `in`/`out`/`inOut` mean the quadratic curves. */
function easingName(name) {
    if (!name || name === "linear") return "Linear";
    if (name === "in") return "InQuad";
    if (name === "out") return "OutQuad";
    if (name === "inOut") return "InOutQuad";
    return name[0].toUpperCase() + name.slice(1);
}
/** Cinema ease names -> @openrock/fmbe easing names (same families; the bare names mean quad). */
function fmbeEase(name) {
    if (!name) return "linear";
    return { in: "inQuad", out: "outQuad", inOut: "inOutQuad" }[name] ?? name;
}
const easeOptions = (bedrock, ticks, ease) => ({ easeTime: seconds(ticks), easeType: bedrock.EasingType?.[easingName(ease)] ?? easingName(ease) });

/** Yaw/pitch (degrees, Minecraft convention: yaw 0 = +z, pitch negative = up) from `from` looking at `to`. */
function anglesTo(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const flat = Math.hypot(dx, dz);
    return { x: -Math.atan2(dy, flat) * 180 / Math.PI, y: -Math.atan2(dx, dz) * 180 / Math.PI };
}

/** Runs `fn(player)` for every player of the session. */
const eachPlayer = (ctx, fn) => { for (const p of ctx.env.players) fn(p); };

/** A cast entry (player or spawned entity) or a coordinate -> a location. */
function locationOf(ctx, target) {
    if (Array.isArray(target)) return vec(target);
    const bound = ctx.env.cast?.[target];
    if (!bound) throw new Error(`cinema: "${target}" is not bound in this cutscene's cast`);
    const l = bound.location ?? bound;
    return clone(l);
}

/** The dimension cutscene effects happen in (the first player's). */
const dimensionOf = ctx => ctx.env.players[0].dimension;

/** A warning at most once per session per key - cosmetic ops whose game hook is missing degrade instead of killing the cutscene. */
function warnOnce(ctx, key, message) {
    ctx.state.warned ??= new Set();
    if (ctx.state.warned.has(key)) return;
    ctx.state.warned.add(key);
    (ctx.env.warn ?? console.warn)(`[cinema] ${message}`);
}

/** Runs `fn` once for this session's first call under `key` (cleanup registration helper). */
function once(ctx, key, fn) {
    ctx.state.once ??= new Set();
    if (ctx.state.once.has(key)) return;
    ctx.state.once.add(key);
    fn();
}

module.exports = { TICKS_PER_SECOND, seconds, vec, clone, add, easingName, fmbeEase, easeOptions, anglesTo, eachPlayer, locationOf, dimensionOf, warnOnce, once };
