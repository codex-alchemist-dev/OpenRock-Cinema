// call / emit / mark_seen / set_flag: the game-policy ops. The cutscene library only routes them to what the game gave it:
//   env.functions[name](env, players)   call
//   env.emit(name, { players })         emit
//   env.hooks.markSeen(player, id)      mark_seen
//   env.hooks.setFlag(player, name)     set_flag
// A missing handler is an error (these change game state - never silently skipped).
"use strict";

const { eachPlayer } = require("./util.js");

function need(fn, what) {
    if (typeof fn !== "function") throw new Error(`cinema: ${what} is not provided by the game`);
    return fn;
}

function createFlowOps() {
    return {
        call(ctx, args) {
            const name = args.pos[0];
            const fn = ctx.env.functions?.[name];
            if (typeof fn !== "function") throw new Error(`cinema: call "${name}": no such function (register it in createCinemaRuntime({ functions }))`);
            fn(ctx.env, ctx.env.players);
        },
        emit(ctx, args) { need(ctx.env.emit, "env.emit")(args.pos[0], { players: ctx.env.players }); },
        markSeen(ctx, args) { const f = need(ctx.env.hooks?.markSeen, "hooks.markSeen"); eachPlayer(ctx, p => f(p, args.pos[0])); },
        setFlag(ctx, args) { const f = need(ctx.env.hooks?.setFlag, "hooks.setFlag"); eachPlayer(ctx, p => f(p, args.pos[0])); },
    };
}

module.exports = { createFlowOps };
