// The cutscene runtime: binds a compiled timeline to real players and drives it. Owns one pure player (player.js), ticks every
// running session once per game tick, spawns and removes cast entities, and ends a session when its player leaves or dies.
//
//   const cinema = createCinemaRuntime({ bedrock: { world, system, ...server }, cutscenes: CUTSCENES, functions, hooks, fmbe, scenes, spawnScene });
//   cinema.play("first_meeting", [player]);
//   cinema.skip(player);
//
// Game policy comes in through `functions` (the `call` verb), `emit`, and `hooks` (markSeen, setFlag, screenShow/Hide,
// letterbox, say); display verbs need `fmbe` (+ `scenes`/`spawnScene` for display scene). See ops/*.js for each contract.
"use strict";

const { createPlayer } = require("./player.js");
const { createDefaultOps } = require("./ops/index.js");
const { resolveRelative } = require("./coords.js");

function createCinemaRuntime({ bedrock, cutscenes, functions = {}, hooks = {}, fmbe, scenes, spawnScene, emit, ops: extraOps = {}, onError, onFinish, warn }) {
    const { world, system } = bedrock;
    // every op sees plain numbers: `~` coordinates are resolved against the session origin first
    const withOrigin = table => Object.fromEntries(Object.entries(table).map(([name, handler]) => [name, (ctx, args, event) => handler(ctx, resolveRelative(args, ctx.env.origin), event)]));
    const player = createPlayer({
        ops: withOrigin({ ...createDefaultOps(bedrock), ...extraOps }),
        onError: (e, info) => (onError ? onError(e, info) : console.warn(`[cinema] ${info?.cutsceneId ?? "?"}: ${e?.message ?? e}`)),
    });
    const sessions = new Map();   // player id -> { handle, players, id, onFinish }
    let runId = null;
    let subscribed = false;

    const idOf = p => p.id;

    function bindCast(timeline, players, dimension, origin, bound = {}) {
        const cast = {};
        const spawned = [];
        for (const c of timeline.cast) {
            if (c.kind === "player") {
                const p = players[c.index];
                if (!p) throw new Error(`cutscene "${timeline.id}": cast "${c.name}" needs player #${c.index} but only ${players.length} given`);
                cast[c.name] = p;
            } else if (bound[c.name]) {
                cast[c.name] = bound[c.name];   // the game supplied this cast member (an entity that already exists): not spawned, not removed
            } else {
                const abs = c.at ? resolveRelative(c.at, origin) : null;
                const at = abs ? { x: abs[0], y: abs[1], z: abs[2] } : players[0].location;
                const e = dimension.spawnEntity(c.entityType, at);
                spawned.push(e);
                cast[c.name] = e;
            }
        }
        return { cast, spawned };
    }

    function reap() {
        for (const [pid, s] of [...sessions]) {
            if (s.handle.state() === "running") continue;
            sessions.delete(pid);
            const info = { cutsceneId: s.id, state: s.handle.state(), players: s.players };
            try { s.onFinish?.(info); } catch (e) { console.warn(`[cinema] onFinish: ${e?.message ?? e}`); }
            try { onFinish?.(info); } catch (e) { console.warn(`[cinema] onFinish: ${e?.message ?? e}`); }
        }
        if (sessions.size === 0 && runId !== null) { system.clearRun(runId); runId = null; }
    }

    function stopFor(playerId, how = "stop") {
        const s = sessions.get(playerId);
        if (!s) return;
        if (how === "skip") s.handle.skip(); else s.handle.stop();
        reap();
    }

    function subscribe() {
        if (subscribed) return;
        subscribed = true;
        try { world.afterEvents.playerLeave.subscribe(ev => stopFor(ev.playerId)); } catch (e) { /* older API */ }
        try { world.afterEvents.entityDie.subscribe(ev => { if (ev.deadEntity?.typeId === "minecraft:player") stopFor(ev.deadEntity.id); }); } catch (e) { /* older API */ }
    }

    return {
        /**
         * @param {string} id cutscene id
         * @param {object[]} players the players who see it (cast `player 0` is the first)
         * @param {{onFinish?: (info: {cutsceneId: string, state: string, players: object[]}) => void, cast?: Object<string, object>}} [opts]
         *   cast: existing entities to use for `cast name = entity ...` members instead of spawning new ones (they are left alone afterwards)
         */
        play(id, players, opts = {}) {
            const timeline = cutscenes[id];
            if (!timeline) throw new Error(`cinema: no cutscene "${id}" (known: ${Object.keys(cutscenes).join(", ") || "none"})`);
            players = Array.isArray(players) ? players : [players];
            if (players.length === 0) throw new Error(`cinema: cutscene "${id}" needs at least one player`);
            for (const p of players) if (sessions.has(idOf(p))) throw new Error(`cinema: ${p.name ?? p.id} is already watching "${sessions.get(idOf(p)).id}"`);
            for (const c of timeline.cast) if (c.kind === "player" && !players[c.index]) throw new Error(`cinema: cutscene "${id}": cast "${c.name}" needs player #${c.index} but only ${players.length} given`);
            subscribe();

            const l = players[0].location;
            const origin = { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) };
            const env = { players, origin, cast: {}, functions, hooks, fmbe, scenes, spawnScene, emit, warn };
            const handle = player.start(timeline, env, {
                setup: ctx => {
                    const { cast, spawned } = bindCast(timeline, players, players[0].dimension, origin, opts.cast);
                    env.cast = cast;
                    ctx.onCleanup(() => { for (const e of spawned) { try { if (e.isValid) e.remove(); } catch (err) { /* gone */ } } });
                },
            });
            const session = { handle, players, id, onFinish: opts.onFinish };
            for (const p of players) sessions.set(idOf(p), session);
            if (handle.state() === "running" && runId === null) {
                runId = system.runInterval(() => { for (const s of new Set(sessions.values())) s.handle.tick(1); reap(); }, 1);
            }
            reap();
            return handle;
        },
        /** Skips the cutscene `p` is watching (runs its `on skip` block), if any. */
        skip: p => stopFor(idOf(p), "skip"),
        stop: p => stopFor(idOf(p)),
        isPlaying: p => sessions.has(idOf(p)),
        /** Ends every session with full cleanup (script reload / shutdown). */
        stopAll() { player.stopAll(); reap(); },
        activeCount: () => player.activeCount(),
    };
}

module.exports = { createCinemaRuntime };
