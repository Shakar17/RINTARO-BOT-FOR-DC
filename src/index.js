require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, GatewayIntentBits, MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { handleAnnouncement } = require('./commands/ann');
const { handlePlay, handleSkip, handleStop, handleQueue, handlePlayAutocomplete } = require('./commands/music');
const { createDashboard } = require('./dashboard');
const music = require('./musicPlayer');
const recorder = require('./recorder');
const ownerAccess = require('./ownerAccess');
const broadcast = require('./broadcast');
const voiceControl = require('./voiceControl');
const reactionRoles = require('./reactionRoles');
const autoMod = require('./autoMod');
const welcomeSystem = require('./welcomeSystem');
const giveaway = require('./giveaway');
const serverLog = require('./serverLog');
const ticketSystem = require('./ticketSystem');
const moderation = require('./moderation');
const customCommands = require('./customCommands');
const audioEffects = require('./audioEffects');
const verification = require('./verification');
const { success, error, info, warning } = require('./embedHelper');

const pidFile = path.resolve('data', 'bot.pid');
fs.mkdirSync(path.dirname(pidFile), { recursive: true });
if (fs.existsSync(pidFile)) {
  const previousPid = Number(fs.readFileSync(pidFile, 'utf8'));
  if (previousPid && previousPid !== process.pid) {
    try {
      process.kill(previousPid, 0);
      throw new Error(`Another bot process is already running (PID ${previousPid}). Stop it before starting another instance.`);
    } catch (error) {
      if (error.message.startsWith('Another bot process')) throw error;
    }
  }
}
fs.writeFileSync(pidFile, String(process.pid));
const releasePidFile = () => {
  if (fs.existsSync(pidFile) && Number(fs.readFileSync(pidFile, 'utf8')) === process.pid) fs.unlinkSync(pidFile);
};
process.on('exit', releasePidFile);

function musicControls() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('d4c_pause').setLabel('Pause').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('d4c_resume').setLabel('Resume').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('d4c_skip').setLabel('Next').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('d4c_loop').setLabel('Loop').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('d4c_stop').setLabel('Stop').setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('d4c_queue').setLabel('Refresh queue').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function musicEmbed(guildId) {
  const state = music.status(guildId);
  const current = state?.current;
  const upcoming = state?.tracks?.slice(0, 5) ?? [];
  const status = state?.paused ? 'PAUSED' : current ? 'PLAYING NOW' : 'IDLE';
  const queueText = upcoming.length
    ? upcoming.map((track, index) => `${index + 1}. [${track.title}](${track.url})`).join('\n')
    : 'Queue is empty. Use `!play <YouTube URL>` to add a song.';
  const embed = new EmbedBuilder()
    .setColor(state?.paused ? 0xf59e0b : 0xe11d48)
    .setTitle('D4C RADIO  /  MUSIC PLAYER')
    .setDescription(`**${status}**\n${current ? `[${current.title}](${current.url})` : 'Nothing is playing right now.'}`)
    .addFields(
      { name: 'UP NEXT', value: queueText },
      { name: 'PLAYER', value: `Volume **${state?.volume ?? 100}%**  |  Loop **${state?.loop ? 'ON' : 'OFF'}**  |  ${upcoming.length} queued`, inline: false }
    )
    .setFooter({ text: 'D4C • Use !music anytime to reopen this panel' });
  if (current?.thumbnail) embed.setThumbnail(current.thumbnail);
  return embed;
}

const rawToken = process.env.DISCORD_TOKEN || process.env.TOKEN || process.env.TOKEN1 || process.env.TOKENS;
if (!rawToken) {
  throw new Error('DISCORD_TOKEN is missing. Copy .env.example to .env and add your bot token.');
}
const token = rawToken.trim().replace(/^["']|["']$/g, '');
console.log(`Token loaded (length: ${token.length}, prefix: ${token.substring(0, 12)}...)`);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
  ]
});

// ---------------------------------------------------------------------------
// Web server — Express dashboard (Part 1) + health probe.
// The dashboard serves the embed-builder frontend and exposes the
// send-embed API. It is protected by the DASHBOARD_KEY env var.
// ---------------------------------------------------------------------------
const dashboard = createDashboard(client);
const port = Number(process.env.PORT) || 10000;
dashboard.listen(port, '0.0.0.0', () => {
  console.log(`Dashboard + health server listening on port ${port}`);
  if (!process.env.DASHBOARD_KEY) {
    console.warn('[dashboard] DASHBOARD_KEY is not set — the dashboard API is disabled.');
  }
});

client.once('clientReady', async (readyClient) => {
  console.log(`D4C online as ${readyClient.user.tag}`);
  try {
    const commands = [
      {
        name: 'play',
        description: 'Play any song from YouTube with live typing suggestions',
        options: [
          {
            name: 'query',
            description: 'Song title or YouTube URL',
            type: 3, // STRING
            required: true,
            autocomplete: true
          }
        ]
      }
    ];
    await readyClient.application?.commands.set(commands);
    console.log('Slash command /play with live autocomplete registered successfully!');
  } catch (err) {
    console.error('Slash command registration error:', err.message);
  }
});

client.on('shardError', (error) => console.error('Discord WebSocket shard error:', error));
client.on('debug', (info) => {
  if (info.includes('Connect') || info.includes('Heartbeat') || info.includes('40') || info.includes('token') || info.includes('WS')) {
    console.log('[Discord Debug]', info);
  }
});
client.on('error', (error) => console.error('Discord client error:', error));
process.on('unhandledRejection', (error) => console.error('Unhandled promise rejection:', error));

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith('!')) return;

  const [command, ...args] = message.content.trim().split(/\s+/);
  const content = args.join(' ').trim();
  const commandName = command.toLowerCase();

  try {
    if (commandName === '!addowner') {
      const result = await ownerAccess.addOwner(message, content);
      await message.reply(result.message);
      return;
    }

    if (commandName === '!removeowner') {
      const result = ownerAccess.removeOwner(message, content);
      await message.reply(result.message);
      return;
    }

    if (commandName === '!owners') {
      if (!ownerAccess.canManageOwners(message)) {
        await message.reply('Only a verified owner or server Administrator can view owners.');
        return;
      }
      await message.reply(`Verified owners: ${ownerAccess.ownerIds().map((id) => `<@${id}>`).join(', ') || 'None configured.'}`);
      return;
    }

    if (commandName === '!ann') {
      if (!ownerAccess.isOwner(message.author.id)) return;
      await handleAnnouncement(message, content);
      return;
    }

    if (!ownerAccess.isOwner(message.author.id)) {
      await message.reply('This bot is owner-only. Ask a server Administrator to verify you with `!addowner <your Discord user ID>`.');
      return;
    }

    if (commandName === '!sendall') {
      const progressMessage = await message.reply('DM broadcast started. Sending to server members...');
      const result = await broadcast.sendToAllMembers(message, content, async ({ sent, failed, total }) => {
        await progressMessage.edit(`DM broadcast in progress... Sent: ${sent}/${total} | Failed: ${failed}`);
      });
      await progressMessage.edit(result.message);
      return;
    }

    // ========================================================================
    // VERIFICATION SYSTEM — verify channel + human-check gate
    // ========================================================================
    if (commandName === '!setverify') {
      const channelId = args[0]?.replace(/[<#>]/g, '');
      const channel = channelId && message.guild.channels.cache.get(channelId);
      if (!channel) {
        await message.reply('Usage: `!setverify <#verify-channel>` — the only channel unverified users can see.');
        return;
      }
      verification.setVerifyChannel(message.guild.id, channel.id);
      await message.reply(`✅ Verification channel set to <#${channel.id}>. Post the panel there with \`!verify-panel\`.`);
      return;
    }

    if (commandName === '!verifylock') {
      // Locks @everyone out of every channel EXCEPT the verify channel.
      // New members then see only #verify until they pass verification.
      const cfg = verification.getConfig(message.guild.id);
      if (!cfg.verifyChannelId) {
        await message.reply('⚠️ Set the verify channel first: `!setverify <#channel>` — that channel stays visible to everyone.');
        return;
      }
      const status = await message.reply('🔒 Locking all channels for @everyone except the verify channel...');
      const result = await verification.lockEveryone(message.guild, cfg.verifyChannelId);
      let text = `✅ Done — **${result.locked}** channel(s) locked for @everyone. New members now see only <#${cfg.verifyChannelId}> until they verify.`;
      if (result.failed > 0) {
        text += `\n⚠️ ${result.failed} could not be locked (missing permissions).`;
      }
      await status.edit(text);
      return;
    }

    if (commandName === '!verify-panel') {
      const result = await verification.createPanel(message);
      await message.reply(result);
      return;
    }

    if (['!join', '!connect'].includes(commandName)) {
      await message.reply(await music.connect(message));
      return;
    }

    if (['!leave', '!disconnect'].includes(commandName)) {
      await message.reply(music.leave(message.guild.id) ? 'Disconnected and cleared the music queue.' : 'The bot is not connected.');
      return;
    }

    if (['!play', '!search'].includes(commandName)) {
      if (!content) {
        const guideEmbed = new EmbedBuilder()
          .setColor(0xe11d48)
          .setTitle('🎵 D4C Interactive Music Search & Player')
          .setDescription('Type `!play <song name>` or `!play <YouTube URL>` to play music!\n\n**Examples:**\n• `!play master vaathi coming`\n• `!play https://www.youtube.com/watch?v=7SJ0G_NeDuE`\n\nWhen you search by song name, a dropdown selection menu will appear so you can pick your exact track!');
        await message.reply({ embeds: [guideEmbed] });
        return;
      }

      const isUrl = /^https?:\/\//i.test(content.trim());
      if (isUrl) {
        const resultMsg = await music.addTrack(message, content.trim());
        if (typeof resultMsg === 'string' && resultMsg.startsWith('Join a voice channel')) {
          await message.reply(resultMsg);
          return;
        }
        await message.reply({ embeds: [musicEmbed(message.guild.id)], components: musicControls() });
        // Show similar songs as add/remove buttons
        await sendRelatedSongs(message, music.status(message.guild.id)?.current?.title);
        return;
      }

      const searchStatusMsg = await message.reply(`🔍 Searching YouTube for: **${content}**...`);
      let results = [];
      try {
        results = await music.search(content);
      } catch (searchError) {
        console.error(`[search] YouTube search error: ${searchError.message}`);
      }

      if (!results || results.length === 0) {
        await searchStatusMsg.edit(`❌ No songs found on YouTube for: "${content}". Please try another search term or paste a direct YouTube URL.`);
        return;
      }

      const topResults = results.slice(0, 5);
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('d4c_select_song')
        .setPlaceholder('🎵 Select a song from search results...')
        .addOptions(
          topResults.map((track, idx) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`${idx + 1}. ${track.title.slice(0, 95)}`)
              .setDescription(track.duration ? `Duration: ${track.duration}` : 'YouTube Video')
              .setValue(track.url)
          )
        );

      const menuRow = new ActionRowBuilder().addComponents(selectMenu);
      const searchEmbed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle(`🔍 YouTube Search Results for: "${content}"`)
        .setDescription(
          topResults.map((r, i) => `**${i + 1}.** [${r.title}](${r.url}) (${r.duration || 'Video'})`).join('\n') +
          '\n\n👇 **Select your song from the dropdown menu below to play:**'
        );

      await searchStatusMsg.edit({
        content: null,
        embeds: [searchEmbed],
        components: [menuRow]
      });
      return;
    }

    if (['!music', '!panel', '!player'].includes(commandName)) {
      await message.reply({ embeds: [musicEmbed(message.guild.id)], components: musicControls() });
      return;
    }

    if (commandName === '!skip') {
      await message.reply(music.skip(message.guild.id) ? 'Skipped.' : 'Nothing is playing.');
      return;
    }

    if (commandName === '!pause') {
      await message.reply(music.pause(message.guild.id) ? 'Paused.' : 'Nothing is playing.');
      return;
    }

    if (commandName === '!resume') {
      await message.reply(music.resume(message.guild.id) ? 'Resumed.' : 'Nothing is paused.');
      return;
    }

    if (commandName === '!now') {
      await message.reply({ embeds: [musicEmbed(message.guild.id)], components: musicControls() });
      return;
    }

    if (commandName === '!loop') {
      const enabled = !['off', 'false', '0'].includes(content.toLowerCase());
      await message.reply(`Loop ${music.setLoop(message.guild.id, enabled) ? 'enabled' : 'disabled'}.`);
      return;
    }

    if (commandName === '!volume') {
      const value = Number(content);
      if (!Number.isFinite(value) || value < 0 || value > 200) return message.reply('Usage: `!volume <0-200>`');
      await message.reply(`Volume set to ${music.setVolume(message.guild.id, value)}%.`);
      return;
    }

    // !autoplay            → enable related-track autoplay
    // !autoplay <mood>     → endless mood radio (tamil, sad, happy, or ANY custom word)
    // !autoplay off        → disable mood autoplay
    if (commandName === '!autoplay') {
      const arg = (content || '').trim().toLowerCase();
      if (!arg || arg === 'on') {
        music.setAutoplayMood(message.guild.id, null);
        await message.reply(
          `♾️ Autoplay **enabled** — the bot keeps playing related tracks after each song.\n` +
          `For endless mood radio, try: ${music.listMoods().map((m) => `\`${m}\``).join(', ')}\n` +
          `Example: \`!autoplay tamil\` — any custom word works too (e.g. \`!autoplay vibecifi\`).`
        );
        return;
      }
      if (arg === 'off') {
        music.setAutoplayMood(message.guild.id, null);
        await message.reply('⏹️ Mood autoplay disabled. Playback stops when the queue is empty.');
        return;
      }
      await message.reply(`🔎 Setting up **${arg}** mood radio — searching tracks and connecting to voice...`);
      const result = await music.startMoodAutoplay(message, arg);
      await message.reply(result);
      return;
    }

    if (commandName === '!247') {
      await message.reply('The bot stays online while its hosting process is running. Use PM2, Docker, Railway, Render, or a VPS for 24/7 uptime.');
      return;
    }

    if (commandName === '!stop') {
      await message.reply(music.stop(message.guild.id) ? 'Audio stopped. Voice channel stays connected.' : 'Nothing is playing.');
      return;
    }

    if (commandName === '!queue') {
      const tracks = music.list(message.guild.id);
      await message.reply(tracks.length ? tracks.map((track, index) => `${index + 1}. ${track.title}`).join('\n') : 'The queue is empty.');
      return;
    }

    if (commandName === '!record') {
      const result = recorder.startRecording(message);
      await message.reply(result.message);
      return;
    }

    if (commandName === '!stoprecord') {
      const filePath = recorder.stopRecording(message.guild.id);
      await message.reply(filePath ? `Recording saved: \`${filePath}\`` : 'There is no active recording.');
      return;
    }

    if (commandName === '!help') {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xe11d48).setTitle('D4C Command Center').setDescription('**Owner:** `!addowner <ID>` | `!removeowner <ID>` | `!owners` | `!sendall <message>`\n\n**Voice:** `!join` / `!connect` | `!leave` / `!disconnect`\n\n**Music:** `!ann <content>` | `!play <song/URL>` | `!search <song>` | `!queue` | `!now` | `!pause` | `!resume` | `!skip` | `!stop` | `!loop on/off` | `!volume 0-200` | `!autoplay <mood>` (tamil, sad, happy, lofi, party, romantic, gym, kpop... or any custom word)\n\n**Voice Control:** `!deafen [@user]` | `!undeafen [@user]` | `!vmute [@user]` | `!vunmute [@user]` | `!dc [@user]` | `!move <target> <channel>` | `!moveall <channelID>` | `!vclist` | `!vchold <@user> [channelID]` | `!vcrelease <@user>` | `!vcholds`\n\n**Audio FX:** `!sfx <sound>` | `!sounds` | `!tts <text>` | `!tts-hi <text>` | `!vcleave`\n\n**Moderation:** `!ban <@user>` | `!kick <@user>` | `!timeout <@user> <duration>` | `!purge <amount>` | `!warn <@user>`\n\n**Giveaways:** `!gstart <duration> <winners> <prize>` | `!greroll <msgID>` | `!gend <msgID>`\n\n**Utility:** `!rr-add <msgID> <emoji> <roleID>` | `!rr-list` | `!setwelcome <#ch>` | `!welcomemsg <text>` | `!setleave <#ch>` | `!setlog <#ch>` | `!ticket-panel` | `!close` | `!cmd-add <name> <response>` | `!cmd-list`\n\n**Verification:** `!setverify <#ch>` | `!verifylock` | `!verify-panel` (no role assigned — @everyone is locked out, clicking ✅ Verify + passing the check makes them a member)')], components: musicControls() });
    }

    // ========================================================================
    // VOICE CONTROLS — deafen, mute, unmute, disconnect, move
    // ========================================================================
    if (['!deafen', '!vc-deafen'].includes(commandName)) {
      const targetId = args[0]?.replace(/[<@!>]/g, '') || null;
      const result = await voiceControl.deafen(message.member, targetId);
      await message.reply({ embeds: [result.ok ? success({ title: '🔇 Deafened', description: result.message }) : error({ title: 'Cannot Deafen', description: result.message })] });
      return;
    }

    if (['!undeafen', '!vc-undeafen'].includes(commandName)) {
      const targetId = args[0]?.replace(/[<@!>]/g, '') || null;
      const result = await voiceControl.undeafen(message.member, targetId);
      await message.reply({ embeds: [result.ok ? success({ title: '🔊 Undeafened', description: result.message }) : error({ title: 'Cannot Undeafen', description: result.message })] });
      return;
    }

    if (['!vmute', '!vc-mute'].includes(commandName)) {
      const targetId = args[0]?.replace(/[<@!>]/g, '') || null;
      const result = await voiceControl.mute(message.member, targetId);
      await message.reply({ embeds: [result.ok ? success({ title: '🔇 Muted', description: result.message }) : error({ title: 'Cannot Mute', description: result.message })] });
      return;
    }

    if (['!vunmute', '!vc-unmute'].includes(commandName)) {
      const targetId = args[0]?.replace(/[<@!>]/g, '') || null;
      const result = await voiceControl.unmute(message.member, targetId);
      await message.reply({ embeds: [result.ok ? success({ title: '🔊 Unmuted', description: result.message }) : error({ title: 'Cannot Unmute', description: result.message })] });
      return;
    }

    if (['!dc', '!vcdisconnect', '!vc-kick'].includes(commandName)) {
      const targetId = args[0]?.replace(/[<@!>]/g, '') || null;
      const result = await voiceControl.disconnect(message.member, targetId);
      await message.reply({ embeds: [result.ok ? success({ title: '👢 Disconnected', description: result.message }) : error({ title: 'Cannot Disconnect', description: result.message })] });
      return;
    }

    if (commandName === '!move') {
      const [targetId, channelId] = args;
      if (!channelId) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!move <@user/voice-channel-id> <destination-channel-id>`\nOr `!move all <channel-id>` to move everyone.' })] });
        return;
      }
      const cleanChannelId = channelId.replace(/[<#>]/g, '');
      const cleanTargetId = targetId?.toLowerCase() === 'all' ? null : targetId?.replace(/[<@!>]/g, '');
      const result = await voiceControl.move(message.member, cleanChannelId, cleanTargetId);
      await message.reply({ embeds: [result.ok ? success({ title: '🔄 Moved', description: result.message }) : error({ title: 'Cannot Move', description: result.message })] });
      return;
    }

    // ----- Move ALL members to one channel -----
    if (commandName === '!moveall') {
      const channelId = args[0]?.replace(/[<#>]/g, '');
      if (!channelId) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!moveall <voice-channel-id>` — moves everyone in every voice channel to that channel.' })] });
        return;
      }
      const result = await voiceControl.moveAll(message.member, channelId);
      await message.reply({ embeds: [result.ok ? success({ title: '🧲 Move All', description: result.message }) : error({ title: 'Cannot Move All', description: result.message })] });
      return;
    }

    // ----- List voice channels with member counts -----
    if (commandName === '!vclist') {
      const channels = voiceControl.listVoiceChannels(message.guild);
      if (channels.length === 0) {
        await message.reply({ embeds: [warning({ title: 'No Voice Channels', description: 'There are no voice channels in this server.' })] });
        return;
      }
      const lines = channels.map((c) => `**${c.name}** (\`${c.id}\`) — ${c.count} user(s)${c.members.length ? '\n  └ ' + c.members.slice(0, 10).join(', ') : ''}`);
      await message.reply({ embeds: [info({ title: 'Voice Channels', description: lines.slice(0, 15).join('\n') })] });
      return;
    }

    // ----- Hold/loop a user in a voice channel (they cannot leave) -----
    if (commandName === '!vchold') {
      const [targetArg, chanArg] = args;
      if (!targetArg) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!vchold <@user> [voice-channel-id]` — force-keeps user in voice.\nOmit channel to hold them in their current channel.' })] });
        return;
      }
      const targetId = targetArg.replace(/[<@!>]/g, '');
      const destChannelId = chanArg ? chanArg.replace(/[<#>]/g, '') : '';
      const result = await voiceControl.holdMember(message.member, targetId, destChannelId || null);
      await message.reply({ embeds: [result.ok ? success({ title: '🔗 Voice Hold', description: result.message }) : error({ title: 'Cannot Hold', description: result.message })] });
      return;
    }

    // ----- Release a held user -----
    if (commandName === '!vcrelease') {
      const targetArg = args[0];
      if (!targetArg) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!vcrelease <@user>`' })] });
        return;
      }
      const targetId = targetArg.replace(/[<@!>]/g, '');
      const result = voiceControl.releaseHold(message.member, targetId);
      await message.reply({ embeds: [result.ok ? success({ title: '🔓 Released', description: result.message }) : error({ title: 'Not Held', description: result.message })] });
      return;
    }

    // ----- List held users -----
    if (commandName === '!vcholds') {
      const holdsList = voiceControl.listHolds(message.guild.id);
      const entries = Object.entries(holdsList);
      if (entries.length === 0) {
        await message.reply({ embeds: [warning({ title: 'No Holds', description: 'No users are currently held in voice.' })] });
        return;
      }
      const lines = entries.map(([userId, chanId]) => `<@${userId}> → <#${chanId}>`);
      await message.reply({ embeds: [info({ title: 'Voice Holds', description: lines.join('\n') })] });
      return;
    }

    // ========================================================================
    // AUDIO EFFECTS — soundboard + TTS
    // ========================================================================
    if (commandName === '!sounds') {
      const sounds = audioEffects.listSounds();
      const desc = sounds.map((s) => `**${s.name}** — ${s.desc}`).join('\n');
      await message.reply({ embeds: [info({ title: '🔊 Soundboard', description: `${desc}\n\nPlay with \`!sfx <name>\`` })] });
      return;
    }

    if (commandName === '!sfx') {
      const soundName = args[0]?.toLowerCase();
      const channel = message.member?.voice?.channel;
      if (!soundName) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!sfx <sound>` — join a voice channel first.\nUse `!sounds` to list effects.' })] });
        return;
      }
      if (!channel) {
        await message.reply({ embeds: [error({ title: 'Not in Voice', description: 'Join a voice channel first, then use `!sfx <sound>`.' })] });
        return;
      }
      const result = await audioEffects.playSound({ guild: message.guild, channelId: channel.id, adapterCreator: message.guild.voiceAdapterCreator, soundName });
      await message.reply({ embeds: [result.ok ? success({ title: '🔊 Sound Effect', description: result.message }) : error({ title: 'Sound Error', description: result.message })] });
      return;
    }

    if (/^!tts(-\w+)?$/.test(commandName)) {
      const channel = message.member?.voice?.channel;
      const text = args.join(' ');
      if (!text) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!tts <text>` — speaks text in your voice channel.\nLanguages: `!tts-en <text>`, `!tts-hi`, `!tts-ta`, `!tts-es`, etc.' })] });
        return;
      }
      if (!channel) {
        await message.reply({ embeds: [error({ title: 'Not in Voice', description: 'Join a voice channel first, then use `!tts <text>`.' })] });
        return;
      }
      const lang = commandName.split('-')[1] || 'en';
      const result = await audioEffects.playTTS({ guild: message.guild, channelId: channel.id, adapter: message.guild.voiceAdapterCreator, text, lang });
      await message.reply({ embeds: [result.ok ? success({ title: '🗣️ TTS', description: result.message }) : error({ title: 'TTS Error', description: result.message })] });
      return;
    }

    if (commandName === '!vcleave') {
      const left = audioEffects.leaveVoice(message.guild.id);
      await message.reply({ embeds: [left ? success({ title: '👋 Left Voice', description: 'Disconnected the audio effect bot from voice.' }) : info({ title: 'Not Connected', description: 'No audio effect bot in voice.' })] });
      return;
    }

    // ========================================================================
    // REACTION ROLES & AUTO-MOD
    // ========================================================================
    if (commandName === '!rr-add') {
      const [msgId, emoji, roleId] = args;
      const result = reactionRoles.addBinding(msgId, emoji, roleId);
      await message.reply({ embeds: [result.ok ? success({ title: 'Reaction Role Added', description: result.message }) : error({ title: 'Failed', description: result.message })] });
      return;
    }

    if (commandName === '!rr-remove') {
      const [msgId, emoji] = args;
      const result = reactionRoles.removeBinding(msgId, emoji);
      await message.reply({ embeds: [result.ok ? success({ title: 'Reaction Role Removed', description: result.message }) : error({ title: 'Failed', description: result.message })] });
      return;
    }

    if (commandName === '!rr-list') {
      const bindings = reactionRoles.getBindings(args[0] || '');
      const desc = Object.entries(bindings).length
        ? Object.entries(bindings).map(([emoji, roleId]) => `${emoji} → <@&${roleId}>`).join('\n')
        : 'No reaction roles configured. Use `!rr-add <messageId> <emoji> <roleId>` first.';
      await message.reply({ embeds: [info({ title: 'Reaction Roles', description: desc })] });
      return;
    }

    if (commandName === '!banword') {
      const word = args.join(' ');
      const added = autoMod.addBannedWord(message.guild.id, word);
      await message.reply({ embeds: [added ? success({ title: 'Word Banned', description: `Messages containing "${word}" will be deleted.` }) : warning({ title: 'Already Banned', description: `"${word}" is already in the filter.` })] });
      return;
    }

    if (commandName === '!unbanword') {
      const word = args.join(' ');
      const removed = autoMod.removeBannedWord(message.guild.id, word);
      await message.reply({ embeds: [removed ? success({ title: 'Word Unbanned', description: `"${word}" removed from filter.` }) : error({ title: 'Not Found', description: `"${word}" is not in the filter.` })] });
      return;
    }

    if (commandName === '!setlog') {
      const channelId = args[0]?.replace(/[<#>]/g, '') || null;
      serverLog.setLogChannel(message.guild.id, channelId);
      await message.reply({ embeds: [success({ title: 'Log Channel Set', description: channelId ? `Events will be logged to <#${channelId}>.` : 'Logging disabled.' })] });
      return;
    }

    // ========================================================================
    // WELCOME / LEAVE MESSAGES
    // ========================================================================
    if (commandName === '!setwelcome') {
      const channelId = args[0]?.replace(/[<#>]/g, '');
      if (!channelId) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!setwelcome <#channel>` then `!welcomemsg <message>`\nPlaceholders: {user} {username} {server} {count}`' })] });
        return;
      }
      welcomeSystem.setWelcomeChannel(message.guild.id, channelId);
      await message.reply({ embeds: [success({ title: 'Welcome Channel Set', description: `Welcome messages will be sent to <#${channelId}>.` })] });
      return;
    }

    if (commandName === '!welcomemsg') {
      const msg = args.join(' ');
      welcomeSystem.setWelcomeMessage(message.guild.id, msg);
      await message.reply({ embeds: [success({ title: 'Welcome Message Set', description: msg })] });
      return;
    }

    if (commandName === '!setleave') {
      const channelId = args[0]?.replace(/[<#>]/g, '');
      if (!channelId) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!setleave <#channel>` then `!leavemsg <message>`' })] });
        return;
      }
      welcomeSystem.setLeaveChannel(message.guild.id, channelId);
      await message.reply({ embeds: [success({ title: 'Leave Channel Set', description: `Leave messages will be sent to <#${channelId}>.` })] });
      return;
    }

    if (commandName === '!leavemsg') {
      const msg = args.join(' ');
      welcomeSystem.setLeaveMessage(message.guild.id, msg);
      await message.reply({ embeds: [success({ title: 'Leave Message Set', description: msg })] });
      return;
    }

    // ========================================================================
    // GIVEAWAYS
    // ========================================================================
    if (commandName === '!gstart') {
      const [duration, winners, ...prizeParts] = args;
      const prize = prizeParts.join(' ');
      if (!duration || !winners || !prize) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!gstart <duration> <winners> <prize>`\nExample: `!gstart 1d 1 Nitro Classic`\nDuration: 30s, 5m, 2h, 1d, 1w' })] });
        return;
      }
      const result = await giveaway.startGiveaway(message.channel, message.author, duration, parseInt(winners), prize);
      if (!result.ok) {
        await message.reply({ embeds: [error({ title: 'Giveaway Error', description: result.message })] });
      }
      return;
    }

    if (commandName === '!greroll') {
      const messageId = args[0];
      const gw = giveaway.giveaways[messageId];
      if (!gw) {
        await message.reply({ embeds: [error({ title: 'Not Found', description: 'No giveaway found with that message ID.' })] });
        return;
      }
      try {
        const msg = await message.channel.messages.fetch(messageId);
        const winners = await giveaway.reroll(gw, msg);
        if (winners.length > 0) {
          await message.reply({ embeds: [success({ title: '🎉 New Winner!', description: `New winner(s): ${winners.map((id) => `<@${id}>`).join(', ')}` })] });
        } else {
          await message.reply({ embeds: [warning({ title: 'No Entries', description: 'No valid entries to reroll.' })] });
        }

    // ========================================================================
    // TICKETS
    // ========================================================================
    if (commandName === '!ticket-panel') {
      const roleId = args[0]?.replace(/[<@&>]/g, '');
      const result = await ticketSystem.createPanel(message.channel, roleId);
      await message.reply({ embeds: [result.ok ? success({ title: 'Ticket Panel Created', description: result.message }) : error({ title: 'Failed', description: result.message })] });
      return;
    }

    if (commandName === '!close') {
      const result = await ticketSystem.closeTicket(message.channel, message.member);
      if (!result.ok) {
        await message.reply({ embeds: [error({ title: 'Not a Ticket', description: result.message })] });
      }
      return;
    }

    // ========================================================================
    // MODERATION — ban, kick, timeout, purge, warn
    // ========================================================================
    if (commandName === '!ban') {
      const targetId = args[0]?.replace(/[<@!>]/g, '');
      const reason = args.slice(1).join(' ') || 'No reason provided';
      if (!targetId) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!ban <@user> [reason]`' })] });
        return;
      }
      try {
        const target = await message.guild.members.fetch(targetId);
        const result = await moderation.ban(message.member, target, reason);
        await message.reply({ embeds: [result.ok ? success({ title: '🔨 Banned', description: result.message }) : error({ title: 'Cannot Ban', description: result.message })] });
      } catch {
        await message.reply({ embeds: [error({ title: 'Not Found', description: 'Could not find that user in this server.' })] });
      }
      return;
    }

    if (commandName === '!kick') {
      const targetId = args[0]?.replace(/[<@!>]/g, '');
      const reason = args.slice(1).join(' ') || 'No reason provided';
      if (!targetId) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!kick <@user> [reason]`' })] });
        return;
      }
      try {
        const target = await message.guild.members.fetch(targetId);
        const result = await moderation.kick(message.member, target, reason);
        await message.reply({ embeds: [result.ok ? success({ title: '👢 Kicked', description: result.message }) : error({ title: 'Cannot Kick', description: result.message })] });
      } catch {
        await message.reply({ embeds: [error({ title: 'Not Found', description: 'Could not find that user in this server.' })] });
      }
      return;
    }

    if (commandName === '!timeout') {
      const targetId = args[0]?.replace(/[<@!>]/g, '');
      const duration = args[1];
      const reason = args.slice(2).join(' ') || 'No reason provided';
      if (!targetId || !duration) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!timeout <@user> <duration> [reason]`\nDuration: 30s, 10m, 1h, 1d (max 28d)' })] });
        return;
      }
      try {
        const target = await message.guild.members.fetch(targetId);
        const result = await moderation.timeout(message.member, target, duration, reason);
        await message.reply({ embeds: [result.ok ? success({ title: '⏱️ Timed Out', description: result.message }) : error({ title: 'Cannot Timeout', description: result.message })] });
      } catch {
        await message.reply({ embeds: [error({ title: 'Not Found', description: 'Could not find that user in this server.' })] });
      }
      return;
    }

    if (commandName === '!purge') {
      const amount = parseInt(args[0]) || 10;
      const result = await moderation.purge(message.channel, amount);
      const reply = await message.reply({ embeds: [result.ok ? success({ title: '🗑️ Purged', description: result.message }) : error({ title: 'Cannot Purge', description: result.message })] });
      setTimeout(() => reply.delete().catch(() => {}), 3000);
      return;
    }

    if (commandName === '!warn') {
      const targetId = args[0]?.replace(/[<@!>]/g, '');
      if (!targetId) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!warn <@user>`' })] });
        return;
      }
      try {
        const target = await message.guild.members.fetch(targetId);
        const count = autoMod.warnUser(message.guild.id, targetId);
        await message.reply({ embeds: [warning({ title: '⚠️ Warned', description: `**${target.user.tag}** has been warned. (${count} total warns)` })] });
      } catch {
        await message.reply({ embeds: [error({ title: 'Not Found', description: 'Could not find that user.' })] });
      }
      return;
    }
      } catch {
        await message.reply({ embeds: [error({ title: 'Error', description: 'Could not fetch giveaway message.' })] });
      }
      return;
    }

    if (commandName === '!gend') {
      const messageId = args[0];
      const gw = giveaway.giveaways[messageId];
      if (!gw) {
        await message.reply({ embeds: [error({ title: 'Not Found', description: 'No giveaway found with that message ID.' })] });
        return;
      }
      try {
        const msg = await message.channel.messages.fetch(messageId);
        const winners = await giveaway.pickWinners(gw, msg);
        gw.ended = true;
        await giveaway.announceWinners(gw, winners, message.channel);
      } catch {
        await message.reply({ embeds: [error({ title: 'Error', description: 'Could not end giveaway.' })] });
      }
      return;
    }
  } catch (error) {
    console.error(`[${commandName}] ${error.message}`);

    // ========================================================================
    // CUSTOM COMMANDS
    // ========================================================================
    if (commandName === '!cmd-add') {
      const name = args[0];
      const response = args.slice(1).join(' ');
      if (!name || !response) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!cmd-add <name> <response>`' })] });
        return;
      }
      const result = customCommands.addCommand(message.guild.id, name, response);
      await message.reply({ embeds: [result.ok ? success({ title: 'Command Created', description: result.message }) : error({ title: 'Failed', description: result.message })] });
      return;
    }

    if (commandName === '!cmd-remove') {
      const name = args[0];
      const result = customCommands.removeCommand(message.guild.id, name);
      await message.reply({ embeds: [result.ok ? success({ title: 'Command Removed', description: result.message }) : error({ title: 'Failed', description: result.message })] });
      return;
    }

    if (commandName === '!cmd-list') {
      const cmds = customCommands.getCommands(message.guild.id);
      const desc = Object.keys(cmds).length
        ? Object.keys(cmds).map((name) => `\`!${name}\``).join(', ')
        : 'No custom commands set.';
      await message.reply({ embeds: [info({ title: 'Custom Commands', description: desc })] });
      return;
    }

    // ========================================================================
    // UTILITY & FUN COMMANDS — ping, avatar, serverinfo, userinfo, poll, 8ball
    // ========================================================================
    if (commandName === '!ping') {
      const sent = await message.reply({ embeds: [info({ title: '🏓 Pinging...', description: 'Measuring latency...' })] });
      const ws = Math.round(client.ws.ping);
      const roundtrip = sent.createdTimestamp - message.createdTimestamp;
      await sent.edit({ embeds: [success({ title: '🏓 Pong!', description: `WebSocket: **${ws}ms**\nRoundtrip: **${roundtrip}ms**` })] });
      return;
    }

    if (commandName === '!uptime') {
      const seconds = Math.floor(process.uptime());
      const d = Math.floor(seconds / 86400);
      const h = Math.floor((seconds % 86400) / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      await message.reply({ embeds: [info({ title: '⏱️ Uptime', description: `**${d}d ${h}h ${m}m ${s}s**` })] });
      return;
    }

    if (commandName === '!avatar') {
      const targetId = args[0]?.replace(/[<@!>]/g, '') || message.author.id;
      const user = await client.users.fetch(targetId).catch(() => null);
      if (!user) {
        await message.reply({ embeds: [error({ title: 'Not Found', description: 'Could not find that user.' })] });
        return;
      }
      const avatar = user.displayAvatarURL({ size: 1024, extension: 'png' });
      await message.reply({ embeds: [info({ title: `${user.username}'s Avatar`, image: avatar, url: avatar })] });
      return;
    }

    if (commandName === '!serverinfo') {
      const g = message.guild;
      const embed = info({
        title: g.name,
        description: `**ID:** ${g.id}\n**Owner:** <@${g.ownerId}>\n**Created:** <t:${Math.floor(g.createdTimestamp / 1000)}:R>\n**Members:** ${g.memberCount}\n**Channels:** ${g.channels.cache.size}\n**Roles:** ${g.roles.cache.size}\n**Boosts:** ${g.premiumSubscriptionCount || 0}`,
        thumbnail: g.iconURL({ size: 128 }),
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    if (commandName === '!userinfo') {
      const targetId = args[0]?.replace(/[<@!>]/g, '') || message.author.id;
      const member = await message.guild.members.fetch(targetId).catch(() => null);
      if (!member) {
        await message.reply({ embeds: [error({ title: 'Not Found', description: 'Could not find that member.' })] });
        return;
      }
      const roles = member.roles.cache.filter((r) => r.id !== message.guild.id).map((r) => r.name).join(', ') || 'None';
      const embed = info({
        title: member.user.username,
        description: `**ID:** ${member.id}\n**Joined:** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>\n**Account:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n**Roles:** ${roles}\n**Bot:** ${member.user.bot ? 'Yes' : 'No'}`,
        thumbnail: member.user.displayAvatarURL({ size: 128 }),
      });
      await message.reply({ embeds: [embed] });
      return;
    }

    if (commandName === '!poll') {
      const question = args.join(' ');
      if (!question) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!poll <question>` — creates a 👍/👎 poll.' })] });
        return;
      }
      const pollMsg = await message.channel.send({ embeds: [info({ title: '📊 Poll', description: question, footer: `Poll by ${message.author.username}` })] });
      await pollMsg.react('👍');
      await pollMsg.react('👎');
      await pollMsg.react('🤷');
      return;
    }

    if (commandName === '!8ball') {
      const question = args.join(' ');
      if (!question) {
        await message.reply({ embeds: [error({ title: 'Usage', description: '`!8ball <question>`' })] });
        return;
      }
      const answers = ['Yes', 'No', 'Maybe', 'Definitely!', 'Ask again later', 'Absolutely not', 'I think so', 'Cannot predict now', 'Signs point to yes', 'Very doubtful'];
      const answer = answers[Math.floor(Math.random() * answers.length)];
      await message.reply({ embeds: [info({ title: '🎱 Magic 8-Ball', description: `**Q:** ${question}\n**A:** ${answer}` })] });
      return;
    }

    if (commandName === '!coinflip') {
      const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
      await message.reply({ embeds: [info({ title: '🪙 Coin Flip', description: `You got **${result}**!` })] });
      return;
    }

    if (commandName === '!dice') {
      const sides = Math.max(2, Math.min(100, parseInt(args[0]) || 6));
      const roll = Math.floor(Math.random() * sides) + 1;
      await message.reply({ embeds: [info({ title: '🎲 Dice Roll', description: `Rolled a **${roll}** (d${sides})` })] });
      return;
    }

    // ========================================================================
    // Custom command execution (check if message matches a custom command)
    // ========================================================================
    const customCmd = customCommands.getCommand(message.guild.id, commandName.replace('!', ''));
    if (customCmd) {
      const response = customCommands.executeCommand(message.guild.id, commandName.replace('!', ''));
      await message.reply(response);
      return;
    }
    await message.reply(`Could not complete that command: ${error.message}`).catch(() => {});
  }
});

// ============================================================================
// SIMILAR SONGS — after a song plays, show related tracks as add/remove buttons
// ============================================================================
const { songSuggestions } = require('./suggestionStore');

// Builds the suggestion rows: ➕ add buttons for related songs and a ➖ select
// menu listing current queue tracks for removal.
function suggestionRows(guildId) {
  const suggestions = songSuggestions.get(guildId) ?? [];
  const rows = [];
  if (suggestions.length) {
    rows.push(new ActionRowBuilder().addComponents(
      suggestions.map((track, index) => new ButtonBuilder()
        .setCustomId(`d4c_sim_${index}`)
        .setLabel((track.title || `Song ${index + 1}`).slice(0, 60))
        .setStyle(ButtonStyle.Primary)
        .setEmoji('➕'))
    ));
  }
  const queued = music.list(guildId);
  if (queued.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('d4c_qremove')
        .setPlaceholder('➖ Select a queued song to REMOVE')
        .addOptions(queued.slice(0, 25).map((track, index) => new StringSelectMenuOptionBuilder()
          .setLabel(`${index + 1}. ${track.title.slice(0, 95)}`)
          .setValue(track.url)))
    ));
  }
  return rows;
}

// Fire-and-forget: search similar tracks to the played song and post buttons.
async function sendRelatedSongs(source, playedTitle) {
  try {
    if (!playedTitle) return;
    const query = music.cleanSongTitle(playedTitle);
    if (!query) return;
    const results = await music.search(query);
    const suggestions = (results || [])
      .filter((t) => t.url && t.title !== playedTitle)
      .slice(0, 4);
    if (!suggestions.length) return;
    songSuggestions.set(source.guild.id, suggestions);
    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle('🎯 Similar Songs You Might Like')
      .setDescription(
        `Because you played **${playedTitle}**\n\n` +
        suggestions.map((t, i) => `**${i + 1}.** [${t.title}](${t.url})`).join('\n') +
        `\n\n➕ Click a button to **add to queue** • Use the ➖ menu to **remove** queued songs`
      );
    await source.channel.send({ embeds: [embed], components: suggestionRows(source.guild.id) });
  } catch (e) {
    console.log(`[music] related-songs suggestion skipped: ${e.message}`);
  }
}

client.on('interactionCreate', async (interaction) => {
  // Live autocomplete for /play command as user types every letter.
  if (interaction.isAutocomplete() && interaction.commandName === 'play') {
    await handlePlayAutocomplete(interaction);
    return;
  }

  // ----- Slash commands -----
  if (interaction.isChatInputCommand()) {
    switch (interaction.commandName) {
      case 'play':
        await handlePlay(interaction);
        return;
      case 'skip':
        await handleSkip(interaction);
        return;
      case 'stop':
        await handleStop(interaction);
        return;
      case 'queue':
        await handleQueue(interaction);
        return;
      default:
        break;
    }
  }

  // ==========================================================================
  // VERIFICATION GATE — available to EVERYONE (before the owner-only guard)
  // ==========================================================================
  if (interaction.isButton() && interaction.customId === 'd4c_verify_start') {
    await verification.handleVerifyStart(interaction);
    return;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'd4c_verify_captcha') {
    await verification.handleCaptcha(interaction);
    return;
  }

  // ----- Button / select-menu interactions (music panel) -----
  if (!interaction.customId?.startsWith('d4c_')) return;
  if (!ownerAccess.isOwner(interaction.user.id)) {
    await interaction.reply({ content: 'This bot is owner-only.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'd4c_select_song') {
    const selectedUrl = interaction.values[0];
    await interaction.deferUpdate();
    const resultMsg = await music.addTrack(interaction, selectedUrl);
    if (typeof resultMsg === 'string' && resultMsg.startsWith('Join a voice channel')) {
      await interaction.followUp({ content: resultMsg, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.editReply({
      content: null,
      embeds: [musicEmbed(interaction.guildId)],
      components: musicControls()
    });
    // Show similar songs as add/remove buttons after the pick plays
    await sendRelatedSongs(interaction, music.status(interaction.guildId)?.current?.title);
    return;
  }

  // ----- ➕ "Similar songs" add-to-queue buttons -----
  if (interaction.isButton() && interaction.customId.startsWith('d4c_sim_')) {
    const index = Number(interaction.customId.split('_')[2]);
    const suggestions = songSuggestions.get(interaction.guildId) ?? [];
    const track = suggestions[index];
    if (!track) {
      await interaction.reply({ content: '⚠️ These suggestions expired — play a song again for fresh ones.', flags: MessageFlags.Ephemeral });
      return;
    }
    music.addUrlTrack(interaction.guildId, track.title, track.url);
    await music.playNextIfIdle(interaction.guildId);
    await interaction.reply({ content: `✅ Added **${track.title}** to the queue! Position: **${music.list(interaction.guildId).length}**`, flags: MessageFlags.Ephemeral });
    return;
  }

  // ----- ➖ Remove-from-queue select menu -----
  if (interaction.isStringSelectMenu() && interaction.customId === 'd4c_qremove') {
    const removed = music.removeTrack(interaction.guildId, interaction.values[0]);
    if (!removed) {
      await interaction.reply({ content: '⚠️ That track is no longer in the queue.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ content: `➖ Removed **${removed.title}** from the queue. ${music.list(interaction.guildId).length} track(s) left.`, flags: MessageFlags.Ephemeral });
    // Refresh the remove menu on the original message so it reflects the queue
    const rows = suggestionRows(interaction.guildId);
    await interaction.message.edit({ components: rows }).catch(() => {});
    return;
  }

  if (interaction.isButton()) {
    const actions = {
      d4c_pause: () => music.pause(interaction.guildId),
      d4c_resume: () => music.resume(interaction.guildId),
      d4c_skip: () => music.skip(interaction.guildId),
      d4c_stop: () => music.stop(interaction.guildId),
      d4c_loop: () => music.setLoop(interaction.guildId, !(music.status(interaction.guildId)?.loop ?? false)),
      d4c_queue: () => true
    };
    if (!actions[interaction.customId]) return;
    actions[interaction.customId]();
    await interaction.update({ embeds: [musicEmbed(interaction.guildId)], components: musicControls() });
  }
});

// ============================================================================
// EVENT HANDLERS — Welcome, Logging, Reaction Roles, Auto-Mod
// ============================================================================

// Member joined — send welcome message
client.on('guildMemberAdd', (member) => {
  welcomeSystem.sendWelcome(member);
});

// Member left — send leave message
client.on('guildMemberRemove', (member) => {
  welcomeSystem.sendLeave(member);
});

// Message deleted — log it
client.on('messageDelete', (message) => {
  if (!message.guild || message.author?.bot) return;
  const logChannel = serverLog.getLogChannel(message.guild);
  if (logChannel) serverLog.logMessageDelete(message, logChannel);
});

// Message edited — log it
client.on('messageUpdate', (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return; // embeds loading etc
  const logChannel = serverLog.getLogChannel(newMessage.guild);
  if (logChannel) serverLog.logMessageEdit(oldMessage, newMessage, logChannel);
});

// Voice state changes — log joins/leaves/moves + enforce voice holds
client.on('voiceStateUpdate', (oldState, newState) => {
  const logChannel = serverLog.getLogChannel(newState.guild);
  if (logChannel) serverLog.logVoiceState(oldState, newState, logChannel);
  // Re-pin any held users (voice hold / loop)
  voiceControl.applyHolds(oldState, newState);
});

// Reaction added — reaction roles + tickets
client.on('messageReactionAdd', async (reaction, user) => {
  // Handle partial reactions
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  // Reaction roles
  reactionRoles.handleReactionAdd(reaction, user);
  // Tickets — create ticket on reaction
  const ticketConfig = ticketSystem.getGuildConfig(reaction.message.guild.id);
  if (ticketConfig.enabled && reaction.message.id === ticketConfig.panelMessageId && reaction.emoji.name === '🎫') {
    const result = await ticketSystem.createTicket(reaction.message.guild, user, reaction.message.id);
    if (!result.ok || result.channel) {
      // Remove the user's reaction so they can react again
      try { await reaction.users.remove(user.id); } catch { /* ignore */ }
    }
  }
});

// Reaction removed — reaction roles
client.on('messageReactionRemove', async (reaction, user) => {
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  reactionRoles.handleReactionRemove(reaction, user);
});

// Auto-mod — check messages for spam and banned words
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;
  // Spam check
  if (autoMod.isSpam(message.guild.id, message.author.id)) {
    try {
      await message.delete();
      await message.author.send('You are sending messages too quickly. Please slow down.').catch(() => {});
    } catch { /* ignore */ }
    return;
  }
  // Banned word check
  const bannedWord = autoMod.containsBannedWord(message.guild.id, message.content);
  if (bannedWord) {
    try {
      await message.delete();
      const warnCount = autoMod.warnUser(message.guild.id, message.author.id);
      await message.channel.send({ embeds: [warning({ title: '⚠️ Word Filter', description: `Your message contained a filtered word. Warning ${warnCount}.` })] }).then((m) => setTimeout(() => m.delete().catch(() => {}), 5000));
    } catch { /* ignore */ }
  }
});


console.log('Connecting to Discord...');
const loginTimeout = setTimeout(() => {
  console.error('Discord login timed out after 30 seconds. Check the token and Wispbyte network/Gateway access.');
  process.exit(1);
}, 30000);

client.login(token)
  .then(() => clearTimeout(loginTimeout))
  .catch((error) => {
    clearTimeout(loginTimeout);
    console.error('Discord startup failed:', error.message);
    process.exit(1);
  });

