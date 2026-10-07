// Pure cutscene player. Knows nothing about Bedrock: every op (camera.cut,
// actor.play, particles, ...) is an injected handler, so the scheduling,
// skip, error-isolation and cleanup guarantees are fully testable without a
// game. The guarantees are the point:
//   - cleanup handlers ALWAYS run exactly once per session, on finish, skip,
//     stop, error, or player-gone - a locked camera/input can never leak;
//   - a throwing op ends only THAT session (after cleanup), never others;
//   - events at the same tick run in source order; time only moves forward.
"use strict";

/**
 * @param {object} options
 * @param {Record<string, (ctx: object, args: object, event: object) => void>} options.ops op name -> handler
 * @param {(error: Error, info: {cutsceneId: string, event?: object}) => void} [options.onError]
 */
function createPlayer({ ops, onError = () => {} }) {
    const sessions = new Set();

    /**
     * @param {object} timeline a compiled cutscene ({id, events, onSkip, durationTicks, ...})
     * @param {object} [env] caller data handed to every op as ctx.env (players, cast bindings, ...)
     * @param {{setup?: (ctx: object) => void}} [options] setup runs before the first event; it may register cleanups, so
     *   whatever it acquires (spawned cast, ...) is released even when an op fails at t=0
     */
    function start(timeline, env = {}, { setup } = {}) {
        const cleanups = [];
        let elapsed = 0;
        let next = 0;
        let state = "running";
        const timers = [];   // { at, fn, every?, until? } - per-tick work ops register (camera orbit, particle streams, delayed hides)
        const ctx = {
            env,
            timeline,
            state: {},                       // scratch space for ops (camera pose, shown displays, ...)
            elapsed: () => elapsed,
            onCleanup: fn => { cleanups.push(fn); },
            /** Runs `fn` once, `ticks` from now. Returns a cancel function. Dropped automatically when the session ends. */
            after(ticks, fn) { const t = { at: elapsed + Math.max(0, ticks), fn }; timers.push(t); return () => { t.dead = true; }; },
            /** Runs `fn(tickIndex)` every `every` ticks (default 1) from the next tick for `ticks` ticks (default: until the session ends). Returns a cancel function. */
            every(fn, { every = 1, ticks = Infinity } = {}) {
                const t = { at: elapsed + every, fn, every, until: elapsed + ticks, n: 0 };
                timers.push(t);
                return () => { t.dead = true; };
            },
        };

        function runEvent(event) {
            const handler = ops[event.op];
            if (!handler) throw new Error(`cinema: no handler registered for op "${event.op}" (cutscene "${timeline.id}")`);
            handler(ctx, event.args, event);
        }

        function finish(finalState) {
            if (state !== "running") return;
            state = finalState;
            sessions.delete(handle);
            timers.length = 0;
            for (const fn of cleanups.splice(0).reverse()) {
                try { fn(); } catch (e) { onError(e, { cutsceneId: timeline.id }); }
            }
        }

        function guarded(fn, event) {
            try { fn(); return true; }
            catch (e) { onError(e, { cutsceneId: timeline.id, event }); finish("errored"); return false; }
        }

        function runTimers() {
            for (const t of [...timers]) {
                if (state !== "running") return;
                if (t.dead) { timers.splice(timers.indexOf(t), 1); continue; }
                if (t.at > elapsed) continue;
                if (t.every === undefined) { timers.splice(timers.indexOf(t), 1); if (!guarded(() => t.fn(), null)) return; continue; }
                if (elapsed > t.until) { timers.splice(timers.indexOf(t), 1); continue; }
                t.at = elapsed + t.every;
                if (!guarded(() => t.fn(t.n++), null)) return;
            }
        }

        function drain() {
            while (state === "running" && next < timeline.events.length && timeline.events[next].t <= elapsed) {
                const event = timeline.events[next++];
                if (!guarded(() => runEvent(event), event)) return;
            }
        }

        const handle = {
            id: timeline.id,
            state: () => state,
            onCleanup: fn => ctx.onCleanup(fn),
            /** Advance by `ticks` (default 1); runs every timer and event now due, tick by tick. No-op after the session ends. */
            tick(ticks = 1) {
                if (state !== "running") return state;
                if (ticks === 0) drain();
                for (let i = 0; i < ticks && state === "running"; i++) { elapsed++; runTimers(); drain(); }
                if (state === "running" && elapsed >= timeline.durationTicks && next >= timeline.events.length) finish("finished");
                return state;
            },
            /** Runs the onSkip events (not the remaining timeline), then cleans up. */
            skip() {
                if (state !== "running") return;
                for (const event of timeline.onSkip ?? []) {
                    if (!guarded(() => runEvent(event), event)) return;
                }
                finish("skipped");
            },
            stop() { finish("stopped"); },
        };

        sessions.add(handle);
        if (setup) guarded(() => setup(ctx), null);
        handle.tick(0); // events at t=0 apply this tick
        return handle;
    }

    return {
        start,
        activeCount: () => sessions.size,
        /** Ends every running session (server shutdown / script reload) with full cleanup. */
        stopAll() { for (const s of [...sessions]) s.stop(); },
    };
}

module.exports = { createPlayer };
