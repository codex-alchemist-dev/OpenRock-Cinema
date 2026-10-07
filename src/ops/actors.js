// actor.* ops, applied to a cast member (`cast mira = entity "ns:mira" at (x, y, z)`; the runtime spawns it and removes it
// again on cleanup). Contracts with the game:
//   actor play   entity.playAnimation(name)  - `loop` passes a stop expression that never fires, so it runs until despawn
//   actor say    env.hooks.say(name, text, ticks, players) if given, else the action bar of every player, refreshed until done
//   actor emote  entity.triggerEvent(name)   - the entity definition decides what the emote event does
//   actor move   a server-stepped linear glide (one teleport per tick), turning the actor to face where it is going
"use strict";

const { eachPlayer, vec, anglesTo } = require("./util.js");

function createActorOps() {
    const actorOf = (ctx, event) => {
        const a = ctx.env.cast?.[event.actor];
        if (!a || !a.isValid) throw new Error(`cinema: actor "${event.actor}" is not available (despawned or never spawned)`);
        return a;
    };

    return {
        "actor.play"(ctx, args, event) {
            const a = actorOf(ctx, event);
            a.playAnimation(args.pos[0], args.loop ? { stopExpression: "0" } : undefined);
        },
        "actor.say"(ctx, args, event) {
            const a = actorOf(ctx, event);
            const text = args.pos[0];
            const ticks = args.for ?? Math.max(40, text.length * 3);
            if (ctx.env.hooks?.say) { ctx.env.hooks.say(a.nameTag || event.actor, text, ticks, ctx.env.players); return; }
            const line = `${a.nameTag || event.actor}: ${text}`;
            const show = () => eachPlayer(ctx, p => p.onScreenDisplay.setActionBar(line));
            show();
            ctx.every(show, { every: 30, ticks });
        },
        "actor.emote"(ctx, args, event) { actorOf(ctx, event).triggerEvent(args.pos[0]); },
        "actor.teleport"(ctx, args, event) { actorOf(ctx, event).teleport(vec(args.pos[0])); },
        "actor.face"(ctx, args, event) {
            const a = actorOf(ctx, event);
            const t = Array.isArray(args.pos[0]) ? vec(args.pos[0]) : (ctx.env.cast?.[args.pos[0]]?.location);
            if (!t) throw new Error(`cinema: actor face: "${args.pos[0]}" is not in the cast`);
            a.lookAt(t);
        },
        "actor.move"(ctx, args, event) {
            const a = actorOf(ctx, event);
            const from = { ...a.location };
            const to = vec(args.pos[0]);
            const ticks = args.over;
            const facing = anglesTo(from, to);
            try { a.setRotation(facing); } catch (e) { /* mobs without a head */ }
            ctx.every(n => {
                if (!a.isValid) return;
                const k = Math.min(1, (n + 1) / ticks);
                a.teleport({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k });
            }, { ticks });
        },
        "actor.despawn"(ctx, args, event) {
            const a = ctx.env.cast?.[event.actor];
            if (a && a.isValid) a.remove();
        },
    };
}

module.exports = { createActorOps };
