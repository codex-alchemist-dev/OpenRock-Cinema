// camera.* ops. A cutscene camera is the vanilla "minecraft:free" preset moved with player.camera.setCamera: position + a
// rotation or a point to face, optionally eased by the CLIENT (easeOptions), so a 5-second move costs one call. Only
// follow and orbit need per-tick updates (their path is not a straight ease) and use ctx.every.
//
// The runtime tracks the last pose it asked for (ctx.state.cam) so relative ops (dolly, pan_up, lookAt keeping position)
// have something to start from. Everything is undone on cleanup: camera cleared, shake stopped, fov reset.
"use strict";

const { eachPlayer, once, seconds, vec, add, anglesTo, easeOptions, locationOf } = require("./util.js");

const PRESET = "minecraft:free";

function createCameraOps(bedrock) {
    /** First use in a session: start from the player's own eye and register the cleanup that always hands the camera back. */
    function pose(ctx) {
        once(ctx, "camera-cleanup", () => ctx.onCleanup(() => {
            for (const stop of (ctx.state.cameraTickers ?? []).splice(0)) stop();
            for (const p of ctx.env.players) {
                try { p.camera.stopShaking(); } catch (e) { /* none running */ }
                try { p.camera.setFov(); } catch (e) { /* fine */ }
                try { p.camera.clear(); } catch (e) { /* gone */ }
            }
        }));
        if (!ctx.state.cam) {
            const p = ctx.env.players[0];
            const head = p.getHeadLocation();
            ctx.state.cam = { location: { x: head.x, y: head.y, z: head.z }, rotation: p.getRotation(), facing: null };
        }
        return ctx.state.cam;
    }

    /** A new camera instruction replaces a running follow/orbit. */
    function stopTickers(ctx) { for (const stop of (ctx.state.cameraTickers ?? []).splice(0)) stop(); }
    function addTicker(ctx, stop) { (ctx.state.cameraTickers ??= []).push(stop); }

    /**
     * Sends the camera somewhere. `look` = a location to face (else the given/last rotation is kept).
     * @param {{location?: object, look?: object|null, rotation?: object, ticks?: number, ease?: string}} to
     */
    function send(ctx, to) {
        const cam = pose(ctx);
        const location = to.location ?? cam.location;
        const ease = to.ticks ? { easeOptions: easeOptions(bedrock, to.ticks, to.ease) } : {};
        const options = to.look ? { location, facingLocation: to.look, ...ease } : { location, rotation: to.rotation ?? cam.rotation, ...ease };
        eachPlayer(ctx, p => p.camera.setCamera(PRESET, options));
        cam.location = location;
        cam.rotation = to.look ? anglesTo(location, to.look) : (to.rotation ?? cam.rotation);
        cam.facing = to.look ?? null;
    }

    return {
        "camera.cut"(ctx, args) {
            stopTickers(ctx);
            send(ctx, { location: vec(args.to), look: args.lookAt ? locationOf(ctx, args.lookAt) : null });
            if (args.fov !== undefined) eachPlayer(ctx, p => p.camera.setFov({ fov: args.fov }));
        },
        "camera.move"(ctx, args) {
            stopTickers(ctx);
            send(ctx, { location: vec(args.to), look: args.lookAt ? locationOf(ctx, args.lookAt) : (pose(ctx).facing ?? null), ticks: args.over, ease: args.ease });
        },
        "camera.lookAt"(ctx, args) {
            stopTickers(ctx);
            send(ctx, { look: locationOf(ctx, args.pos[0]), ticks: args.over, ease: args.ease });
        },
        "camera.panUp"(ctx, args) {
            stopTickers(ctx);
            send(ctx, { rotation: { x: -90, y: pose(ctx).rotation.y }, ticks: args.over, ease: args.ease });
        },
        "camera.dolly"(ctx, args) {
            stopTickers(ctx);
            const cam = pose(ctx);
            send(ctx, { location: add(cam.location, vec(args.by)), look: cam.facing, ticks: args.over });
        },
        "camera.fov"(ctx, args) {
            pose(ctx);
            const options = { fov: args.pos[0] };
            if (args.over) options.easeOptions = easeOptions(bedrock, args.over, args.ease);
            eachPlayer(ctx, p => p.camera.setFov(options));
        },
        "camera.shake"(ctx, args) {
            pose(ctx);
            const type = bedrock.CameraShakeType?.Rotational ?? "Rotational";
            eachPlayer(ctx, p => p.camera.addShake({ intensity: Math.min(4, args.strength ?? 1), duration: seconds(args.for), type }));
        },
        /** Keeps the camera where it is and turns it to face a cast member, re-aiming every 2 ticks so it tracks movement. */
        "camera.follow"(ctx, args) {
            stopTickers(ctx);
            const cam = pose(ctx);
            const name = args.pos[0];
            addTicker(ctx, ctx.every(() => {
                const look = locationOf(ctx, name);
                cam.rotation = anglesTo(cam.location, look);
                cam.facing = look;
                eachPlayer(ctx, p => p.camera.setCamera(PRESET, { location: cam.location, facingLocation: look, easeOptions: easeOptions(bedrock, 2, "linear") }));
            }, { every: 2 }));
        },
        /**
         * Circles `around` (a cast name or coordinate) at `radius` for `over` ticks. `speed` is degrees per second; the default
         * is one full turn over the duration. The camera keeps its current height above the centre.
         */
        "camera.orbit"(ctx, args) {
            stopTickers(ctx);
            const cam = pose(ctx);
            const center = locationOf(ctx, args.around);
            const radius = args.radius ?? Math.max(2, Math.hypot(cam.location.x - center.x, cam.location.z - center.z));
            const height = cam.location.y - center.y;
            const degPerTick = (args.speed ?? 360 / seconds(args.over)) / 20;
            const start = Math.atan2(cam.location.z - center.z, cam.location.x - center.x) * 180 / Math.PI;
            const stepEvery = 2;
            addTicker(ctx, ctx.every(n => {
                const centre = typeof args.around === "string" ? locationOf(ctx, args.around) : center;
                const a = (start + degPerTick * (n + 1) * stepEvery) * Math.PI / 180;
                const location = { x: centre.x + radius * Math.cos(a), y: centre.y + height, z: centre.z + radius * Math.sin(a) };
                cam.location = location; cam.facing = centre; cam.rotation = anglesTo(location, centre);
                eachPlayer(ctx, p => p.camera.setCamera(PRESET, { location, facingLocation: centre, easeOptions: easeOptions(bedrock, stepEvery, "linear") }));
            }, { every: stepEvery, ticks: args.over }));
        },
    };
}

module.exports = { createCameraOps, PRESET };
