// display.* ops: FMBE display entities (@openrock/fmbe, docs/fmbe.md) inside cutscenes - any block or item with its real
// model, placed, moved, spun, scaled and swapped on the timeline. Tweens run on the CLIENT (the fmbe runtime renders them as
// Molang), so a spinning, bobbing prop costs the server nothing while it plays.
//
// Needs from the game (ctx.env): `fmbe` (a createFmbe runtime), and for `display scene` also `scenes` (the compiled
// content.fmbeDsl data) and `spawnScene` (from @openrock/fmbe). Every display a cutscene shows is removed on cleanup.
"use strict";

const { dimensionOf, vec, once, fmbeEase } = require("./util.js");

const NEAR = 3.5; // an FMBE offset is only reliable within a few blocks of its entity

const snap = c => ({ x: Math.floor(c.x) + 0.5, y: c.y, z: Math.floor(c.z) + 0.5 });
const rel = (c, a) => [c.x - a.x, c.y - a.y, c.z - a.z];

function createDisplayOps() {
    const fmbeOf = ctx => {
        if (!ctx.env.fmbe) throw new Error("cinema: display verbs need createCinemaRuntime({ fmbe }) - an @openrock/fmbe runtime from createFmbe(...)");
        return ctx.env.fmbe;
    };
    const registry = ctx => {
        const map = (ctx.state.displays ??= new Map());
        once(ctx, "display-cleanup", () => ctx.onCleanup(() => { for (const e of map.values()) { try { (e.scene ?? e.display).remove(); } catch (err) { /* gone */ } } map.clear(); }));
        return map;
    };
    const find = (ctx, name) => {
        const e = registry(ctx).get(name);
        if (!e) throw new Error(`cinema: display "${name}" is not shown (it may have already been hidden)`);
        return e;
    };
    const solo = (ctx, name) => {
        const e = find(ctx, name);
        if (!e.display) throw new Error(`cinema: "${name}" is a scene; this verb needs a single display`);
        return e.display;
    };
    const tweenOpts = args => ({ ticks: args.over, ease: fmbeEase(args.ease), ...(args.loop ? { loop: args.loop } : {}) });

    function autoHide(ctx, args, name) {
        if (args.for) ctx.after(args.for, () => { const m = registry(ctx); const e = m.get(name); if (e) { (e.scene ?? e.display).remove(); m.delete(name); } });
    }

    return {
        "display.show"(ctx, args) {
            const [name, kind, item] = args.pos;
            const fmbe = fmbeOf(ctx);
            const at = { x: args.at[0], y: args.at[1], z: args.at[2] };
            const anchor = snap(at);
            const spec = { item, kind, pos: rel(at, anchor), ...(args.rot ? { rot: args.rot } : {}), ...(args.scale !== undefined ? { scale: args.scale } : {}), ...(args.base ? { basepos: args.base } : {}), ...(args.system ? { system: args.system } : {}) };
            registry(ctx).set(name, { display: fmbe.spawn(dimensionOf(ctx), anchor, spec) });
            autoHide(ctx, args, name);
        },
        "display.scene"(ctx, args) {
            const [name, sceneId] = args.pos;
            const scene = ctx.env.scenes?.[sceneId];
            if (!scene) throw new Error(`cinema: display scene "${sceneId}": no such scene (pass the compiled content.fmbeDsl data as createCinemaRuntime({ scenes }))`);
            if (typeof ctx.env.spawnScene !== "function") throw new Error("cinema: display scene needs createCinemaRuntime({ spawnScene }) from @openrock/fmbe");
            const handle = ctx.env.spawnScene(fmbeOf(ctx), scene, { dimension: dimensionOf(ctx), origin: vec(args.at), yaw: args.yaw ?? 0, scale: args.scale ?? 1 });
            registry(ctx).set(name, { scene: handle });
            autoHide(ctx, args, name);
        },
        "display.move"(ctx, args) {
            const d = solo(ctx, args.pos[0]);
            const to = vec(args.to);
            const opts = tweenOpts(args);
            const here = d.current().pos;
            const wantRel = rel(to, d.anchor);
            if (Math.max(...wantRel.map(Math.abs)) <= NEAR) d.tween({ pos: wantRel }, opts);
            else d.glideTo([{ x: to.x - here[0], y: to.y - here[1], z: to.z - here[2] }], { ticksPerSegment: args.over, ease: opts.ease });
        },
        "display.rotate"(ctx, args) { solo(ctx, args.pos[0]).tween({ rot: args.to }, tweenOpts(args)); },
        "display.spin"(ctx, args) {
            const d = solo(ctx, args.pos[0]);
            const [x, y, z] = d.current().rot;
            d.tween({ rot: [x, y + args.by, z] }, tweenOpts(args));
        },
        "display.scale"(ctx, args) { solo(ctx, args.pos[0]).tween({ scale: args.to }, tweenOpts(args)); },
        "display.item"(ctx, args) { solo(ctx, args.pos[0]).set({ item: args.pos[1] }); },
        "display.play"(ctx, args) {
            const e = find(ctx, args.pos[0]);
            if (!e.scene) throw new Error(`cinema: "${args.pos[0]}" is a single display, not a scene`);
            e.scene.play(args.pos[1]);
        },
        "display.stop"(ctx, args) {
            const e = find(ctx, args.pos[0]);
            if (!e.scene) throw new Error(`cinema: "${args.pos[0]}" is a single display, not a scene`);
            e.scene.stop(args.pos[1]);
        },
        "display.hide"(ctx, args) {
            const m = registry(ctx);
            const e = m.get(args.pos[0]);
            if (!e) return; // already hidden (a `for` duration ran out): hiding twice is fine
            (e.scene ?? e.display).remove();
            m.delete(args.pos[0]);
        },
    };
}

module.exports = { createDisplayOps };
