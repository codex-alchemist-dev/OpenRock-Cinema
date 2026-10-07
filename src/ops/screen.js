// screen.show / screen.hide: full-screen overlays are UI, which belongs to the game (MinUI, a custom form...). The library
// routes the verbs to env.hooks.screenShow(players, texture, { fill, fade }) / env.hooks.screenHide(players, { fade }) and
// hides the overlay on cleanup. Without a hook the op degrades with one warning instead of ending the cutscene.
"use strict";

const { warnOnce, once } = require("./util.js");

function createScreenOps() {
    return {
        "screen.show"(ctx, args) {
            const hook = ctx.env.hooks?.screenShow;
            if (!hook) { warnOnce(ctx, "screen", "screen show needs hooks.screenShow(players, texture, { fill, fade }) - skipped"); return; }
            hook(ctx.env.players, args.pos[0], { fill: !!args.fill, fade: args.fade ?? 0 });
            once(ctx, "screen-cleanup", () => ctx.onCleanup(() => ctx.env.hooks.screenHide?.(ctx.env.players, { fade: 0 })));
        },
        "screen.hide"(ctx, args) {
            const hook = ctx.env.hooks?.screenHide;
            if (!hook) { warnOnce(ctx, "screen", "screen hide needs hooks.screenHide(players, { fade }) - skipped"); return; }
            hook(ctx.env.players, { fade: args.fade ?? 0 });
        },
    };
}

module.exports = { createScreenOps };
