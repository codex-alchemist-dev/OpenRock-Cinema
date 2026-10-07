// lock / unlock / mode / fade. The discipline (same as the RTS camera): whatever a cutscene turns off is turned back on on
// EVERY exit path, via ctx.onCleanup, even when a later op throws.
"use strict";

const { eachPlayer, once, seconds, warnOnce } = require("./util.js");

const HOLD_FOREVER = 3600; // seconds a fade-to-black holds until the next `fade in` (cleanup cancels it)

function createLockOps(bedrock) {
    const { InputPermissionCategory: Cat } = bedrock;

    /** Remembers each player's permissions once per session and restores them on cleanup. */
    function snapshotPermissions(ctx) {
        once(ctx, "perm-snapshot", () => {
            const saved = ctx.env.players.map(p => [p, { camera: p.inputPermissions.isPermissionCategoryEnabled(Cat.Camera), movement: p.inputPermissions.isPermissionCategoryEnabled(Cat.Movement) }]);
            ctx.onCleanup(() => {
                for (const [p, s] of saved) {
                    try { p.inputPermissions.setPermissionCategory(Cat.Camera, s.camera); p.inputPermissions.setPermissionCategory(Cat.Movement, s.movement); } catch (e) { /* player gone */ }
                }
            });
        });
    }

    function setLock(ctx, camera, movement) {
        snapshotPermissions(ctx);
        eachPlayer(ctx, p => { p.inputPermissions.setPermissionCategory(Cat.Camera, camera); p.inputPermissions.setPermissionCategory(Cat.Movement, movement); });
    }

    return {
        /** cinematic: camera + movement locked; position: movement locked, rotation free; free: movement locked, camera free to look around. */
        lock(ctx, args) {
            const mode = args.pos[0];
            if (mode === "cinematic") setLock(ctx, false, false);
            else setLock(ctx, true, false); // "position" and "free" differ only in whether the creator scripts a camera
            ctx.state.lockMode = mode;
        },
        /** Releases the locks and the camera right now (cleanup would do it at the end anyway). */
        unlock(ctx) {
            if (ctx.state.cameraTickers) for (const stop of ctx.state.cameraTickers.splice(0)) stop();
            eachPlayer(ctx, p => {
                p.inputPermissions.setPermissionCategory(Cat.Camera, true);
                p.inputPermissions.setPermissionCategory(Cat.Movement, true);
                p.camera.clear();
            });
            ctx.state.lockMode = null;
        },
        mode(ctx, args) {
            const hook = ctx.env.hooks?.letterbox;
            const on = args.pos[0] === "letterbox";
            if (!hook) { if (on) warnOnce(ctx, "letterbox", "mode letterbox needs hooks.letterbox(players, on) - the bars are drawn by the game's UI; continuing without them"); return; }
            hook(ctx.env.players, on);
            if (on) ctx.onCleanup(() => hook(ctx.env.players, false));
        },
        /** fade out = to black (held until `fade in`); fade in = from black. */
        fade(ctx, args) {
            const [direction, ticks] = args.pos;
            const t = seconds(ticks);
            const black = { red: 0, green: 0, blue: 0 };
            once(ctx, "fade-cleanup", () => ctx.onCleanup(() => {
                for (const p of ctx.env.players) { try { p.camera.fade({ fadeColor: black, fadeTime: { fadeInTime: 0, holdTime: 0, fadeOutTime: 0 } }); } catch (e) { /* gone */ } }
            }));
            eachPlayer(ctx, p => p.camera.fade({
                fadeColor: black,
                fadeTime: direction === "out" ? { fadeInTime: t, holdTime: HOLD_FOREVER, fadeOutTime: 0 } : { fadeInTime: 0, holdTime: 0, fadeOutTime: t },
            }));
        },
    };
}

module.exports = { createLockOps };
