// particles / sound / title, plus world and player ops (weather, time, effects, teleport, heal).
"use strict";

const { eachPlayer, dimensionOf, vec, seconds, once } = require("./util.js");

function createFxOps(bedrock) {
    const weather = { clear: "Clear", rain: "Rain", thunder: "Thunder" };
    const rand = () => Math.random() * 2 - 1;

    return {
        /** `count` particles once, or - with `for` - `count` per second spread over the duration, scattered within `radius`. */
        particles(ctx, args) {
            const effect = args.pos[0];
            const center = args.at ? vec(args.at) : ctx.env.players[0].location;
            const radius = args.radius ?? 0;
            const dim = dimensionOf(ctx);
            const spawn = n => {
                for (let i = 0; i < n; i++) dim.spawnParticle(effect, { x: center.x + rand() * radius, y: center.y + (radius ? Math.abs(rand()) * radius * 0.5 : 0), z: center.z + rand() * radius });
            };
            const count = args.count ?? 1;
            if (!args.for) { spawn(count); return; }
            const perTick = count / seconds(args.for) / 20;
            let owed = 0;
            ctx.every(() => { owed += perTick; const n = Math.floor(owed); owed -= n; spawn(n); }, { ticks: args.for });
        },
        sound(ctx, args) {
            const options = { volume: args.volume ?? 1, pitch: args.pitch ?? 1 };
            eachPlayer(ctx, p => p.playSound(args.pos[0], args.at ? { ...options, location: vec(args.at) } : options));
        },
        title(ctx, args) {
            const fade = args.fade ?? 10;
            const stay = args.for ?? 60;
            once(ctx, "title-cleanup", () => ctx.onCleanup(() => { for (const p of ctx.env.players) { try { p.onScreenDisplay.setTitle(""); } catch (e) { /* gone */ } } }));
            eachPlayer(ctx, p => p.onScreenDisplay.setTitle(args.pos[0], { subtitle: args.subtitle, fadeInDuration: fade, stayDuration: stay, fadeOutDuration: fade }));
        },
        weather(ctx, args) { dimensionOf(ctx).setWeather(bedrock.WeatherType?.[weather[args.pos[0]]] ?? weather[args.pos[0]]); },
        time(ctx, args) { bedrock.world.setTimeOfDay(args.pos[0]); },
        clearEffects(ctx) { eachPlayer(ctx, p => { for (const e of p.getEffects()) p.removeEffect(e.typeId); }); },
        /** `level` is the in-game level (1 = I), i.e. amplifier level-1. */
        giveEffect(ctx, args) {
            const duration = args.for ?? 600;
            eachPlayer(ctx, p => p.addEffect(args.pos[0], duration, { amplifier: Math.max(0, (args.level ?? 1) - 1) }));
        },
        teleportPlayer(ctx, args) { eachPlayer(ctx, p => p.teleport(vec(args.pos[0]))); },
        heal(ctx) { eachPlayer(ctx, p => p.getComponent("minecraft:health").resetToMaxValue()); },
    };
}

module.exports = { createFxOps };
