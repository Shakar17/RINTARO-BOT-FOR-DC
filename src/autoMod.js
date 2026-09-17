// ============================================================================
// autoMod.js
// ---------------------------------------------------------------------------
// Lightweight auto-mod system — anti-spam (message flood), banned-word
// filter, and auto-warn. All settings are server-specific and persisted
// to data/autoMod.json.
//
// Features:
//   - Spam detection: flags users who send too many messages too quickly.
//   - Word filter: deletes messages containing banned words.
//   - Auto-warn: tracks warns per user; owners can set warn thresholds.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');

const DATA_FILE = path.resolve('data', 'autoMod.json');

// In-memory state
let settings = loadSettings();
const spamCache = new Map(); // userId -> { count, firstTimestamp }

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(settings, null, 2));
}

// ---------------------------------------------------------------------------
// Settings management
// ---------------------------------------------------------------------------

function getGuildConfig(guildId) {
  if (!settings[guildId]) {
    settings[guildId] = {
      enabled: true,
      spamLimit: 5,        // messages
      spamWindowMs: 5000,  // within this window
      bannedWords: [],
      warnThreshold: 3,    // warns before action
      warnAction: 'mute',  // 'mute', 'kick', 'ban'
      logChannelId: null,
    };
  }
  return settings[guildId];
}

function setSpamLimit(guildId, limit, windowMs) {
  const config = getGuildConfig(guildId);
  config.spamLimit = Math.max(2, Math.min(20, limit));
  config.spamWindowMs = Math.max(1000, Math.min(60000, windowMs));
  saveSettings();
}

function addBannedWord(guildId, word) {
  const config = getGuildConfig(guildId);
  const normalized = word.toLowerCase().trim();
  if (!config.bannedWords.includes(normalized)) {
    config.bannedWords.push(normalized);
    saveSettings();
    return true;
  }
  return false;
}

function removeBannedWord(guildId, word) {
  const config = getGuildConfig(guildId);
  const normalized = word.toLowerCase().trim();
  const index = config.bannedWords.indexOf(normalized);
  if (index > -1) {
    config.bannedWords.splice(index, 1);
    saveSettings();
    return true;
  }
  return false;
}

function setLogChannel(guildId, channelId) {
  const config = getGuildConfig(guildId);
  config.logChannelId = channelId;
  saveSettings();
}

// ---------------------------------------------------------------------------
// Spam detection
// ---------------------------------------------------------------------------

/**
 * Check if a message is spam. Returns true if it should be actioned.
 */
function isSpam(guildId, userId) {
  const config = getGuildConfig(guildId);
  if (!config.enabled) return false;

  const now = Date.now();
  const key = `${guildId}:${userId}`;
  const record = spamCache.get(key);

  if (!record || now - record.firstTimestamp > config.spamWindowMs) {
    // Reset window
    spamCache.set(key, { count: 1, firstTimestamp: now });
    return false;
  }

  record.count++;
  return record.count >= config.spamLimit;
}

// ---------------------------------------------------------------------------
// Word filter
// ---------------------------------------------------------------------------

/**
 * Check if a message contains banned words. Returns the first match or null.
 */
function containsBannedWord(guildId, content) {
  const config = getGuildConfig(guildId);
  if (!config.enabled || config.bannedWords.length === 0) return null;

  const lower = content.toLowerCase();
  for (const word of config.bannedWords) {
    // Match whole words only (avoid false positives like "class" containing "ass")
    const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'i');
    if (regex.test(lower)) return word;
  }
  return null;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Warn system
// ---------------------------------------------------------------------------

/**
 * Add a warning to a user. Returns the new warn count.
 */
function warnUser(guildId, userId) {
  const config = getGuildConfig(guildId);
  if (!config.warns) config.warns = {};
  config.warns[userId] = (config.warns[userId] || 0) + 1;
  saveSettings();
  return config.warns[userId];
}

function getWarns(guildId, userId) {
  return settings[guildId]?.warns?.[userId] || 0;
}

function clearWarns(guildId, userId) {
  if (settings[guildId]?.warns) {
    delete settings[guildId].warns[userId];
    saveSettings();
  }
}

module.exports = {
  getGuildConfig,
  setSpamLimit,
  addBannedWord,
  removeBannedWord,
  setLogChannel,
  isSpam,
  containsBannedWord,
  warnUser,
  getWarns,
  clearWarns,
};
