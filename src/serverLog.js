// ============================================================================
// serverLog.js
// ---------------------------------------------------------------------------
// Server event logging — sends formatted embeds to a designated log channel
//   when events occur. Server-specific settings persisted to data/serverLog.json.
//
// Events tracked:
//   - messageDelete, messageUpdate (edited messages)
//   - voiceStateUpdate (join/leave/move/deafen/mute)
//   - memberJoin, memberLeave
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');

const DATA_FILE = path.resolve('data', 'serverLog.json');

let config = load();

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 2));
}

function getGuildConfig(guildId) {
  if (!config[guildId]) {
    config[guildId] = {
      logChannelId: null,
      logMessageDelete: true,
      logMessageEdit: true,
      logVoice: true,
      logJoins: true,
    };
  }
  return config[guildId];
}

function setLogChannel(guildId, channelId) {
  const c = getGuildConfig(guildId);
  c.logChannelId = channelId;
  save();
}

/**
 * Send a log embed to the guild's log channel.
 */
async function logEmbed(guildId, embed) {
  const c = config[guildId];
  if (!c?.logChannelId) return;

  // Need to fetch the channel — called from event handlers where we have guild
  // The guild object is passed by the caller
}

/**
 * Log a deleted message.
 */
async function logMessageDelete(message, logChannel) {
  if (!logChannel || !message.content) return;
  const config = getGuildConfig(message.guild.id);
  if (!config.logMessageDelete) return;

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('🗑️ Message Deleted')
    .setDescription(`**Author:** <@${message.author?.id || 'Unknown'}>\n**Channel:** <#${message.channel.id}>\n**Content:**\n${message.content.slice(0, 1000)}`)
    .setTimestamp()
    .setFooter({ text: `User ID: ${message.author?.id || 'Unknown'}` });

  try {
    await logChannel.send({ embeds: [embed] });
  } catch { /* ignore */ }
}

/**
 * Log an edited message.
 */
async function logMessageEdit(oldMessage, newMessage, logChannel) {
  if (!logChannel) return;
  const config = getGuildConfig(newMessage.guild.id);
  if (!config.logMessageEdit) return;

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('✏️ Message Edited')
    .setDescription(
      `**Author:** <@${newMessage.author?.id || 'Unknown'}>\n` +
      `**Channel:** <#${newMessage.channel.id}>\n` +
      `[Jump to Message](${newMessage.url})\n\n` +
      `**Before:**\n${(oldMessage.content || '*empty*').slice(0, 500)}\n\n` +
      `**After:**\n${(newMessage.content || '*empty*').slice(0, 500)}`,
    )
    .setTimestamp()
    .setFooter({ text: `User ID: ${newMessage.author?.id || 'Unknown'}` });

  try {
    await logChannel.send({ embeds: [embed] });
  } catch { /* ignore */ }
}

/**
 * Log voice state changes (join/leave/move).
 */
async function logVoiceState(oldState, newState, logChannel) {
  if (!logChannel) return;
  const config = getGuildConfig(newState.guild.id);
  if (!config.logVoice) return;

  const member = newState.member;
  let title, description, color;

  if (!oldState.channelId && newState.channelId) {
    // Joined voice
    title = '🔊 Voice Joined';
    description = `**${member.user.tag}** joined <#${newState.channelId}>`;
    color = 0x57f287;
  } else if (oldState.channelId && !newState.channelId) {
    // Left voice
    title = '🔇 Voice Left';
    description = `**${member.user.tag}** left <#${oldState.channelId}>`;
    color = 0xed4245;
  } else if (oldState.channelId !== newState.channelId) {
    // Moved channels
    title = '🔄 Voice Moved';
    description = `**${member.user.tag}** moved from <#${oldState.channelId}> to <#${newState.channelId}>`;
    color = 0xfee75c;
  } else if (oldState.deaf !== newState.deaf) {
    title = newState.deaf ? '🔇 Server Deafened' : '🔊 Server Undeafened';
    description = `**${member.user.tag}** was ${newState.deaf ? 'deafened' : 'undeafened'} in <#${newState.channelId}>`;
    color = 0xfee75c;
  } else if (oldState.mute !== newState.mute) {
    title = newState.mute ? '🔇 Server Muted' : '🔊 Server Unmuted';
    description = `**${member.user.tag}** was ${newState.mute ? 'muted' : 'unmuted'} in <#${newState.channelId}>`;
    color = 0xfee75c;
  } else {
    return; // No significant change
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp()
    .setThumbnail(member.user.displayAvatarURL({ size: 64 }));

  try {
    await logChannel.send({ embeds: [embed] });
  } catch { /* ignore */ }
}

/**
 * Get the log channel for a guild (returns null if not configured).
 */
function getLogChannel(guild) {
  const c = config[guild.id];
  if (!c?.logChannelId) return null;
  return guild.channels.cache.get(c.logChannelId) || null;
}

module.exports = {
  getGuildConfig,
  setLogChannel,
  logMessageDelete,
  logMessageEdit,
  logVoiceState,
  getLogChannel,
};
