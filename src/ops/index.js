// The default op table: every verb of the cinema language has exactly one handler here (or is routed to a game hook).
// `bedrock` is the injected @minecraft/server surface ({ world, system, InputPermissionCategory, EasingType, WeatherType,
// CameraShakeType }), so the whole table runs against a fake in tests.
"use strict";

const { createLockOps } = require("./lock.js");
const { createCameraOps } = require("./camera.js");
const { createFxOps } = require("./fx.js");
const { createFlowOps } = require("./flow.js");
const { createScreenOps } = require("./screen.js");
const { createDisplayOps } = require("./display.js");
const { createActorOps } = require("./actors.js");

function createDefaultOps(bedrock) {
    const groups = { lock: createLockOps(bedrock), camera: createCameraOps(bedrock), fx: createFxOps(bedrock), flow: createFlowOps(), screen: createScreenOps(), display: createDisplayOps(), actors: createActorOps() };
    const ops = {};
    for (const [group, table] of Object.entries(groups)) {
        for (const [name, handler] of Object.entries(table)) {
            if (ops[name]) throw new Error(`cinema: op "${name}" is registered twice (second time by "${group}")`);
            ops[name] = handler;
        }
    }
    return ops;
}

module.exports = { createDefaultOps };
