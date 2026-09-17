const fs = require('node:fs');
const path = require('node:path');
const { EndBehaviorType, joinVoiceChannel } = require('@discordjs/voice');
const prism = require('prism-media');

const recordings = new Map();
const recordingsDirectory = path.resolve(process.env.RECORDINGS_DIR || 'recordings');

function startRecording(message) {
  const voiceChannel = message.member?.voice.channel;
  if (!voiceChannel) return { ok: false, message: 'Join a voice channel first.' };
  if (recordings.has(message.guild.id)) return { ok: false, message: 'A recording is already active in this server.' };

  fs.mkdirSync(recordingsDirectory, { recursive: true });
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false
  });
  const filePath = path.join(recordingsDirectory, `${message.guild.id}-${Date.now()}.pcm`);
  const output = fs.createWriteStream(filePath);
  const receiver = connection.receiver;
  const recording = { connection, output, filePath, userId: message.author.id };
  recordings.set(message.guild.id, recording);

  const audio = receiver.subscribe(message.author.id, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 }
  });
  audio.pipe(new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 })).pipe(output);
  audio.on('end', () => {
    if (recordings.get(message.guild.id)?.userId === message.author.id) {
      recordings.delete(message.guild.id);
      connection.destroy();
    }
  });
  output.on('error', () => stopRecording(message.guild.id));

  return { ok: true, message: 'Recording started. Use `!stoprecord` to save it.', filePath };
}

function stopRecording(guildId) {
  const recording = recordings.get(guildId);
  if (!recording) return null;
  recordings.delete(guildId);
  recording.output.end();
  recording.connection.destroy();
  return recording.filePath;
}

module.exports = { startRecording, stopRecording };