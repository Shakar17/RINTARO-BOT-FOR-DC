// ============================================================================
// audioEffects.js
// ---------------------------------------------------------------------------
// Voice-channel audio effects: Text-to-Speech (Google TTS) and a built-in
// soundboard of short effects generated on-the-fly with ffmpeg (no external
// audio files needed).
//
// Functions:
//   playTTS({ guild, channelId, adapterCreator, member, text, lang }) -> join VC + speak text
//   playSound({ guild, channelId, adapterCreator, soundName })         -> play a built-in effect
//   listSounds()                                                       -> available sound names
//   leaveVoice(guildId)                                                 -> disconnect from VC
// ============================================================================

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFile } = require('node:child_process');
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} = require('@discordjs/voice');
const ffmpegPath = require('ffmpeg-static');

const connections = new Map(); // guildId -> { connection, player, channelId }

// ---------------------------------------------------------------------------
// Built-in soundboard — each sound is defined as an ffmpeg lavfi filter graph
// so we can synthesize it on demand with the bundled ffmpeg binary.
// ---------------------------------------------------------------------------
const SOUND_DEFS = {
  ding: {
    desc: 'soft notification bell',
    args: ['-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.35', '-af', 'afade=t=out:st=0.25:d=0.1'],
  },
  airhorn: {
    desc: 'TRAIN AIRHORN!',
    args: ['-f', 'lavfi', '-i', 'sine=frequency=233:duration=1.4', '-af', 'volume=1.8,afade=t=out:st=1.0:d=0.4,overdrive=ga=6:cb=2000'],
  },
  boom: {
    desc: 'deep explosion boom',
    args: ['-f', 'lavfi', '-i', 'sine=frequency=55:duration=1.6', '-af', 'volume=2.0,afade=t=in:st=0:d=0.05,afade=t=out:st=1.1:d=0.5,acompressor'],
  },
  riser: {
    desc: 'epic riser effect',
    args: ['-f', 'lavfi', '-i', 'sine=frequency=120:duration=2.0', '-af', 'volume=1.2,apulsator=hz=6,afade=t=out:st=1.5:d=0.5'],
  },
  sus: {
    desc: 'suspenseful heartbeat',
    args: ['-f', 'lavfi', '-i', 'sine=frequency=60:duration=2.4', '-af', 'volume=1.5,abass=width=2:out=3,afade=t=out:st=2.0:d=0.4'],
  },
  tick: {
    desc: 'short clock tick',
    args: ['-f', 'lavfi', '-i', 'sine=frequency=1200:duration=0.08', '-af', 'volume=0.8'],
  },
  clap: {
    desc: 'singular clap',
    args: ['-f', 'lavfi', '-i', 'anoisesrc=colour=pink:duration=0.12:amplitude=0.6', '-af', 'afade=t=out:st=0.06:d=0.06'],
  },
  win: {
    desc: 'victory chime',
    args: [
      '-f', 'lavfi', '-i', 'sine=frequency=660:duration=0.25',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.25',
      '-f', 'lavfi', '-i', 'sine=frequency=1320:duration=0.5',
      '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1',
    ],
  },
  sad: {
    desc: 'sad low tone',
    args: ['-f', 'lavfi', '-i', 'sine=frequency=165:duration=1.1', '-af', 'volume=1.2,afade=t=out:st=0.7:d=0.4'],
  },
  siren: {
    desc: 'police-ish siren sweep',
    args: ['-f', 'lavfi', '-i', 'sine=frequency=500', '-af', 'vibrato=f=3:d=0.25,duration=1.5,volume=1.4'],
  },
};

/** List available sound names with descriptions. */
function listSounds() {
  return Object.entries(SOUND_DEFS).map(([name, def]) => ({ name, desc: def.desc }));
}

/**
 * Core: ensure a voice connection to a channel and return { connection, player }.
 */
async function ensureConnection(guildId, channelId, adapterCreator, memberName) {
  let entry = connections.get(guildId);
  if (entry && entry.connection.state.status !== VoiceConnectionStatus.Ready) {
    entry.connection.destroy();
    connections.delete(guildId);
    entry = null;
  }
  if (entry && entry.channelId === channelId) return entry;

  if (entry) {
    entry.player.stop();
    entry.connection.destroy();
    connections.delete(guildId);
  }

  const connection = joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator,
    selfDeaf: false,
    selfMute: false,
  });
  connection.on('error', (err) => console.error(`[audioEffects] Connection error: ${err.message}`));
  connection.on('stateChange', (oldS, newS) => {
    console.log(`[audioEffects] Voice state ${oldS.status} -> ${newS.status}`);
  });

  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Leave } });
/**
 * Play a synthesized sound effect in a voice channel.
 */
async function playSound({ guild, channelId, adapterCreator, soundName }) {
  const def = SOUND_DEFS[soundName];
  if (!def) return { ok: false, message: `Unknown sound \`${soundName}\`. Try: ${Object.keys(SOUND_DEFS).join(', ')}.` };

  let entry;
  try {
    entry = await ensureConnection(guild.id, channelId, adapterCreator, 'soundboard');
  } catch (err) {
    return { ok: false, message: err.message };
  }

  const tmpFile = path.join(os.tmpdir(), `d4c_${soundName}_${Date.now()}.wav`);
  await new Promise((resolve, reject) => {
    execFile(ffmpegPath, [...def.args, tmpFile], (err) => (err ? reject(err) : resolve()));
  });

  const resource = createAudioResource(fs.createReadStream(tmpFile));
  entry.player.play(resource);
  entry.connection.subscribe(entry.player);

  resource.playStream.on('end', () => {
    fs.unlink(tmpFile, () => {});
  });
  setTimeout(() => fs.unlink(tmpFile, () => {}), 8000);

  return { ok: true, message: `Playing **${soundName}** — ${def.desc}` };
}

/**
 * Speak text in a voice channel using Google Translate TTS.
 */
async function playTTS({ guild, channelId, adapter, text, lang = 'en' }) {
  const clean = String(text).slice(0, 200);
  if (!clean) return { ok: false, message: 'TTS text is required.' };

  let entry;
  try {
    entry = await ensureConnection(guild.id, channelId, adapter, 'tts');
  } catch (err) {
    return { ok: false, message: err.message };
  }

  const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(clean)}`;

  const stream = await new Promise((resolve, reject) => {
    const req = https.get(ttsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 400) return reject(new Error(`TTS HTTP ${res.statusCode}`));
      resolve(res);
    });
    req.on('error', reject);
  });

  const resource = createAudioResource(stream);
  entry.player.play(resource);
  entry.connection.subscribe(entry.player);

  return { ok: true, message: `🔊 Speaking ${clean.length > 40 ? clean.slice(0, 40) + '…' : clean}` };
}

/**
 * Leave the voice channel in a guild and clean up.
 */
function leaveVoice(guildId) {
  const entry = connections.get(guildId);
  if (!entry) return false;
  try { entry.player.stop(); } catch {}
  try { entry.connection.destroy(); } catch {}
  connections.delete(guildId);
  return true;
}

/** Get the active audio connection's channel for a guild (or null). */
function getActiveChannel(guildId) {
  return connections.get(guildId)?.channelId || null;
}

function ttsLanguages() {
  return { en: 'English', es: 'Spanish', fr: 'French', de: 'German', hi: 'Hindi', ja: 'Japanese', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada' };
}

module.exports = { playSound, playTTS, listSounds, leaveVoice, getActiveChannel, ttsLanguages };

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  } catch (err) {
    connection.destroy();
    console.error(`[audioEffects] Could not connect to voice in 15s: ${err.message}`);
    throw new Error('Voice connection timed out. Check bot permissions (Connect/Speak) and try again.');
  }

  entry = { connection, player, channelId };
  connections.set(guildId, entry);
  return entry;
}