// ============================================================================
// embedHelper.js
// ---------------------------------------------------------------------------
// Shared embed styling for the entire bot. Both the music slash commands
// (Part 2) and the dashboard-sent embeds (Part 1) use this helper so every
// message the bot sends looks consistent: same color palette, same footer,
// same layout.
//
// Usage:
//   const { embed, success, error, info, warning, musicPanel } = require('./embedHelper');
//   await channel.send({ embeds: [success({ title: 'Done', description: 'All good.' })] });
// ============================================================================

const { EmbedBuilder } = require('discord.js');

// Brand color palette — tweak these once to restyle the whole bot.
const COLORS = {
  success: 0x57f287, // Discord green
  error: 0xed4245,   // Discord red
  info: 0x5865f2,    // Discord blurple
  warning: 0xfee75c, // Discord yellow
  music: 0xe11d48,   // D4C radio red (matches existing music panel)
  musicPaused: 0xf59e0b, // amber for paused state
};

// Bot branding shown in every footer.
const BOT_NAME = 'D4C Bot';
const BOT_ICON = null; // Set to a CDN URL if you want a footer icon image.

/**
 * Base embed factory. Returns a pre-styled EmbedBuilder.
 * @param {object} options
 * @param {keyof COLORS} options.type  - Color category (success/error/info/warning/music).
 * @param {string} options.title      - Embed title (max 256 chars).
 * @param {string} [options.description] - Embed description.
 * @param {Array<{name: string, value: string, inline?: boolean}>} [options.fields] - Embed fields.
 * @param {string} [options.image]    - Image URL for the main embed image.
 * @param {string} [options.thumbnail] - Thumbnail URL.
 * @param {string} [options.footer]   - Override footer text (bot name used by default).
 * @param {string} [options.url]      - Make the title a clickable link.
 * @param {Date}   [options.timestamp] - Timestamp (defaults to now).
 */
function embed({
  type = 'info',
  title,
  description = '',
  fields = [],
  image = null,
  thumbnail = null,
  footer = null,
  url = null,
  timestamp = new Date(),
}) {
  const builder = new EmbedBuilder()
    .setColor(COLORS[type] ?? COLORS.info)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp(timestamp)
    .setFooter({
      text: footer ?? BOT_NAME,
      iconURL: BOT_ICON,
    });

  if (url) builder.setURL(url);
  if (thumbnail) builder.setThumbnail(thumbnail);
  if (image) builder.setImage(image);
  if (fields.length > 0) builder.addFields(fields);

  return builder;
}

// ----- Convenience wrappers -----

/** Success embed (green). */
function success({ title, description, fields, image, thumbnail, footer, url }) {
  return embed({ type: 'success', title, description, fields, image, thumbnail, footer, url });
}

/** Error embed (red). */
function error({ title, description, fields, image, thumbnail, footer, url }) {
  return embed({ type: 'error', title, description, fields, image, thumbnail, footer, url });
}

/** Info embed (blurple). */
function info({ title, description, fields, image, thumbnail, footer, url }) {
  return embed({ type: 'info', title, description, fields, image, thumbnail, footer, url });
}

/** Warning embed (yellow). */
function warning({ title, description, fields, image, thumbnail, footer, url }) {
  return embed({ type: 'warning', title, description, fields, image, thumbnail, footer, url });
}

/**
 * Music panel embed — mirrors the existing musicEmbed() style in index.js
 * so the slash-command responses look identical to the button-panel ones.
 * @param {object} state  - The object returned by music.status(guildId).
 */
function musicPanel(state) {
  const current = state?.current;
  const upcoming = state?.tracks?.slice(0, 5) ?? [];
  const statusLabel = state?.paused ? 'PAUSED' : current ? 'PLAYING NOW' : 'IDLE';

  const queueText = upcoming.length
    ? upcoming.map((track, index) => `${index + 1}. [${track.title}](${track.url})`).join('\n')
    : 'Queue is empty. Use `/play <song>` to add a track.';

  return embed({
    type: state?.paused ? 'warning' : current ? 'music' : 'info',
    title: 'D4C RADIO  /  MUSIC PLAYER',
    description: `**${statusLabel}**\n${current ? `[${current.title}](${current.url})` : 'Nothing is playing right now.'}`,
    fields: [
      { name: 'UP NEXT', value: queueText },
      {
        name: 'PLAYER',
        value: `Volume **${state?.volume ?? 100}%**  |  Loop **${state?.loop ? 'ON' : 'OFF'}**  |  ${upcoming.length} queued`,
      },
    ],
  });
}

module.exports = { embed, success, error, info, warning, musicPanel, COLORS };
