// ============================================================================
// reactionRoles.js
// ---------------------------------------------------------------------------
// Reaction role system — assign/remove roles when users react to specific
// messages. Data is persisted to data/reactionRoles.json so it survives
// restarts.
//
// Flow:
//   1. Owner uses !rr-add <messageId> <emoji> <roleId> to bind a reaction.
//   2. When a user reacts with that emoji on that message, they get the role.
//   3. When they remove the reaction, the role is removed.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');

const DATA_FILE = path.resolve('data', 'reactionRoles.json');

// In-memory store: { [messageId]: { [emoji]: roleId } }
let bindings = load();

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(bindings, null, 2));
}

/**
 * Add a reaction-role binding.
 * @param {string} messageId - The message to watch reactions on.
 * @param {string} emoji - The emoji (Unicode or custom emoji ID).
 * @param {string} roleId - The role to assign.
 * @returns {{ok: boolean, message: string}}
 */
function addBinding(messageId, emoji, roleId) {
  if (!/^\d{17,20}$/.test(messageId)) return { ok: false, message: 'Invalid message ID.' };
  if (!/^\d{17,20}$/.test(roleId)) return { ok: false, message: 'Invalid role ID.' };

  bindings[messageId] = bindings[messageId] || {};
  bindings[messageId][emoji] = roleId;
  save();
  return { ok: true, message: `Bound ${emoji} → <@&${roleId}> on message ${messageId}.` };
}

/**
 * Remove a reaction-role binding.
 */
function removeBinding(messageId, emoji) {
  if (!bindings[messageId]) return { ok: false, message: 'No bindings found for that message.' };
  if (emoji) {
    if (!bindings[messageId][emoji]) return { ok: false, message: `No binding for ${emoji} on that message.` };
    delete bindings[messageId][emoji];
    if (Object.keys(bindings[messageId]).length === 0) delete bindings[messageId];
    save();
    return { ok: true, message: `Removed binding for ${emoji}.` };
  }
  // Remove all bindings for this message
  delete bindings[messageId];
  save();
  return { ok: true, message: `Removed all bindings for message ${messageId}.` };
}

/**
 * Get all bindings for a message (for listing).
 */
function getBindings(messageId) {
  return bindings[messageId] || {};
}

/**
 * Handle a reaction being added.
 * Called from the messageReactionAdd event.
 */
async function handleReactionAdd(reaction, user) {
  if (user.bot) return;
  const messageId = reaction.message.id;
  const bindingsForMessage = bindings[messageId];
  if (!bindingsForMessage) return;

  // Support both Unicode and custom emojis
  const emojiKey = reaction.emoji.id || reaction.emoji.name;
  const roleId = bindingsForMessage[emojiKey];
  if (!roleId) return;

  try {
    const member = await reaction.message.guild.members.fetch(user.id);
    if (member.roles.cache.has(roleId)) return; // already has it
    await member.roles.add(roleId, 'Reaction role');
  } catch (err) {
    console.error(`[reactionRoles] Failed to add role ${roleId} to ${user.id}: ${err.message}`);
  }
}

/**
 * Handle a reaction being removed.
 * Called from the messageReactionRemove event.
 */
async function handleReactionRemove(reaction, user) {
  if (user.bot) return;
  const messageId = reaction.message.id;
  const bindingsForMessage = bindings[messageId];
  if (!bindingsForMessage) return;

  const emojiKey = reaction.emoji.id || reaction.emoji.name;
  const roleId = bindingsForMessage[emojiKey];
  if (!roleId) return;

  try {
    const member = await reaction.message.guild.members.fetch(user.id);
    if (!member.roles.cache.has(roleId)) return;
    await member.roles.remove(roleId, 'Reaction role');
  } catch (err) {
    console.error(`[reactionRoles] Failed to remove role ${roleId} from ${user.id}: ${err.message}`);
  }
}

module.exports = {
  addBinding,
  removeBinding,
  getBindings,
  handleReactionAdd,
  handleReactionRemove,
};
