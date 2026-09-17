// ============================================================================
// verification.js
// ---------------------------------------------------------------------------
// Human-verification gate for the server — NO ROLE NEEDED:
//   1. Owner sets a #verify channel (!setverify <#channel>) — the only channel
//      unverified users can see.
//   2. Owner posts the verification panel inside that channel (!verify-panel).
//   3. New users click the "Verify" button → they get a mini CAPTCHA (math
//      question select menu) proving they are a real human, not a bot/alt.
//   4. Accounts younger than 3 days are rejected as likely bot alts.
//   5. NO ROLE IS EVER ASSIGNED. Instead:
//      - Owner runs !verifylock → the bot denies View Channel for @everyone
//        on every channel except the verify channel (newcomers see nothing).
//      - When a user passes the check, the bot gives THAT USER permission
//        overwrites (View Channel, Send Messages, Read History) on all
//        channels — that is what makes them a "member".
//
// Settings persist to data/verification.json (same pattern as welcomeSystem).
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonStyle } = require('discord.js');

const DATA_FILE = path.resolve('data', 'verification.json');


// How long a user has to answer the CAPTCHA after clicking Verify (ms).
const CAPTCHA_TTL_MS = 3 * 60 * 1000;
// Minimum Discord account age to be accepted as a "real user" (ms).
const MIN_ACCOUNT_AGE_MS = 3 * 24 * 60 * 60 * 1000;

let config = load();

// pending CAPTCHAs: `${guildId}:${userId}` -> { answer, expiresAt }
const pending = new Map();

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

function getConfig(guildId) {
  if (!config[guildId]) {
    config[guildId] = {
      verifyChannelId: null,
      panelTitle: '🛡️ Server Verification',
      verifiedUsers: {},      // userId -> timestamp of verification
    };
  }
  return config[guildId];
}

function setVerifyChannel(guildId, channelId) {
  const c = getConfig(guildId);
  c.verifyChannelId = channelId;
  save();
}

function setPanelTitle(guildId, title) {
  const c = getConfig(guildId);
  c.panelTitle = title || c.panelTitle;
  save();
}

// ---------------------------------------------------------------------------
// Lockdown: hide EVERY channel from @everyone except the verify channel.
// Run once with !verifylock after setting the verify channel. New members
// will only be able to see #verify until they pass verification.
// ---------------------------------------------------------------------------
async function lockEveryone(guild, verifyChannelId) {
  let locked = 0;
  let failed = 0;
  const failures = [];

  for (const [, channel] of guild.channels.cache) {
    if (channel.id === verifyChannelId) continue; // keep #verify visible
    try {
      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        ViewChannel: false,
        SendMessages: false,
      }, { reason: 'D4C verification lockdown' });
      locked++;
    } catch (err) {
      failed++;
      failures.push(`#${channel.name}: ${err.message}`);
    }
  }
  return { locked, failed, failures };
}

// ---------------------------------------------------------------------------
// Core: grant per-user access (permission overwrites) — NO ROLE assigned.
// This is what turns a verified newcomer into a "member".
// ---------------------------------------------------------------------------
async function unlockUser(guild, userId) {
  const perms = {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
  };

  let unlocked = 0;
  let failed = 0;
  for (const [, channel] of guild.channels.cache) {
    try {
      await channel.permissionOverwrites.edit(userId, perms, { reason: 'D4C verification passed' });
      unlocked++;
    } catch (err) {
      console.error(`[verify] Could not unlock #${channel.name} for user: ${err.message}`);
      failed++;
    }
  }
  return { unlocked, failed };
}



// ---------------------------------------------------------------------------
// Panel — posted by an owner with !verify-panel inside the #verify channel
// ---------------------------------------------------------------------------
async function createPanel(message) {
  const c = getConfig(message.guild.id);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(c.panelTitle || '🛡️ Server Verification')
    .setDescription(
      '**Welcome to the server!** 🔒\n\n' +
      'To unlock full access to all channels, please verify that you are a **real human**.\n\n' +
      '**How it works:**\n' +
      '1️⃣ Click the **✅ Verify** button below\n' +
      '2️⃣ Answer the quick human-check question\n' +
      '3️⃣ You instantly get access to the whole server!\n\n' +
      '⚠️ Bot accounts and brand-new accounts (under 3 days old) cannot verify.'
    )
    .setFooter({ text: 'D4C • Verification System' })
    .setTimestamp();

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('d4c_verify_start')
      .setLabel('Verify Me')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
  );

  await message.channel.send({ embeds: [embed], components: [buttonRow] });
  return `✅ Verification panel posted in <#${message.channel.id}>. New members see only this channel until they click ✅ Verify and pass the check — no role is assigned.`;
}



// ---------------------------------------------------------------------------
// Step 1 — user clicks "Verify": run real-user checks, then send a CAPTCHA
// ---------------------------------------------------------------------------
async function handleVerifyStart(interaction) {
  const c = getConfig(interaction.guildId);

  if (!c.verifiedRoleId) {
    await interaction.reply({ content: '⚠️ Verification is not configured yet. Ask an admin to run `!verifyrole <@role>`.', flags: 64 });
    return;
  }
  if (c.verifyChannelId && interaction.channelId !== c.verifyChannelId) {
    await interaction.reply({ content: `⚠️ Please verify in <#${c.verifyChannelId}>.`, flags: 64 });
    return;
  }

  // --- Real-user check #1: it must not be a bot account ---
  if (interaction.user.bot) {
    await interaction.reply({ content: '🤖 Bots cannot verify. Nice try!', flags: 64 });
    return;
  }

  // --- Real-user check #2: minimum account age (blocks fresh bot alts) ---
  const accountAge = Date.now() - interaction.user.createdTimestamp;
  if (accountAge < MIN_ACCOUNT_AGE_MS) {
    const days = Math.floor(accountAge / (24 * 60 * 60 * 1000));
    await interaction.reply({
      content: `⏳ Your Discord account is only **${days} day(s)** old. Accounts must be at least **3 days** old to verify — this protects the server from bot raids.`,
      flags: 64,
    });
    return;
  }

  // --- Already verified? (tracked per-user in the data file — no roles) ---
  if (c.verifiedUsers[interaction.user.id]) {
    await interaction.reply({ content: '✅ You are already verified and have full server access!', flags: 64 });
    return;
  }

  // --- Generate a simple human check: "What is a + b?" with 4 choices ---
  const a = 2 + Math.floor(Math.random() * 8);
  const b = 2 + Math.floor(Math.random() * 8);
  const answer = String(a + b);
  const choices = new Set([answer]);
  while (choices.size < 4) {
    const fake = String(a + b + (Math.floor(Math.random() * 11) - 5));
    if (fake !== answer && Number(fake) > 0) choices.add(fake);
  }
  const shuffled = [...choices].sort(() => Math.random() - 0.5);

  pending.set(`${interaction.guildId}:${interaction.user.id}`, {
    answer,
    expiresAt: Date.now() + CAPTCHA_TTL_MS,
  });

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('d4c_verify_captcha')
      .setPlaceholder(`🧠 What is ${a} + ${b}?`)
      .addOptions(shuffled.map((choice) => new StringSelectMenuOptionBuilder()
        .setLabel(choice)
        .setValue(choice)))
  );

  await interaction.reply({
    content: `🧠 **Human check:** please solve **${a} + ${b}** and pick the correct answer below. You have **3 minutes**.`,
    components: [selectRow],
    flags: 64, // ephemeral — only the verifying user sees it
  });
}

// ---------------------------------------------------------------------------
// Step 2 — user answers the CAPTCHA: grant the verified role on success
// ---------------------------------------------------------------------------
async function handleCaptcha(interaction) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  const entry = pending.get(key);

  if (!entry || entry.expiresAt < Date.now()) {
    pending.delete(key);
    await interaction.update({ content: '⏱️ This human check expired. Click the **✅ Verify** button again to retry.', components: [] });
    return;
  }

  if (interaction.values[0] !== entry.answer) {
    pending.delete(key); // force a fresh Verify click + fresh question
    await interaction.update({ content: '❌ Wrong answer! Click the **✅ Verify** button to try again.', components: [] });
    return;
  }

  // Correct — grant per-user access directly (NO ROLE assigned)
  const c = getConfig(interaction.guildId);
  pending.delete(key);
  const result = await unlockUser(interaction.guild, interaction.user.id);

  // Remember this user as verified so re-clicks are friendly
  c.verifiedUsers[interaction.user.id] = Date.now();
  save();

  const extra = result.failed > 0 ? `\n⚠️ ${result.failed} channel(s) could not be unlocked — ask an admin to check my permissions.` : '';

  await interaction.update({
    content: `✅ **Verified!** Welcome — you are now a member. All channels are unlocked for you. 🎉${extra}`,
    components: [],
  });
}

module.exports = {
  getConfig,
  setVerifyChannel,
  setPanelTitle,
  lockEveryone,
  createPanel,
  handleVerifyStart,
  handleCaptcha,
};

