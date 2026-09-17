// ============================================================================
// commands/music.js
// ---------------------------------------------------------------------------
// Slash-command handlers for music playback. Every response goes through the
// shared embed helper so the look is consistent with the dashboard embeds.
//
// Commands: /play, /skip, /stop, /queue
// ============================================================================

const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const music = require('../musicPlayer');
const { success, error, info, warning, musicPanel } = require('../embedHelper');

/**
 * Build the same button controls used by the !music panel so slash
 * commands and message commands look identical.
 */
function buildMusicControls() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('d4c_pause').setLabel('Pause').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('d4c_resume').setLabel('Resume').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('d4c_skip').setLabel('Next').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('d4c_loop').setLabel('Loop').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('d4c_stop').setLabel('Stop').setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('d4c_queue').setLabel('Refresh queue').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// Owner-guard helper reused by every command.
async function guardOwner(interaction) {
  const ownerAccess = require('../ownerAccess');
  if (!ownerAccess.isOwner(interaction.user.id)) {
    await interaction.reply({
      embeds: [error({ title: 'Access Denied', description: 'Only verified owners can use music commands.' })],
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

/**
 * /play <query> — search for a song or play a YouTube URL directly.
 */
async function handlePlay(interaction) {
  if (!(await guardOwner(interaction))) return;

  const query = interaction.options.getString('query');
  if (!query) {
    await interaction.reply({
      embeds: [error({ title: 'Missing Query', description: 'Provide a song name or YouTube URL.' })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const resultMsg = await music.addTrack(interaction, query);

    // addTrack returns a string when the user isn't in a voice channel.
    if (typeof resultMsg === 'string' && resultMsg.startsWith('Join a voice channel')) {
      await interaction.followUp({
        embeds: [warning({ title: 'Not in Voice', description: resultMsg })],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Successfully queued — show the music panel.
    await interaction.editReply({
      embeds: [musicPanel(music.status(interaction.guildId))],
      components: buildMusicControls(),
    });

    // Show similar songs as add/remove buttons
    try {
      const playedTitle = music.status(interaction.guildId)?.current?.title;
      const query2 = playedTitle ? music.cleanSongTitle(playedTitle) : null;
      if (query2) {
        const results = await music.search(query2);
        const suggestions = (results || []).filter((t) => t.url && t.title !== playedTitle).slice(0, 4);
        if (suggestions.length) {
          const { songSuggestions } = require('../suggestionStore');
          songSuggestions.set(interaction.guildId, suggestions);
          const { EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
          const embed = new EmbedBuilder()
            .setColor(0x3b82f6)
            .setTitle('🎯 Similar Songs You Might Like')
            .setDescription(
              `Because you played **${playedTitle}**\n\n` +
              suggestions.map((t, i) => `**${i + 1}.** [${t.title}](${t.url})`).join('\n') +
              `\n\n➕ Click a button to **add to queue** • Use the ➖ menu to **remove** queued songs`
            );
          const rows = [new ActionRowBuilder().addComponents(
            suggestions.map((t, i) => new ButtonBuilder()
              .setCustomId(`d4c_sim_${i}`)
              .setLabel((t.title || `Song ${i + 1}`).slice(0, 60))
              .setStyle(ButtonStyle.Primary)
              .setEmoji('➕'))
          )];
          const queued = music.list(interaction.guildId);
          if (queued.length) {
            rows.push(new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('d4c_qremove')
                .setPlaceholder('➖ Select a queued song to REMOVE')
                .addOptions(queued.slice(0, 25).map((t, i) => new StringSelectMenuOptionBuilder()
                  .setLabel(`${i + 1}. ${t.title.slice(0, 95)}`)
                  .setValue(t.url)))
            ));
          }
          await interaction.followUp({ embeds: [embed], components: rows });
        }
      }
    } catch (suggErr) {
      console.log(`[music:/play] suggestion skipped: ${suggErr.message}`);
    }
  } catch (err) {
    console.error(`[music:/play] Error: ${err.message}`);
    await interaction.editReply({
      embeds: [error({ title: 'Playback Error', description: `Could not add track: ${err.message}` })],
    });
  }
}

/**
 * /skip — skip the currently playing track.
 */
async function handleSkip(interaction) {
  if (!(await guardOwner(interaction))) return;
  await interaction.deferReply();

  const skipped = music.skip(interaction.guildId);
  const state = music.status(interaction.guildId);

  if (skipped && state?.current) {
    await interaction.editReply({
      embeds: [musicPanel(state)],
      components: buildMusicControls(),
    });
  } else if (skipped) {
    await interaction.editReply({
      embeds: [success({ title: 'Skipped', description: 'Track skipped. Queue is now empty.' })],
    });
  } else {
    await interaction.editReply({
      embeds: [info({ title: 'Nothing Playing', description: 'The queue is already empty.' })],
    });
  }
}

/**
 * /stop — stop playback and clear the queue.
 */
async function handleStop(interaction) {
  if (!(await guardOwner(interaction))) return;
  await interaction.deferReply();

  const wasPlaying = music.stop(interaction.guildId);

  if (wasPlaying) {
    await interaction.editReply({
      embeds: [success({ title: 'Stopped', description: 'Playback stopped and queue cleared.' })],
    });
  } else {
    await interaction.editReply({
      embeds: [info({ title: 'Nothing Playing', description: 'No active playback to stop.' })],
    });
  }
}

/**
 * /queue — show the current queue.
 */
async function handleQueue(interaction) {
  if (!(await guardOwner(interaction))) return;
  await interaction.deferReply();

  const state = music.status(interaction.guildId);
  await interaction.editReply({
    embeds: [musicPanel(state)],
    components: buildMusicControls(),
  });
}

/**
 * Autocomplete handler for /play — searches as the user types.
 */
async function handlePlayAutocomplete(interaction) {
  const focusedValue = interaction.options.getFocused();
  if (!focusedValue || focusedValue.trim().length === 0) {
    await interaction.respond([]);
    return;
  }
  try {
    const results = await music.search(focusedValue);
    const choices = (results || []).slice(0, 10).map((track) => ({
      name: `${track.title.slice(0, 80)} (${track.duration || 'Video'})`,
      value: track.url,
    }));
    await interaction.respond(choices);
  } catch {
    await interaction.respond([]);
  }
}

module.exports = {
  handlePlay,
  handleSkip,
  handleStop,
  handleQueue,
  handlePlayAutocomplete,
};
