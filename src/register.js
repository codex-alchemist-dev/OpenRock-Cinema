// @openrock/cinema - plays compiled .cinema timelines (content.cinemaDsl) with guaranteed cleanup.
//   createPlayer          the pure scheduler (no Bedrock): sessions, skip, error isolation, per-tick timers
//   createDefaultOps      the real Bedrock handlers for every verb (camera, lock, fx, FMBE displays, actors, ...)
//   createCinemaRuntime   binds timelines to players and drives them (cast spawning, ticking, leave/death cleanup)
"use strict";

const { createPlayer } = require("./player.js");
const { createDefaultOps } = require("./ops/index.js");
const { createCinemaRuntime } = require("./runtime.js");

module.exports = { createPlayer, createDefaultOps, createCinemaRuntime };
