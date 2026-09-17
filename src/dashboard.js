// ============================================================================
// dashboard.js
// ---------------------------------------------------------------------------
// Express-based web dashboard for building and sending Discord embeds.
//
// Security:
//   Every /api/* route is guarded by requireDashboardAuth which checks the
//   x-dashboard-key header against DASHBOARD_KEY in .env. The real bot token
//   NEVER leaves the server — the frontend only ever talks to our own API.
//
// Routes:
//   GET  /                  → serves the static frontend (public/index.html)
//   GET  /health            → JSON health probe (kept for Render/Wispbyte)
//   POST /api/send-embed    → validates input, builds an embed, sends it
// ============================================================================

const path = require('node:path');
const express = require('express');

const { embed } = require('./embedHelper');
const music = require('./musicPlayer');
const moderation = require('./moderation');
const verification = require('./verification');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DASHBOARD_KEY = process.env.DASHBOARD_KEY || '';

// ---------------------------------------------------------------------------
// Auth middleware — rejects requests without a valid dashboard key.
// ---------------------------------------------------------------------------
function requireDashboardAuth(request, response, next) {
  if (!DASHBOARD_KEY) {
    return response.status(503).json({
      ok: false,
      message: 'Dashboard is disabled. Set DASHBOARD_KEY in .env to enable it.',
    });
  }
  const providedKey = request.headers['x-dashboard-key'] || '';
  if (providedKey !== DASHBOARD_KEY) {
    return response.status(401).json({ ok: false, message: 'Invalid or missing dashboard key.' });
  }
  next();
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------
function isValidSnowflake(id) {
  return typeof id === 'string' && /^\d{17,20}$/.test(id.trim());
}

function sanitizeText(text, max = 4096) {
  if (typeof text !== 'string') return '';
  return text.slice(0, max);
}

/**
 * Validates the payload from the frontend and returns { ok, data, error }.
 * Expected payload shape:
 *   { channelId, title, description?, sections: [{ heading, lines[], imageUrl?, videoUrl? }] }
 */
function validatePayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }

  const channelId = String(body.channelId || '').trim();
  if (!isValidSnowflake(channelId)) {
    return { ok: false, error: 'Channel ID must be a valid Discord snowflake (17-20 digits).' };
  }

  const title = sanitizeText(body.title, 256);
  if (!title) {
    return { ok: false, error: 'Title is required (max 256 characters).' };
  }

  const description = sanitizeText(body.description || '', 4096);

  const rawSections = Array.isArray(body.sections) ? body.sections : [];
  if (rawSections.length === 0) {
    return { ok: false, error: 'At least one section is required.' };
  }
  if (rawSections.length > 25) {
    return { ok: false, error: 'Discord embeds support a maximum of 25 fields/sections.' };
  }

  const sections = [];
  for (const raw of rawSections) {
    const heading = sanitizeText(raw.heading, 256);
    const lines = Array.isArray(raw.lines)
      ? raw.lines.filter((l) => typeof l === 'string' && l.trim().length > 0).map((l) => sanitizeText(l, 1024))
      : [];
    if (!heading && lines.length === 0) continue;
    sections.push({
      heading: heading || 'Section',
      lines,
      imageUrl: sanitizeText(raw.imageUrl || '', 512) || null,
      videoUrl: sanitizeText(raw.videoUrl || '', 512) || null,
    });
  }

  if (sections.length === 0) {
    return { ok: false, error: 'All sections are empty. Add at least one heading or line.' };
  }

  return { ok: true, data: { channelId, title, description, sections } };
}

// ---------------------------------------------------------------------------
// Build a Discord EmbedBuilder from validated dashboard data.
// ---------------------------------------------------------------------------
function buildDiscordEmbed(data) {
  // The first section's imageUrl becomes the embed image (if provided).
  const coverImage = data.sections.find((s) => s.imageUrl)?.imageUrl || null;

  const fields = data.sections.map((section) => {
    const cardValue = section.lines.length > 0
      ? section.lines.join('\n')
      : '​'; // zero-width space so the field isn't empty
    const parts = [];
    if (section.videoUrl) parts.push(`▶ [Video](${section.videoUrl})`);
    parts.push(cardValue);
    return {
      name: section.heading.slice(0, 256),
      value: parts.join('\n').slice(0, 1024),
      inline: false,
    };
  });

  return embed({
    type: 'info',
    title: data.title,
    description: data.description || undefined,
    image: coverImage,
    fields,
    footer: 'D4C Dashboard',
  });
}

function getGuild(discordClient, guildId) {
  return discordClient.guilds.cache.get(String(guildId || '').trim());
}

function getMember(guild, userId) {
  return guild.members.cache.get(String(userId || '').trim())
    || guild.members.fetch(String(userId || '').trim()).catch(() => null);
}

// ---------------------------------------------------------------------------
// Create and configure the Express app.
// @param {Client} discordClient  - The logged-in discord.js Client instance.
// @returns {Express}              - The configured Express application.
// ---------------------------------------------------------------------------
function createDashboard(discordClient) {
  const app = express();

  // Parse JSON bodies up to 1 MB (plenty for text embeds).
  app.use(express.json({ limit: '1mb' }));

  // Serve the static frontend from /public at the site root.
  const publicDir = path.resolve('public');
  app.use(express.static(publicDir));

  // Health probe (also useful for uptime monitors).
  app.get('/health', (request, response) => {
    response.json({
      ok: true,
      discord: discordClient?.isReady?.() ? 'ready' : 'connecting',
    });
  });

  // ----- Protected API routes below -----
  app.use('/api', requireDashboardAuth);

  app.get('/api/guilds', (request, response) => {
    response.json({
      ok: true,
      guilds: discordClient.guilds.cache.map((guild) => ({
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ size: 64 }),
        memberCount: guild.memberCount,
      })),
    });
  });

  app.get('/api/guilds/:guildId', async (request, response) => {
    const guild = getGuild(discordClient, request.params.guildId);
    if (!guild) return response.status(404).json({ ok: false, message: 'Server not found.' });
    await guild.channels.fetch().catch(() => null);
    response.json({
      ok: true,
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ size: 128 }),
        memberCount: guild.memberCount,
        channels: guild.channels.cache
          .filter((channel) => channel.isTextBased() && !channel.isDMBased())
          .sort((a, b) => a.position - b.position)
          .map((channel) => ({ id: channel.id, name: channel.name, type: channel.type })),
        music: music.status(guild.id) || { current: null, tracks: [], paused: false, volume: 100, loop: false },
      },
    });
  });

  app.post('/api/message', async (request, response) => {
    const guild = getGuild(discordClient, request.body?.guildId);
    const channelId = String(request.body?.channelId || '').trim();
    const content = sanitizeText(request.body?.content || '', 2000).trim();
    if (!guild || !isValidSnowflake(channelId) || !content) {
      return response.status(400).json({ ok: false, message: 'Server, channel, and message are required.' });
    }
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || channel.isDMBased()) {
      return response.status(400).json({ ok: false, message: 'Choose a server text channel.' });
    }
    try {
      const sent = await channel.send({ content });
      return response.json({ ok: true, messageId: sent.id });
    } catch (err) {
      return response.status(500).json({ ok: false, message: `Message failed: ${err.message}` });
    }
  });

  app.post('/api/moderation', async (request, response) => {
    const guild = getGuild(discordClient, request.body?.guildId);
    const userId = String(request.body?.userId || '').trim();
    const action = String(request.body?.action || '').trim();
    const reason = sanitizeText(request.body?.reason || 'Dashboard action', 500);
    if (!guild || !isValidSnowflake(userId)) {
      return response.status(400).json({ ok: false, message: 'Server and valid user ID are required.' });
    }
    const moderator = guild.members.me;
    const target = await getMember(guild, userId);
    if (!moderator || !target) return response.status(404).json({ ok: false, message: 'Member not found.' });
    let result;
    if (action === 'timeout') result = await moderation.timeout(moderator, target, request.body?.duration || '10m', reason);
    else if (action === 'untimeout') result = await moderation.removeTimeout(moderator, target, reason);
    else if (action === 'kick') result = await moderation.kick(moderator, target, reason);
    else if (action === 'ban') result = await moderation.ban(moderator, target, reason);
    else return response.status(400).json({ ok: false, message: 'Unsupported moderation action.' });
    return response.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/purge', async (request, response) => {
    const guild = getGuild(discordClient, request.body?.guildId);
    const channel = guild?.channels.cache.get(String(request.body?.channelId || '').trim());
    const amount = Number(request.body?.amount);
    if (!guild || !channel || !Number.isInteger(amount) || amount < 1 || amount > 100) {
      return response.status(400).json({ ok: false, message: 'Choose a channel and an amount from 1 to 100.' });
    }
    const result = await moderation.purge(channel, amount);
    return response.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/verification', async (request, response) => {
    const guild = getGuild(discordClient, request.body?.guildId);
    const action = String(request.body?.action || '');
    const channelId = String(request.body?.channelId || '').trim();
    if (!guild) return response.status(404).json({ ok: false, message: 'Server not found.' });
    if (action === 'set-channel') {
      if (!guild.channels.cache.has(channelId)) return response.status(400).json({ ok: false, message: 'Verify channel not found.' });
      verification.setVerifyChannel(guild.id, channelId);
      return response.json({ ok: true, message: 'Verification channel saved.' });
    }
    if (action === 'lock') {
      const verifyChannelId = verification.getConfig(guild.id).verifyChannelId;
      if (!verifyChannelId) return response.status(400).json({ ok: false, message: 'Set a verification channel first.' });
      const result = await verification.lockEveryone(guild, verifyChannelId);
      return response.json({ ok: true, message: `Locked ${result.locked} channel(s); ${result.failed} failed.` });
    }
    return response.status(400).json({ ok: false, message: 'Unsupported verification action.' });
  });

  app.post('/api/music', (request, response) => {
    const guild = getGuild(discordClient, request.body?.guildId);
    const action = String(request.body?.action || '');
    if (!guild) return response.status(404).json({ ok: false, message: 'Server not found.' });
    let result;
    if (action === 'pause') result = music.pause(guild.id);
    else if (action === 'resume') result = music.resume(guild.id);
    else if (action === 'skip') result = music.skip(guild.id);
    else if (action === 'stop') result = music.stop(guild.id);
    else if (action === 'loop') result = music.setLoop(guild.id, Boolean(request.body.enabled));
    else if (action === 'volume') result = music.setVolume(guild.id, Math.max(0, Math.min(200, Number(request.body.volume))));
    else return response.status(400).json({ ok: false, message: 'Unsupported music action.' });
    return response.json({ ok: true, result, music: music.status(guild.id) || null });
  });

  /**
   * POST /api/send-embed
   * Body: { channelId, title, description?, sections[] }
   * Returns: { ok: true, messageId } | { ok: false, message }
   */
  app.post('/api/send-embed', async (request, response) => {
    const validation = validatePayload(request.body);
    if (!validation.ok) {
      return response.status(400).json({ ok: false, message: validation.error });
    }
    const data = validation.data;

    // Look up the target channel.
    let channel;
    try {
      channel = await discordClient.channels.fetch(data.channelId);
    } catch (err) {
      console.error(`[dashboard] Channel fetch failed for ${data.channelId}: ${err.message}`);
      return response.status(404).json({
        ok: false,
        message: 'Channel not found. Check the ID and make sure the bot is in that server.',
      });
    }

    if (!channel.isTextBased() || channel.isDMBased()) {
      return response.status(400).json({
        ok: false,
        message: 'Target must be a server text or announcement channel, not a DM or voice channel.',
      });
    }

    // Build and send the embed.
    const discordEmbed = buildDiscordEmbed(data);
    try {
      const sent = await channel.send({ embeds: [discordEmbed] });
      console.log(`[dashboard] Embed sent to #${channel.name} (${channel.id}) by dashboard.`);
      return response.json({ ok: true, messageId: sent.id });
    } catch (err) {
      console.error(`[dashboard] Failed to send embed to ${data.channelId}: ${err.message}`);
      if (err.code === 50013) {
        return response.status(403).json({
          ok: false,
          message: 'Missing Permissions — the bot cannot send messages in that channel. Check View Channel + Send Messages + Embed Links.',
        });
      }
      return response.status(500).json({
        ok: false,
        message: `Send failed: ${err.message}`,
      });
    }
  });

  /**
   * POST /api/validate-channel
   * Lightweight endpoint for the frontend to check channel access early.
   * Body: { channelId } → returns channel name + guild name if reachable.
   */
  app.post('/api/validate-channel', async (request, response) => {
    const channelId = String(request.body?.channelId || '').trim();
    if (!isValidSnowflake(channelId)) {
      return response.status(400).json({ ok: false, message: 'Invalid channel ID format.' });
    }
    try {
      const channel = await discordClient.channels.fetch(channelId);
      if (!channel.isTextBased()) {
        return response.status(400).json({ ok: false, message: 'That channel is not a text channel.' });
      }
      return response.json({
        ok: true,
        channelName: `#${channel.name}`,
        guildName: channel.guild?.name ?? 'Unknown server',
      });
    } catch {
      return response.status(404).json({ ok: false, message: 'Channel not found or bot lacks access.' });
    }
  });

  return app;
}

module.exports = { createDashboard, buildDiscordEmbed, validatePayload };
