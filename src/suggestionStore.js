// ============================================================================
// suggestionStore.js
// ---------------------------------------------------------------------------
// Shared per-guild store of "Similar Songs" suggestions. The !play command
// (index.js) and the /play slash command (commands/music.js) both write here,
// and the d4c_sim_<n> button / d4c_qremove menu handlers read from it.
// ============================================================================
const songSuggestions = new Map(); // guildId -> [{ title, url }]

module.exports = { songSuggestions };
