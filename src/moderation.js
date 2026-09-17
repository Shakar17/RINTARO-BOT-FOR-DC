// ============================================================================
// moderation.js
// ---------------------------------------------------------------------------
// Moderation utilities — ban, kick, timeout, purge, and warn commands.
// All functions return { ok: boolean, message: string } for embed responses.
// ============================================================================

const { PermissionFlagsBits } = require('discord.js');

/**
 * Check if the bot can act on a target member (role hierarchy).
 */
function canModerate(moderator, target) {
  if (target.id === moderator.guild.ownerId) return false;
  if (target.id === moderator.guild.members.me.id) return false;
  return moderator.roles.highest.position > target.roles.highest.position;
}

/**
 * Parse duration string to milliseconds.
 */
function parseDurationMs(input) {
  const match = input.match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * multipliers[unit];
}

/**
 * Timeout (mute) a member for a specified duration.
 */
async function timeout(moderator, target, durationStr, reason = 'No reason provided') {
  if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return { ok: false, message: 'You need **Timeout Members** permission.' };
  }
  if (!moderator.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return { ok: false, message: 'I need **Timeout Members** permission.' };
  }
  if (!canModerate(moderator, target)) {
    return { ok: false, message: 'Cannot timeout this user — they have an equal or higher role.' };
  }

  const ms = parseDurationMs(durationStr);
  if (!ms || ms < 1000 || ms > 2419200000) {
    return { ok: false, message: 'Invalid duration. Use format like `10m`, `1h`, `1d` (max 28d).' };
  }

  try {
    await target.timeout(ms, reason);
    return { ok: true, message: `Timed out **${target.user.tag}** for **${durationStr}**. Reason: ${reason}` };
  } catch {
    return { ok: false, message: `Failed to timeout **${target.user.tag}**.` };
  }
}

/**
 * Remove timeout from a member.
 */
async function removeTimeout(moderator, target, reason = 'Timeout removed') {
  if (!moderator.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return { ok: false, message: 'You need **Timeout Members** permission.' };
  }
  if (!canModerate(moderator, target)) {
    return { ok: false, message: 'Cannot modify this user.' };
  }

  try {
    await target.timeout(null, reason);
    return { ok: true, message: `Removed timeout from **${target.user.tag}**.` };
  } catch {
    return { ok: false, message: `Failed to remove timeout from **${target.user.tag}**.` };
  }
}

/**
 * Kick a member from the server.
 */
async function kick(moderator, target, reason = 'No reason provided') {
  if (!moderator.permissions.has(PermissionFlagsBits.KickMembers)) {
    return { ok: false, message: 'You need **Kick Members** permission.' };
  }
  if (!moderator.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
    return { ok: false, message: 'I need **Kick Members** permission.' };
  }
  if (!canModerate(moderator, target)) {
    return { ok: false, message: 'Cannot kick this user — they have an equal or higher role.' };
  }

  try {
    await target.kick(reason);
    return { ok: true, message: `Kicked **${target.user.tag}**. Reason: ${reason}` };
  } catch {
    return { ok: false, message: `Failed to kick **${target.user.tag}**.` };
  }
}

/**
 * Ban a member from the server.
 */
async function ban(moderator, target, reason = 'No reason provided', deleteDays = 0) {
  if (!moderator.permissions.has(PermissionFlagsBits.BanMembers)) {
    return { ok: false, message: 'You need **Ban Members** permission.' };
  }
  if (!moderator.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
    return { ok: false, message: 'I need **Ban Members** permission.' };
  }
  if (!canModerate(moderator, target)) {
    return { ok: false, message: 'Cannot ban this user — they have an equal or higher role.' };
  }

  try {
    await target.ban({ deleteMessageDays: deleteDays, reason });
    return { ok: true, message: `Banned **${target.user.tag}**. Reason: ${reason}` };
  } catch {
    return { ok: false, message: `Failed to ban **${target.user.tag}**.` };
  }
}

/**
 * Unban a user by ID.
 */
async function unban(moderator, userId, reason = 'No reason provided') {
  if (!moderator.permissions.has(PermissionFlagsBits.BanMembers)) {
    return { ok: false, message: 'You need **Ban Members** permission.' };
  }

  try {
    await moderator.guild.members.unban(userId, reason);
    return { ok: true, message: `Unbanned user ID **${userId}**.` };
  } catch {
    return { ok: false, message: `Failed to unban — user may not be banned.` };
  }
}

/**
 * Purge (bulk delete) messages from a channel.
 */
async function purge(channel, amount, targetUser = null) {
  if (!channel.guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return { ok: false, message: 'I need **Manage Messages** permission.' };
  }

  const limit = Math.max(1, Math.min(100, amount));
  try {
    let messages;
    if (targetUser) {
      const fetched = await channel.messages.fetch({ limit: 100 });
      const filtered = fetched.filter((m) => m.author.id === targetUser.id).first(limit);
      messages = await channel.bulkDelete(filtered, true);
    } else {
      messages = await channel.bulkDelete(limit, true);
    }
    return { ok: true, message: `Deleted **${messages.size}** message(s).` };
  } catch {
    return { ok: false, message: 'Failed to delete messages. Messages older than 14 days cannot be bulk deleted.' };
  }
}

module.exports = { timeout, removeTimeout, kick, ban, unban, purge, canModerate };
