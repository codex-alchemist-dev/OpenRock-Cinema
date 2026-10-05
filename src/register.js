// @openrock/cinema - runtime player for compiled Crystal Cinema timelines.
// The language/compiler lives in OpenRock core (src/cinemaDsl/); this library
// is what runs in-world. Bedrock-facing op handlers are supplied by the mod
// (or by default handler packs) and injected into createPlayer().
"use strict";

const { createPlayer } = require("./player.js");

const api = { createPlayer };

function register() {
    return { api };
}

module.exports = Object.assign(register, api);
