// ============================================================================
// commands/deployCommands.js
// ---------------------------------------------------------------------------
// Registers the bot's slash commands with Discord. Run once after deploying:
//   node src/commands/deployCommands.js
//
// Uses the Discord REST API directly (no extra libraries needed).
// ============================================================================

require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env. Set both before deploying commands.');
  process.exit(1);
}

// ----- Define all slash commands -----
const playCommand = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Search for a song or play a YouTube URL')
  .addStringOption((option) =>
    option
      .setName('query')
      .setDescription('Song name or YouTube URL')
      .setRequired(true)
      .setAutocomplete(true),
  );

const skipCommand = new SlashCommandBuilder()
  .setName('skip')
  .setDescription('Skip the currently playing track');

const stopCommand = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Stop playback and clear the queue');

const queueCommand = new SlashCommandBuilder()
  .setName('queue')
  .setDescription('Show the current music queue');

const commands = [
  playCommand.toJSON(),
  skipCommand.toJSON(),
  stopCommand.toJSON(),
  queueCommand.toJSON(),
];

// ----- Register with Discord -----
const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`Registering ${commands.length} slash command(s) for application ${clientId}...`);

    await rest.put(Routes.applicationCommands(clientId), {
      body: commands,
    });

    console.log('Slash commands registered successfully.');
    console.log('They may take up to an hour to appear in all servers (use a guild-specific route for instant testing).');
  } catch (error) {
    console.error('Failed to register slash commands:', error.message);
    process.exit(1);
  }
})();
