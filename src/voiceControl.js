// ============================================================================
// voiceControl.js
// ---------------------------------------------------------------------------
// Voice channel management utilities — deafen, mute, unmute, undeafen,
// disconnect, move members, move everyone, and hold/loop users in a channel.
//
// All functions return { ok: boolean, message: string } for easy embed
// responses via the shared embed helper.
// ============================================================================

const { PermissionFlagsBits } = require('discord.js');

// Holds: guildId -> { userId -> channelId }
// When a user is "held", the bot force-keeps them in the held channel
// (e.g. voice-stuck / loop user).
const holds = new Map();

/**
 * Check that the bot has permission to moderate voice in this guild.
 */
function botCanModerateVoice(guild) {
  return guild.members.me?.permissions.has(PermissionFlagsBits.MuteMembers | PermissionFlagsBits.DeafenMembers);
}

/**
 * Check that the invoking member is in a voice channel.
 */
function requireVoiceChannel(member) {
  return member?.voice?.channel || null;
}

/**
 * Deafen one or all members in the caller's voice channel.
 * @param {GuildMember} moderator - The member issuing the command.
 * @param {string} [targetId] - Optional: specific user ID to deafen. If omitted, deafens everyone.
 */
async function deafen(moderator, targetId) {
  const channel = requireVoiceChannel(moderator);
  if (!channel) return { ok: false, message: 'You must be in a voice channel to use this.' };
  if (!botCanModerateVoice(moderator.guild)) return { ok: false, message: 'I need **Mute Members** and **Deafen Members** permissions.' };

  if (targetId) {
    const target = channel.members.get(targetId);
    if (!target) return { ok: false, message: 'That user is not in your voice channel.' };
    if (target.id === moderator.guild.ownerId) return { ok: false, message: 'Cannot deafen the server owner.' };
    try {
      await target.voice.setDeaf(true, `Deafened by ${moderator.user.tag}`);
      return { ok: true, message: `Deafened **${target.user.tag}**.` };
    } catch {
      return { ok: false, message: `Failed to deafen **${target.user.tag}**. Check role hierarchy.` };
    }
  }

  // Deafen everyone in the channel
  let count = 0;
  for (const [, member] of channel.members) {
    if (member.id === moderator.guild.ownerId || member.id === moderator.guild.members.me.id) continue;
    try {
      await member.voice.setDeaf(true, `Deafened by ${moderator.user.tag}`);
      count++;
    } catch { /* skip members we can't affect */ }
  }
  return { ok: true, message: `Deafened **${count}** member(s) in **${channel.name}**.` };
}

/**
 * Undeafen one or all members in the caller's voice channel.
 */
async function undeafen(moderator, targetId) {
  const channel = requireVoiceChannel(moderator);
  if (!channel) return { ok: false, message: 'You must be in a voice channel to use this.' };
  if (!botCanModerateVoice(moderator.guild)) return { ok: false, message: 'I need **Mute Members** and **Deafen Members** permissions.' };

  if (targetId) {
    const target = channel.members.get(targetId);
    if (!target) return { ok: false, message: 'That user is not in your voice channel.' };
    try {
      await target.voice.setDeaf(false, `Undeafened by ${moderator.user.tag}`);
      return { ok: true, message: `Undeafened **${target.user.tag}**.` };
    } catch {
      return { ok: false, message: `Failed to undeafen **${target.user.tag}**. Check role hierarchy.` };
    }
  }

  let count = 0;
  for (const [, member] of channel.members) {
    if (member.id === moderator.guild.members.me.id) continue;
    try {
      await member.voice.setDeaf(false, `Undeafened by ${moderator.user.tag}`);
      count++;
    } catch { /* skip */ }
  }
  return { ok: true, message: `Undeafened **${count}** member(s) in **${channel.name}**.` };
}

/**
 * Server-mute one or all members in the caller's voice channel.
 */
async function mute(moderator, targetId) {
  const channel = requireVoiceChannel(moderator);
  if (!channel) return { ok: false, message: 'You must be in a voice channel to use this.' };
  if (!botCanModerateVoice(moderator.guild)) return { ok: false, message: 'I need **Mute Members** permission.' };

  if (targetId) {
    const target = channel.members.get(targetId);
    if (!target) return { ok: false, message: 'That user is not in your voice channel.' };
    if (target.id === moderator.guild.ownerId) return { ok: false, message: 'Cannot mute the server owner.' };
    try {
      await target.voice.setMute(true, `Muted by ${moderator.user.tag}`);
      return { ok: true, message: `Muted **${target.user.tag}**.` };
    } catch {
      return { ok: false, message: `Failed to mute **${target.user.tag}**. Check role hierarchy.` };
    }
  }

  let count = 0;
  for (const [, member] of channel.members) {
    if (member.id === moderator.guild.ownerId || member.id === moderator.guild.members.me.id) continue;
    try {
      await member.voice.setMute(true, `Muted by ${moderator.user.tag}`);
      count++;
    } catch { /* skip */ }
  }
  return { ok: true, message: `Muted **${count}** member(s) in **${channel.name}**.` };
}

/**
 * Unmute one or all members in the caller's voice channel.
 */
async function unmute(moderator, targetId) {
  const channel = requireVoiceChannel(moderator);
  if (!channel) return { ok: false, message: 'You must be in a voice channel to use this.' };
  if (!botCanModerateVoice(moderator.guild)) return { ok: false, message: 'I need **Mute Members** permission.' };

  if (targetId) {
    const target = channel.members.get(targetId);
    if (!target) return { ok: false, message: 'That user is not in your voice channel.' };
    try {
      await target.voice.setMute(false, `Unmuted by ${moderator.user.tag}`);
      return { ok: true, message: `Unmuted **${target.user.tag}**.` };
    } catch {
      return { ok: false, message: `Failed to unmute **${target.user.tag}**. Check role hierarchy.` };
    }
  }

  let count = 0;
  for (const [, member] of channel.members) {
    if (member.id === moderator.guild.members.me.id) continue;
    try {
      await member.voice.setMute(false, `Unmuted by ${moderator.user.tag}`);
      count++;
    } catch { /* skip */ }
  }
  return { ok: true, message: `Unmuted **${count}** member(s) in **${channel.name}**.` };
}

/**
 * Disconnect a specific member from voice (or all members if no target).
 */
async function disconnect(moderator, targetId) {
  const channel = requireVoiceChannel(moderator);
  if (!channel) return { ok: false, message: 'You must be in a voice channel to use this.' };
  if (!moderator.guild.members.me?.permissions.has(PermissionFlagsBits.MoveMembers)) {
    return { ok: false, message: 'I need **Move Members** permission.' };
  }

  if (targetId) {
    const target = channel.members.get(targetId);
    if (!target) return { ok: false, message: 'That user is not in your voice channel.' };
    if (target.id === moderator.guild.ownerId) return { ok: false, message: 'Cannot disconnect the server owner.' };
    try {
      await target.voice.disconnect(`Disconnected by ${moderator.user.tag}`);
      return { ok: true, message: `Disconnected **${target.user.tag}** from voice.` };
    } catch {
      return { ok: false, message: `Failed to disconnect **${target.user.tag}**. Check role hierarchy.` };
    }
  }

  let count = 0;
  for (const [, member] of channel.members) {
    if (member.id === moderator.guild.ownerId || member.id === moderator.guild.members.me.id) continue;
    try {
      await member.voice.disconnect(`Disconnected by ${moderator.user.tag}`);
      count++;
    } catch { /* skip */ }
  }
  return { ok: true, message: `Disconnected **${count}** member(s) from **${channel.name}**.` };
}

/**
 * Move a member (or all members) to another voice channel.
 * @param {GuildMember} moderator
 * @param {string} targetChannelId - The destination voice channel ID.
 * @param {string} [targetUserId] - Optional: specific user to move. If omitted, moves everyone.
 */
async function move(moderator, targetChannelId, targetUserId) {
  const sourceChannel = requireVoiceChannel(moderator);
  if (!sourceChannel) return { ok: false, message: 'You must be in a voice channel to use this.' };
  if (!moderator.guild.members.me?.permissions.has(PermissionFlagsBits.MoveMembers)) {
    return { ok: false, message: 'I need **Move Members** permission.' };
  }

  const destChannel = moderator.guild.channels.cache.get(targetChannelId);
  if (!destChannel || !destChannel.isVoiceBased()) {
    return { ok: false, message: 'Destination channel not found or is not a voice channel.' };
  }

  if (targetUserId) {
    const target = sourceChannel.members.get(targetUserId);
    if (!target) return { ok: false, message: 'That user is not in your voice channel.' };
    try {
      await target.voice.setChannel(destChannel.id, `Moved by ${moderator.user.tag}`);
      return { ok: true, message: `Moved **${target.user.tag}** to **${destChannel.name}**.` };
    } catch {
      return { ok: false, message: `Failed to move **${target.user.tag}**. Check permissions/hierarchy.` };
    }
  }

  let count = 0;
  for (const [, member] of sourceChannel.members) {
    if (member.id === moderator.guild.members.me.id) continue;
    try {
      await member.voice.setChannel(destChannel.id, `Moved by ${moderator.user.tag}`);
      count++;
    } catch { /* skip */ }
  }
  return { ok: true, message: `Moved **${count}** member(s) to **${destChannel.name}**.` };
}

/**
 * Move ALL members from every voice channel to one destination channel.
 * @param {GuildMember} moderator
 * @param {string} destChannelId - Destination voice channel ID.
 */
async function moveAll(moderator, destChannelId) {
  if (!moderator.guild.members.me?.permissions.has(PermissionFlagsBits.MoveMembers)) {
    return { ok: false, message: 'I need **Move Members** permission.' };
  }

  const destChannel = moderator.guild.channels.cache.get(destChannelId);
  if (!destChannel || !destChannel.isVoiceBased()) {
    return { ok: false, message: 'Destination channel not found or is not a voice channel.' };
  }

  let count = 0;
  for (const [, channel] of moderator.guild.channels.cache) {
    if (!channel.isVoiceBased()) continue;
    for (const [, member] of channel.members) {
      if (member.id === moderator.guild.members.me.id) continue;
      try {
        await member.voice.setChannel(destChannel.id, `Move-all by ${moderator.user.tag}`);
        count++;
      } catch { /* skip */ }
    }
  }
  return { ok: true, message: `Moved **${count}** member(s) from all channels to **${destChannel.name}**.` };
}

/**
 * Hold ("loop") a user in a specific voice channel — the bot force-keeps
 * them there even if they try to leave or move. Prevents them from escaping.
 * @param {GuildMember} moderator
 * @param {string} targetId - The user ID to hold.
 * @param {string} destChannelId - The channel to keep them in.
 */
async function holdMember(moderator, targetId, destChannelId) {
  if (!moderator.guild.members.me?.permissions.has(PermissionFlagsBits.MoveMembers)) {
    return { ok: false, message: 'I need **Move Members** permission.' };
  }
  const target = await moderator.guild.members.fetch(targetId).catch(() => null);
  if (!target) return { ok: false, message: 'Could not find that user in this server.' };

  const destChannel = moderator.guild.channels.cache.get(destChannelId);
  if (destChannel && !destChannel.isVoiceBased()) {
    return { ok: false, message: 'That channel is not a voice channel.' };
  }

  const guildHolds = holds.get(moderator.guild.id) || {};
  guildHolds[targetId] = destChannelId;
  holds.set(moderator.guild.id, guildHolds);

  // If they're currently in voice, pin them immediately.
  if (destChannel && target.voice?.channel) {
    try {
      await target.voice.setChannel(destChannel.id, `Held by ${moderator.user.tag}`);
    } catch { /* ignore */ }
  }

  return {
    ok: true,
    message: destChannelId
      ? `Now holding **${target.user.tag}** in <#${destChannelId}>. They cannot leave this channel.`
      : `Now holding **${target.user.tag}** in their current channel. They cannot leave voice.`,
  };
}

/**
 * Release a user from being held.
 */
function releaseHold(moderator, targetId) {
  const guildHolds = holds.get(moderator.guild.id);
  if (!guildHolds?.[targetId]) {
    return { ok: false, message: 'That user is not being held.' };
  }
  delete guildHolds[targetId];
  holds.set(moderator.guild.id, guildHolds);
  return { ok: true, message: `Released <@${targetId}> from voice hold.` };
}

/**
 * List all users currently being held in the guild.
 */
function listHolds(guildId) {
  return holds.get(guildId) || {};
}

/**
 * Called from the voiceStateUpdate event. Re-pins any held users.
 * @param {import('discord.js').VoiceState} oldState
 * @param {import('discord.js').VoiceState} newState
 */
async function applyHolds(oldState, newState) {
  const guildHolds = holds.get(newState.guild?.id);
  if (!guildHolds) return;

  const heldChannelId = guildHolds[newState.member?.id];
  if (!heldChannelId) return;

  const member = newState.member;
  const inHeldChannel = newState.channelId === heldChannelId;
  const hasValidConnection = newState.channelId || newState.connectionState === 0 || newState.member?.voice?.channel;

  // If they left voice entirely, pull them back into the held channel.
  if (!newState.channelId) {
    // Give Discord a moment to confirm the leave, then force them back.
    setTimeout(async () => {
      try {
        const fresh = await newState.guild.members.fetch(member.id).catch(() => null);
        if (!fresh || holds.get(newState.guild.id)?.[member.id] !== heldChannelId) return;
        if (!fresh.voice?.channel || fresh.voice.channelId !== heldChannelId) {
          await fresh.voice.setChannel(heldChannelId, 'Held in voice by D4C');
          console.log(`[voiceControl] Re-pinned ${member.user.tag} to ${heldChannelId}`);
        }
      } catch (err) {
        console.error(`[voiceControl] Failed to re-pin held user: ${err.message}`);
      }
    }, 500);
  }
}

/**
 * List all voice channels with member counts.
 */
function listVoiceChannels(guild) {
  const list = [];
  for (const [, channel] of guild.channels.cache) {
    if (!channel.isVoiceBased()) continue;
    const members = channel.members.filter((m) => !m.user.bot).map((m) => m.user.username);
    list.push({
      id: channel.id,
      name: channel.name,
      count: channel.members.size,
      members,
    });
  }
  return list;
}

module.exports = {
  deafen,
  undeafen,
  mute,
  unmute,
  disconnect,
  move,
  moveAll,
  holdMember,
  releaseHold,
  listHolds,
  applyHolds,
  listVoiceChannels,
};
