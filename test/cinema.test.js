#!/usr/bin/env node
// Run: node libs/cinema/test/cinema.test.js
"use strict";

const assert = require("assert");
const { createPlayer } = require("../src/register.js");

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`ok - ${name}`); }
    catch (e) { console.error(`FAIL - ${name}`); console.error(e); process.exitCode = 1; }
}

const tl = (events, extra = {}) => ({ id: "t", durationTicks: events.length ? events[events.length - 1].t : 0, cast: [], mode: "none", events, onSkip: [], ...extra });
const ev = (t, op, args = {}) => ({ t, op, args });

function harness(extraOps = {}) {
    const log = [];
    const errors = [];
    const ops = {
        lock: ctx => { log.push("lock"); ctx.onCleanup(() => log.push("release")); },
        say: (ctx, a) => log.push(`say:${a.pos[0]}@${ctx.elapsed()}`),
        boom: () => { throw new Error("kaput"); },
        ...extraOps,
    };
    return { log, errors, player: createPlayer({ ops, onError: e => errors.push(e.message) }) };
}

test("t=0 events run at start; later events run when their tick arrives, in source order", () => {
    const { log, player } = harness();
    const s = player.start(tl([ev(0, "lock"), ev(0, "say", { pos: ["a"] }), ev(5, "say", { pos: ["b"] })]));
    assert.deepStrictEqual(log, ["lock", "say:a@0"]);
    s.tick(4);
    assert.deepStrictEqual(log, ["lock", "say:a@0"]);
    s.tick(1);
    assert.deepStrictEqual(log.slice(-2), ["say:b@5", "release"]);
    assert.strictEqual(s.state(), "finished");
});

test("cleanup runs once, in reverse registration order, and never again after the session ends", () => {
    const order = [];
    const { player } = harness({ two: ctx => { ctx.onCleanup(() => order.push("first")); ctx.onCleanup(() => order.push("second")); } });
    const s = player.start(tl([ev(0, "two")], { durationTicks: 2 }));
    s.tick(2);
    assert.deepStrictEqual(order, ["second", "first"]);
    s.tick(10); s.stop(); s.skip();
    assert.deepStrictEqual(order, ["second", "first"]);
});

test("stop() cleans up immediately and further ticks do nothing", () => {
    const { log, player } = harness();
    const s = player.start(tl([ev(0, "lock"), ev(50, "say", { pos: ["late"] })]));
    s.stop();
    assert.deepStrictEqual(log, ["lock", "release"]);
    s.tick(100);
    assert.strictEqual(s.state(), "stopped");
    assert.strictEqual(log.length, 2);
});

test("skip() runs the onSkip events (not the remaining timeline) then cleans up", () => {
    const { log, player } = harness();
    const s = player.start(tl([ev(0, "lock"), ev(100, "say", { pos: ["never"] })], { onSkip: [ev(0, "say", { pos: ["skipped"] })] }));
    s.tick(10);
    s.skip();
    assert.deepStrictEqual(log, ["lock", "say:skipped@10", "release"]);
    assert.strictEqual(s.state(), "skipped");
});

test("a throwing op ends only that session, after cleanup, via onError; other sessions continue", () => {
    const { log, errors, player } = harness();
    const bad = player.start(tl([ev(0, "lock"), ev(3, "boom")], { id: "bad" }));
    const good = player.start(tl([ev(0, "lock"), ev(6, "say", { pos: ["ok"] })], { id: "good" }));
    bad.tick(3);
    assert.strictEqual(bad.state(), "errored");
    assert.deepStrictEqual(errors, ["kaput"]);
    assert.strictEqual(good.state(), "running");
    good.tick(6);
    assert.strictEqual(good.state(), "finished");
    assert.strictEqual(log.filter(x => x === "release").length, 2, "each session released its own lock exactly once");
});

test("an unknown op is an error and the session is cleaned up (never silently ignored)", () => {
    const { log, errors, player } = harness();
    const s = player.start(tl([ev(0, "lock"), ev(1, "nope")]));
    s.tick(1);
    assert.strictEqual(s.state(), "errored");
    assert.match(errors[0], /no handler registered for op "nope"/);
    assert.deepStrictEqual(log, ["lock", "release"]);
});

test("an error at t=0 still cleans up what ran before it", () => {
    const { log, player } = harness();
    const s = player.start(tl([ev(0, "lock"), ev(0, "boom")]));
    assert.strictEqual(s.state(), "errored");
    assert.deepStrictEqual(log, ["lock", "release"]);
});

test("stopAll() ends every active session with cleanup; activeCount tracks sessions", () => {
    const { log, player } = harness();
    player.start(tl([ev(0, "lock"), ev(99, "say", { pos: ["x"] })]));
    player.start(tl([ev(0, "lock"), ev(99, "say", { pos: ["y"] })]));
    assert.strictEqual(player.activeCount(), 2);
    player.stopAll();
    assert.strictEqual(player.activeCount(), 0);
    assert.strictEqual(log.filter(x => x === "release").length, 2);
});

test("ctx.env reaches every op; a long-tail timeline finishes only once durationTicks has elapsed", () => {
    const seen = [];
    const { player } = harness({ spy: ctx => seen.push(ctx.env.who) });
    const s = player.start(tl([ev(0, "spy")], { durationTicks: 20 }), { who: "p1" });
    s.tick(19);
    assert.strictEqual(s.state(), "running");
    s.tick(1);
    assert.strictEqual(s.state(), "finished");
    assert.deepStrictEqual(seen, ["p1"]);
});

console.log(`\n${passed} passed`);
