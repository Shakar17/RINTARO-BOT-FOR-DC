// ============================================================================
// welcomeSystem.js
// ---------------------------------------------------------------------------
// Welcome and leave messages with customizable embeds. Server-specific
// settings persisted to data/welcome.json.
//
// Placeholders in message templates:
//   {user}      → @mention
//   {username}  → username without mention
//   {server}    → server name
//   {count}     → member count
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');

const DATA_FILE = path.resolve('data', 'welcome.json');

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
      welcomeEnabled: false,
      welcomeChannelId: null,
      welcomeMessage: 'Welcome to **{server}**, {user}! 🎉',
      welcomeEmbed: true,
      leaveEnabled: false,
      leaveChannelId: null,
      leaveMessage: '**{username}** has left the server. 👋',
      leaveEmbed: true,
    };
  }
  return config[guildId];
}

function setWelcomeChannel(guildId, channelId) {
  const c = getGuildConfig(guildId);
  c.welcomeChannelId = channelId;
  c.welcomeEnabled = !!channelId;
  save();
}

function setWelcomeMessage(guildId, message) {
  const c = getGuildConfig(guildId);
  c.welcomeMessage = message;
  save();
}

function setLeaveChannel(guildId, channelId) {
  const c = getGuildConfig(guildId);
  c.leaveChannelId = channelId;
  c.leaveEnabled = !!channelId;
  save();
}

function setLeaveMessage(guildId, message) {
  const c = getGuildConfig(guildId);
  c.leaveMessage = message;
  save();
}

/**
 * Replace placeholders in a template string.
 */
function fillTemplate(template, member) {
  return template
    .replace(/\{user\}/g, `<@${member.id}>`)
    .replace(/\{username\}/g, member.user.username)
    .replace(/\{server\}/g, member.guild.name)
    .replace(/\{count\}/g, member.guild.memberCount.toLocaleString());
}

/**
 * Build and send the welcome message for a new member.
 */
async function sendWelcome(member) {
  const c = getGuildConfig(member.guild.id);
  if (!c.welcomeEnabled || !c.welcomeChannelId) return;

  const channel = member.guild.channels.cache.get(c.welcomeChannelId);
  if (!channel?.isTextBased()) return;

  const text = fillTemplate(c.welcomeMessage, member);

  try {
    if (c.welcomeEmbed) {
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('New Member!')
        .setDescription(text)
        .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
        .setTimestamp()
        .setFooter({ text: `${member.guild.name} • Member #${member.guild.memberCount}` });
      await channel.send({ embeds: [embed] });
    } else {
      await channel.send(text);
    }
  } catch (err) {
    console.error(`[welcome] Failed to send welcome: ${err.message}`);
  }
}

/**
 * Build and send the leave message for a departing member.
 */
async function sendLeave(member) {
  const c = getGuildConfig(member.guild.id);
  if (!c.leaveEnabled || !c.leaveChannelId) return;

  const channel = member.guild.channels.cache.get(c.leaveChannelId);
  if (!channel?.isTextBased()) return;

  const text = fillTemplate(c.leaveMessage, member);

  try {
    if (c.leaveEmbed) {
      const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('Member Left')
        .setDescription(text)
        .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
        .setTimestamp()
        .setFooter({ text: `${member.guild.name} • ${member.guild.memberCount} members` });
      await channel.send({ embeds: [embed] });
    } else {
      await channel.send(text);
    }
  } catch (err) {
    console.error(`[welcome] Failed to send leave message: ${err.message}`);
  }
}

module.exports = {
  getGuildConfig,
  setWelcomeChannel,
  setWelcomeMessage,
  setLeaveChannel,
  setLeaveMessage,
  sendWelcome,
  sendLeave,
};
