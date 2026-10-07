#!/usr/bin/env node
// Run: node libs/cinema/test/ops.test.js
// Real .cinema source -> real compiler -> the default Bedrock ops + runtime, against a recording fake of @minecraft/server.
"use strict";

const assert = require("assert");
const path = require("path");
const { parse } = require(path.join("..", "..", "..", "src", "cinemaDsl", "parser.js"));
const { compileProgram } = require(path.join("..", "..", "..", "src", "cinemaDsl", "timeline.js"));
const { createCinemaRuntime, createPlayer } = require("../src/register.js");

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`ok - ${name}`); }
    catch (e) { console.error(`FAIL - ${name}`); console.error(e); process.exitCode = 1; }
}

// ---- fakes ----
function createFake() {
    const intervals = [];
    const afterDie = [], afterLeave = [];
    const system = { currentTick: 0, runInterval(fn, every) { const h = { fn, every, live: true }; intervals.push(h); return h; }, clearRun(h) { h.live = false; } };
    const world = { calls: [], setTimeOfDay(t) { world.calls.push(["time", t]); }, afterEvents: { playerLeave: { subscribe: f => afterLeave.push(f) }, entityDie: { subscribe: f => afterDie.push(f) } } };
    const tick = (n = 1) => { for (let i = 0; i < n; i++) { system.currentTick++; for (const h of intervals) if (h.live) h.fn(); } };
    const entities = [];
    const dimension = {
        particles: [], weather: [],
        spawnParticle(name, loc) { dimension.particles.push([name, loc]); },
        setWeather(w) { dimension.weather.push(w); },
        spawnEntity(type, at) {
            const e = { typeId: type, isValid: true, location: { ...at }, nameTag: "", calls: [],
                playAnimation(a, o) { e.calls.push(["play", a, o]); }, triggerEvent(n) { e.calls.push(["event", n]); },
                teleport(p) { e.location = { ...p }; e.calls.push(["tp", p]); }, lookAt(p) { e.calls.push(["look", p]); }, setRotation(r) { e.calls.push(["rot", r]); },
                remove() { e.isValid = false; } };
            entities.push(e);
            return e;
        },
    };
    let n = 0;
    const makePlayer = name => {
        const perms = { 1: true, 2: true };
        const p = {
            id: `p${++n}`, name, dimension, location: { x: 0, y: 64, z: 0 }, calls: [], effects: [{ typeId: "speed" }],
            inputPermissions: { setPermissionCategory(c, v) { perms[c] = v; p.calls.push(["perm", c, v]); }, isPermissionCategoryEnabled: c => perms[c] },
            camera: {}, onScreenDisplay: {},
            getHeadLocation: () => ({ x: 0, y: 65.6, z: 0 }), getRotation: () => ({ x: 10, y: 20 }),
            playSound(id, o) { p.calls.push(["sound", id, o]); }, teleport(l) { p.calls.push(["tp", l]); },
            getEffects: () => p.effects, removeEffect(id) { p.calls.push(["removeEffect", id]); }, addEffect(id, d, o) { p.calls.push(["addEffect", id, d, o]); },
            getComponent: () => ({ resetToMaxValue() { p.calls.push(["heal"]); } }),
        };
        for (const m of ["setCamera", "setFov", "fade", "addShake", "stopShaking", "clear"]) p.camera[m] = (...a) => p.calls.push([`camera.${m}`, ...a]);
        for (const m of ["setTitle", "setActionBar"]) p.onScreenDisplay[m] = (...a) => p.calls.push([`osd.${m}`, ...a]);
        p.perms = perms;
        return p;
    };
    const bedrock = { world, system, InputPermissionCategory: { Camera: 1, Movement: 2 }, EasingType: {}, WeatherType: {}, CameraShakeType: {} };
    return { bedrock, tick, makePlayer, dimension, entities, afterLeave, afterDie, world };
}

const compile = src => Object.fromEntries(compileProgram(parse(src, "t.cinema"), { source: src, filename: "t.cinema" }).map(t => [t.id, t]));
const play = (src, opts = {}, players) => {
    const f = createFake();
    const p = players ?? [f.makePlayer("A")];
    const errors = [];
    const rt = createCinemaRuntime({ bedrock: f.bedrock, cutscenes: compile(src), onError: e => errors.push(e.message), ...opts.runtime });
    const handle = rt.play("c", p, opts.play);
    return { f, rt, p: p[0], players: p, handle, errors };
};
const calls = (p, kind) => p.calls.filter(c => c[0] === kind || c[0].startsWith(kind));
const wrap = body => `cutscene "c" {\n${body}\n}\n`;

// ---- player: timers ----
test("player timers: ctx.after fires once, ctx.every honours interval/duration, all stop when the session ends", () => {
    const log = [];
    const pl = createPlayer({ ops: { go: ctx => { ctx.after(3, () => log.push("after")); ctx.every(n => log.push(`e${n}@${ctx.elapsed()}`), { every: 2, ticks: 6 }); } } });
    const h = pl.start({ id: "t", durationTicks: 20, events: [{ t: 0, op: "go", args: {} }], onSkip: [] });
    h.tick(10);
    assert.deepStrictEqual(log.filter(l => l !== "after"), ["e0@2", "e1@4", "e2@6"]);
    assert.strictEqual(log.filter(l => l === "after").length, 1);
    const log2 = [];
    const pl2 = createPlayer({ ops: { go: ctx => ctx.every(() => log2.push(1)) } });
    const h2 = pl2.start({ id: "t", durationTicks: 100, events: [{ t: 0, op: "go", args: {} }], onSkip: [] });
    h2.tick(3); h2.stop(); h2.tick(5);
    assert.strictEqual(log2.length, 3);
});

// ---- relative coordinates ----
test("~ coordinates resolve against the player's floored start position, for ops and cast alike", () => {
    const f = createFake();
    const p = f.makePlayer("A");
    p.location = { x: 100.7, y: 64.2, z: -20.5 };
    const rt = createCinemaRuntime({ bedrock: f.bedrock, cutscenes: compile(wrap(`cast mira = entity "t:mira" at (~2, ~, ~)
lock cinematic
camera cut to (~, ~3, ~-4) look_at mira
particles "p" at (5, ~1, ~) count 1
wait 1t
unlock`)) });
    rt.play("c", [p]);
    assert.deepStrictEqual(f.entities[0].location, { x: 102, y: 64, z: -21 });
    const cut = calls(p, "camera.setCamera")[0][2];
    assert.deepStrictEqual(cut.location, { x: 100, y: 67, z: -25 });
    assert.deepStrictEqual(cut.facingLocation, { x: 102, y: 64, z: -21 });
    assert.deepStrictEqual(f.dimension.particles[0][1], { x: 5, y: 65, z: -21 });
    rt.stopAll();
});

// ---- lock ----
test("lock cinematic turns camera+movement off, unlock restores; lock position keeps the camera on", () => {
    const a = play(wrap("lock cinematic\nwait 1s\nunlock"));
    assert.deepStrictEqual([a.p.perms[1], a.p.perms[2]], [false, false]);
    a.f.tick(20);
    assert.deepStrictEqual([a.p.perms[1], a.p.perms[2]], [true, true]);
    assert.ok(a.rt.isPlaying(a.p) === false);
    const b = play(wrap("lock position\nwait 1s\nunlock"));
    assert.deepStrictEqual([b.p.perms[1], b.p.perms[2]], [true, false]);
    b.rt.stopAll();
    assert.deepStrictEqual([b.p.perms[1], b.p.perms[2]], [true, true]);
});

test("permissions are restored to their ORIGINAL values even when a later op throws", () => {
    const f = createFake();
    const p = f.makePlayer("A");
    p.inputPermissions.setPermissionCategory(2, false); // the game had movement off before the cutscene
    p.calls.length = 0;
    const errors = [];
    const rt = createCinemaRuntime({ bedrock: f.bedrock, cutscenes: compile(wrap('lock cinematic\nwait 1s\ncall "nope"\nunlock')), onError: e => errors.push(e.message) });
    rt.play("c", [p]);
    f.tick(25);
    assert.match(errors[0], /call "nope": no such function/);
    assert.deepStrictEqual([p.perms[1], p.perms[2]], [true, false], "restored what it found, not blindly true");
});

test("fade out holds black until fade in; cleanup cancels any fade", () => {
    const a = play(wrap("lock cinematic\nfade out 0.5s\nwait 1s\nfade in 0.5s\nwait 1s\nunlock"));
    const fades = () => calls(a.p, "camera.fade").map(c => c[1].fadeTime);
    assert.deepStrictEqual(fades()[0], { fadeInTime: 0.5, holdTime: 3600, fadeOutTime: 0 });
    a.f.tick(25);
    assert.deepStrictEqual(fades()[1], { fadeInTime: 0, holdTime: 0, fadeOutTime: 0.5 });
    a.f.tick(40);
    assert.deepStrictEqual(fades().at(-1), { fadeInTime: 0, holdTime: 0, fadeOutTime: 0 }, "cleanup resets the fade");
});

// ---- camera ----
test("camera cut / move / look_at / pan_up / dolly / fov / shake send exact Bedrock options", () => {
    const a = play(wrap(`cast mira = entity "t:mira" at (10, 64, 10)
lock cinematic
camera cut to (1, 70, 2) look_at mira fov 60
camera move to (5, 70, 2) over 3s ease inOutSine
camera look_at (0, 64, 0) over 1s
camera pan_up over 0.5s ease out
camera dolly by (0, 0, 4) over 2s
camera fov 90 over 1s ease in
camera shake strength 9 for 2s
wait 4s
unlock`));
    const c = calls(a.p, "camera.setCamera").map(x => x.slice(1));
    assert.deepStrictEqual(c[0], ["minecraft:free", { location: { x: 1, y: 70, z: 2 }, facingLocation: { x: 10, y: 64, z: 10 } }]);
    assert.deepStrictEqual(c[1][1].easeOptions, { easeTime: 3, easeType: "InOutSine" });
    assert.deepStrictEqual(c[1][1].location, { x: 5, y: 70, z: 2 });
    assert.deepStrictEqual(c[1][1].facingLocation, { x: 10, y: 64, z: 10 }, "keeps facing its last target while moving");
    assert.deepStrictEqual(c[2][1].facingLocation, { x: 0, y: 64, z: 0 });
    assert.deepStrictEqual(c[3][1].rotation.x, -90);
    assert.deepStrictEqual(c[3][1].easeOptions, { easeTime: 0.5, easeType: "OutQuad" });
    assert.deepStrictEqual(c[4][1].location, { x: 5, y: 70, z: 6 }, "dolly is relative to the last camera position");
    assert.deepStrictEqual(calls(a.p, "camera.setFov").map(x => x[1]), [{ fov: 60 }, { fov: 90, easeOptions: { easeTime: 1, easeType: "InQuad" } }]);
    assert.deepStrictEqual(calls(a.p, "camera.addShake")[0][1], { intensity: 4, duration: 2, type: "Rotational" });
    a.f.tick(100);
    for (const m of ["camera.stopShaking", "camera.clear"]) assert.ok(calls(a.p, m).length >= 1, `${m} on cleanup`);
});

test("camera orbit circles the target at the radius, keeps height, faces the centre and ends after `over`", () => {
    const a = play(wrap(`lock cinematic
camera cut to (10, 70, 0)
camera orbit around (0, 64, 0) radius 10 over 2s
wait 3s
unlock`));
    a.f.tick(60);
    const orbit = calls(a.p, "camera.setCamera").slice(1);
    assert.ok(orbit.length >= 15 && orbit.length <= 21, `about one update per 2 ticks over 2s (got ${orbit.length})`);
    for (const [, , o] of orbit) {
        assert.ok(Math.abs(Math.hypot(o.location.x, o.location.z) - 10) < 1e-9);
        assert.strictEqual(o.location.y, 70);
        assert.deepStrictEqual(o.facingLocation, { x: 0, y: 64, z: 0 });
    }
    const last = orbit.at(-1)[2].location;
    assert.ok(Math.hypot(last.x - 10, last.z) < 0.5, "a full turn by default");
});

test("camera follow re-aims at a moving cast member until the next camera instruction", () => {
    const a = play(wrap(`cast mira = entity "t:mira" at (10, 64, 0)
lock cinematic
camera cut to (0, 66, 0)
camera follow mira
wait 1s
camera cut to (5, 66, 5)
wait 1s
unlock`));
    const mira = a.f.entities[0];
    a.f.tick(6);
    mira.location = { x: 0, y: 64, z: 10 };
    a.f.tick(6);
    const follows = calls(a.p, "camera.setCamera").map(c => c[2]).filter(o => o.facingLocation && o.location.x === 0);
    assert.ok(follows.some(o => o.facingLocation.x === 10) && follows.some(o => o.facingLocation.z === 10));
    a.f.tick(20);
    const before = calls(a.p, "camera.setCamera").length;
    a.f.tick(10);
    assert.strictEqual(calls(a.p, "camera.setCamera").length, before, "the follow stopped at the second cut");
});

// ---- fx and world ----
test("particles (once and streamed), sound, title, weather, time, effects, teleport, heal", () => {
    const a = play(wrap(`particles "spark" at (1, 2, 3) radius 4 count 6
particles "mist" at (0, 0, 0) count 40 for 2s
sound "mob.cat.meow" at (1, 2, 3) volume 0.5 pitch 2
sound "ui.toast"
title "Chapter 1" subtitle "Dawn" for 3s fade 0.5s
weather thunder
time 18000
give_effect "slowness" for 5s level 3
clear_effects
teleport_player (7, 8, 9)
heal
wait 3s`));
    a.f.tick(110);
    const named = n => a.f.dimension.particles.filter(p => p[0] === n);
    assert.strictEqual(named("spark").length, 6);
    assert.strictEqual(named("mist").length, 40, "count over the duration, none lost to rounding");
    for (const [, l] of named("spark")) assert.ok(Math.abs(l.x - 1) <= 4 && Math.abs(l.z - 3) <= 4);
    assert.deepStrictEqual(calls(a.p, "sound").map(c => c.slice(1)), [["mob.cat.meow", { volume: 0.5, pitch: 2, location: { x: 1, y: 2, z: 3 } }], ["ui.toast", { volume: 1, pitch: 1 }]]);
    assert.deepStrictEqual(calls(a.p, "osd.setTitle")[0].slice(1), ["Chapter 1", { subtitle: "Dawn", fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 10 }]);
    assert.deepStrictEqual(a.f.dimension.weather, ["Thunder"]);
    assert.deepStrictEqual(a.f.world.calls, [["time", 18000]]);
    assert.deepStrictEqual(calls(a.p, "addEffect")[0].slice(1), ["slowness", 100, { amplifier: 2 }]);
    assert.deepStrictEqual(calls(a.p, "removeEffect")[0].slice(1), ["speed"]);
    assert.deepStrictEqual(calls(a.p, "tp")[0][1], { x: 7, y: 8, z: 9 });
    assert.strictEqual(calls(a.p, "heal").length, 1);
    assert.strictEqual(calls(a.p, "osd.setTitle").at(-1)[1], "", "the title is cleared on cleanup");
});

// ---- flow / hooks ----
test("call / emit / mark_seen / set_flag route to the game; a missing handler is an error", () => {
    const seen = [];
    const a = play(wrap(`call "boom"
emit "scene_done"
mark_seen "c"
set_flag "met_mira"
wait 1t`), { runtime: { functions: { boom: (env, players) => seen.push(["boom", players.length]) }, emit: (n, d) => seen.push(["emit", n, d.players.length]), hooks: { markSeen: (p, id) => seen.push(["seen", p.name, id]), setFlag: (p, f) => seen.push(["flag", f]) } } });
    a.f.tick(3);
    assert.deepStrictEqual(seen, [["boom", 1], ["emit", "scene_done", 1], ["seen", "A", "c"], ["flag", "met_mira"]]);
    const b = play(wrap("mark_seen \"c\"\nwait 1t"));
    assert.match(b.errors[0], /hooks\.markSeen is not provided/);
});

test("screen and letterbox degrade with one warning when the game has no UI hook, and call the hook when it has", () => {
    const warnings = [];
    const a = play(wrap(`mode letterbox\nscreen show "bg" fill fade 0.3s\nscreen hide\nscreen show "bg2"\nwait 1t`), { runtime: { warn: m => warnings.push(m) } });
    a.f.tick(3);
    assert.strictEqual(a.errors.length, 0);
    assert.strictEqual(warnings.length, 2, "one warning per missing hook, not per call");
    const log = [];
    const b = play(wrap(`mode letterbox\nscreen show "bg" fill fade 0.3s\nwait 1t\nscreen hide fade 0.1s\nwait 1t`), { runtime: { hooks: { letterbox: (ps, on) => log.push(["bars", on]), screenShow: (ps, t, o) => log.push(["show", t, o]), screenHide: (ps, o) => log.push(["hide", o]) } } });
    b.f.tick(6);
    assert.deepStrictEqual(log.slice(0, 3), [["bars", true], ["show", "bg", { fill: true, fade: 6 }], ["hide", { fade: 2 }]]);
    assert.deepStrictEqual(log.slice(3), [["hide", { fade: 0 }], ["bars", false]], "cleanup undoes in reverse order: overlay first, then the bars");
});

// ---- actors ----
test("actors: the cast entity is spawned, driven, and always removed", () => {
    const a = play(wrap(`cast mira = entity "t:mira" at (10, 64, 10)
mira.play "wave" loop
mira.say "Hello" for 2s
mira.emote "cheer"
mira.face (0, 64, 0)
mira.teleport (1, 2, 3)
mira.move (20, 64, 10) over 1s
wait 2s`));
    const mira = a.f.entities[0];
    assert.strictEqual(mira.typeId, "t:mira");
    assert.deepStrictEqual(mira.calls[0], ["play", "wave", { stopExpression: "0" }]);
    assert.deepStrictEqual(calls(a.p, "osd.setActionBar")[0][1], "mira: Hello");
    assert.deepStrictEqual(mira.calls.filter(c => c[0] === "event"), [["event", "cheer"]]);
    assert.deepStrictEqual(mira.calls.find(c => c[0] === "look")[1], { x: 0, y: 64, z: 0 });
    a.f.tick(30);
    const tps = mira.calls.filter(c => c[0] === "tp").map(c => c[1]);
    assert.ok(tps.length >= 21);
    assert.deepStrictEqual(tps[0], { x: 1, y: 2, z: 3 });
    assert.deepStrictEqual(tps.at(-1), { x: 20, y: 64, z: 10 }, "the glide ends exactly on target");
    a.f.tick(40);
    assert.strictEqual(mira.isValid, false, "removed when the cutscene ended");
});

test("an actor that was despawned mid-cutscene is a clear error, not a silent no-op", () => {
    const a = play(wrap(`cast mira = entity "t:mira" at (1, 2, 3)\nmira.despawn\nwait 1t\nmira.say "hi"\nwait 1t`));
    a.f.tick(5);
    assert.match(a.errors[0], /actor "mira" is not available/);
});

// ---- FMBE displays ----
function fakeFmbe() {
    const log = [];
    const mk = spec => {
        const d = { spec, anchor: null, removed: false, tweens: [], current: () => ({ pos: d.spec.pos ?? [0, 0, 0], rot: d.spec.rot ?? [0, 0, 0] }),
            tween(patch, o) { d.tweens.push([patch, o]); return d; }, set(p) { d.spec = { ...d.spec, ...p }; log.push(["set", p]); return d; }, glideTo(pts, o) { log.push(["glide", pts, o]); return d; }, remove() { d.removed = true; } };
        return d;
    };
    const fmbe = { spawned: [], spawn(dim, anchor, spec) { const d = mk(spec); d.anchor = anchor; fmbe.spawned.push(d); return d; } };
    return { fmbe, log };
}

test("display verbs drive FMBE: show/move/rotate/spin/scale/item/hide, `for` auto-hides, cleanup removes the rest", () => {
    const { fmbe, log } = fakeFmbe();
    const a = play(wrap(`display show gem item "minecraft:diamond" at (10.25, 65, 20.75) rot (0, 45, 0) scale 0.5 system basic
display show tmp block "minecraft:stone" at (0, 64, 0) for 1s
display move gem to (12, 66, 20.5) over 2s ease inOutSine
display move gem to (40, 66, 20.5) over 3s
display rotate gem to (0, 90, 0) over 1s loop pingpong
display spin gem by 720 over 4s
display scale gem to 2 over 1s ease out
display item gem "minecraft:emerald"
wait 5s`), { runtime: { fmbe } });
    const [gem, tmp] = fmbe.spawned;
    assert.deepStrictEqual(gem.anchor, { x: 10.5, y: 65, z: 20.5 });
    assert.deepStrictEqual([gem.spec.item, gem.spec.kind, gem.spec.pos, gem.spec.rot, gem.spec.scale, gem.spec.system], ["minecraft:emerald", "item", [-0.25, 0, 0.25], [0, 45, 0], 0.5, "basic"]);
    assert.deepStrictEqual(gem.tweens[0], [{ pos: [1.5, 1, 0] }, { ticks: 40, ease: "inOutSine" }]);
    assert.deepStrictEqual(log.find(l => l[0] === "glide").slice(1), [[{ x: 40 - gem.spec.pos[0], y: 66 - gem.spec.pos[1], z: 20.5 - gem.spec.pos[2] }], { ticksPerSegment: 60, ease: "linear" }]);
    assert.deepStrictEqual(gem.tweens[1], [{ rot: [0, 90, 0] }, { ticks: 20, ease: "linear", loop: "pingpong" }]);
    assert.strictEqual(gem.tweens[2][0].rot[1], gem.current().rot[1] + 720, "spin adds to the current yaw, any amount");
    assert.deepStrictEqual(gem.tweens[2][1], { ticks: 80, ease: "linear" });
    assert.deepStrictEqual(gem.tweens[3], [{ scale: 2 }, { ticks: 20, ease: "outQuad" }]);
    assert.strictEqual(gem.spec.item, "minecraft:emerald");
    a.f.tick(19);
    assert.strictEqual(tmp.removed, false);
    a.f.tick(3);
    assert.strictEqual(tmp.removed, true, "`for 1s` hid it");
    assert.strictEqual(gem.removed, false);
    a.f.tick(120);
    assert.strictEqual(gem.removed, true, "cleanup removed what the script left");
});

test("display verbs fail clearly without an fmbe runtime, and display scene drives compiled scenes", () => {
    const a = play(wrap(`display show g block "x:y" at (0, 0, 0)\nwait 1t`));
    assert.match(a.errors[0], /createCinemaRuntime\(\{ fmbe \}\)/);
    const { fmbe } = fakeFmbe();
    const handleLog = [];
    const handle = { play: n => handleLog.push(["play", n]), stop: n => handleLog.push(["stop", n]), remove: () => handleLog.push(["remove"]) };
    const spawnScene = (f, scene, place) => { handleLog.push(["scene", scene.id, place.yaw, place.scale, place.origin]); return handle; };
    const b = play(wrap(`display scene altar "altar" at (10, 64, 10) yaw 90 scale 2\ndisplay play altar "spin"\nwait 1s\ndisplay stop altar "spin"\nwait 1t`), { runtime: { fmbe, scenes: { altar: { id: "altar" } }, spawnScene } });
    b.f.tick(30);
    assert.deepStrictEqual(handleLog, [["scene", "altar", 90, 2, { x: 10, y: 64, z: 10 }], ["play", "spin"], ["stop", "spin"], ["remove"]]);
    const c = play(wrap(`display scene nope "ghost" at (0, 0, 0)\nwait 1t`), { runtime: { fmbe, scenes: {}, spawnScene } });
    assert.match(c.errors[0], /no such scene/);
});

// ---- runtime ----
test("runtime: unknown id, double play, onFinish info, skip runs `on skip`, leave and death clean up", () => {
    const f = createFake();
    const p = f.makePlayer("A");
    const finished = [];
    const rt = createCinemaRuntime({ bedrock: f.bedrock, cutscenes: compile(wrap('lock cinematic\nwait 10s\nunlock\non skip {\nsound "skipped"\n}')), onFinish: i => finished.push([i.cutsceneId, i.state]) });
    assert.throws(() => rt.play("zzz", [p]), /no cutscene "zzz"/);
    rt.play("c", [p]);
    assert.throws(() => rt.play("c", [p]), /already watching/);
    rt.skip(p);
    assert.deepStrictEqual(finished, [["c", "skipped"]]);
    assert.strictEqual(calls(p, "sound")[0][1], "skipped");
    assert.deepStrictEqual([p.perms[1], p.perms[2]], [true, true]);
    assert.strictEqual(rt.isPlaying(p), false);

    rt.play("c", [p]);
    f.afterLeave[0]({ playerId: p.id });
    assert.deepStrictEqual(finished.at(-1), ["c", "stopped"]);
    assert.deepStrictEqual([p.perms[1], p.perms[2]], [true, true]);

    rt.play("c", [p]);
    f.afterDie[0]({ deadEntity: { typeId: "minecraft:player", id: p.id } });
    assert.strictEqual(rt.isPlaying(p), false);
    rt.play("c", [p]);
    f.afterDie[0]({ deadEntity: { typeId: "minecraft:cow", id: p.id } });
    assert.strictEqual(rt.isPlaying(p), true, "only a player dying stops it");
    rt.stopAll();
    assert.strictEqual(rt.activeCount(), 0);
});

test("runtime: the tick loop stops when nothing is playing; two players watch one cutscene; missing second player is an error", () => {
    const f = createFake();
    const [a, b] = [f.makePlayer("A"), f.makePlayer("B")];
    const rt = createCinemaRuntime({ bedrock: f.bedrock, cutscenes: compile(wrap('cast one = player\ncast two = player 1\nlock cinematic\nwait 1s\nunlock')) });
    assert.throws(() => rt.play("c", [a]), /needs player #1/);
    rt.play("c", [a, b]);
    assert.deepStrictEqual([a.perms[2], b.perms[2]], [false, false]);
    f.tick(25);
    assert.deepStrictEqual([a.perms[2], b.perms[2]], [true, true]);
    assert.strictEqual(rt.activeCount(), 0);
    assert.strictEqual(f.bedrock.system.currentTick, 25);
});

console.log(`\n${passed} passed`);
