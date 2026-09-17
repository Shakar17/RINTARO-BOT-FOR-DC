// ============================================================================
// customCommands.js
// ---------------------------------------------------------------------------
// Server-specific custom commands. Server owners can create simple text
// responses or embeds triggered by a command name. Persisted to
// data/customCommands.json.
//
// Commands:
//   !cmd-add <name> <response>
//   !cmd-remove <name>
//   !cmd-list
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');

const DATA_FILE = path.resolve('data', 'customCommands.json');

let commands = load();

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(commands, null, 2));
}

/**
 * Get all custom commands for a guild.
 */
function getCommands(guildId) {
  return commands[guildId] || {};
}

/**
 * Get a specific custom command.
 */
function getCommand(guildId, name) {
  return commands[guildId]?.[name.toLowerCase()] || null;
}

/**
 * Add or update a custom command.
 */
function addCommand(guildId, name, response, useEmbed = false) {
  const normalized = name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!normalized || normalized.length > 32) {
    return { ok: false, message: 'Command name must be 1-32 characters (letters, numbers, _, -).' };
  }
  if (response.length > 2000) {
    return { ok: false, message: 'Response must be under 2000 characters.' };
  }

  commands[guildId] = commands[guildId] || {};
  commands[guildId][normalized] = { response, useEmbed, createdAt: Date.now() };
  save();
  return { ok: true, message: `Command \`!${normalized}\` ${commands[guildId][normalized].createdAt ? 'updated' : 'created'}.` };
}

/**
 * Remove a custom command.
 */
function removeCommand(guildId, name) {
  const normalized = name.toLowerCase();
  if (!commands[guildId]?.[normalized]) {
    return { ok: false, message: `Command \`!${normalized}\` does not exist.` };
  }
  delete commands[guildId][normalized];
  save();
  return { ok: true, message: `Command \`!${normalized}\` removed.` };
}

/**
 * Execute a custom command and return the response.
 */
function executeCommand(guildId, name) {
  const cmd = getCommand(guildId, name);
  if (!cmd) return null;

  if (cmd.useEmbed) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setDescription(cmd.response)
      .setTimestamp()
      .setFooter({ text: 'Custom Command' });
    return { embeds: [embed] };
  }
  return { content: cmd.response };
}

module.exports = {
  getCommands,
  getCommand,
  addCommand,
  removeCommand,
  executeCommand,
};
