const { AudioPlayerStatus, NoSubscriberBehavior, VoiceConnectionStatus, createAudioPlayer, createAudioResource, demuxProbe, entersState, joinVoiceChannel } = require('@discordjs/voice');
const play = require('play-dl');
const path = require('node:path');
const https = require('node:https');
const fs = require('node:fs');
const YTDlpWrap = require('yt-dlp-wrap').default;

const queues = new Map();
const isWin = process.platform === 'win32';
const defaultYtDlpPath = process.env.YTDLP_PATH || path.resolve('tools', isWin ? 'yt-dlp.exe' : 'yt-dlp');
let ytdlp = new YTDlpWrap(defaultYtDlpPath);

// Cookie file paths — Render Secret File path or local project root
const COOKIE_PATHS = [
  path.resolve('cookies.txt'),                        // Render Secret File / local root
  path.resolve('tools', 'yt-cookies.txt'),            // Written from env var
];

function ensureCookiesFile() {
  // 1. Check for existing cookies.txt in known paths
  for (const p of COOKIE_PATHS) {
    if (fs.existsSync(p)) {
      console.log(`[music] Using YouTube cookies from: ${p}`);
      return p;
    }
  }
  // 2. Fallback: write from YOUTUBE_COOKIES env var if set
  const raw = process.env.YOUTUBE_COOKIES;
  if (!raw) return null;
  try {
    const dest = path.resolve('tools', 'yt-cookies.txt');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, raw.trim());
    console.log('[music] YouTube cookies file written from YOUTUBE_COOKIES env var.');
    return dest;
  } catch (e) {
    console.error('[music] Failed to write cookies file:', e.message);
    return null;
  }
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download file from ${url}: HTTP ${res.statusCode}`));
      }
      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(resolve);
      });
      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => reject(err));
      });
    }).on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Cobalt API — free YouTube proxy that returns direct audio URLs.
// Works reliably from datacenter IPs (Render/Railway) where YouTube blocks
// yt-dlp. Tries multiple community instances for redundancy.
// ---------------------------------------------------------------------------
const COBALT_INSTANCES = [
  'https://api.cobalt.tools/api/json',
  'https://cobalt-api.kwiatekmiki.com/api/json',
  'https://cobalt-backend.canine.tools/api/json',
];

async function getStreamViaCobalt(trackUrl) {
  for (const endpoint of COBALT_INSTANCES) {
    try {
      const body = JSON.stringify({
        url: trackUrl,
        videoQuality: 'audio',
        audioFormat: 'mp3',
      });
      const data = await new Promise((resolve, reject) => {
        const req = https.request(endpoint, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'User-Agent': 'Mozilla/5.0',
          },
          timeout: 20000,
        }, (res) => {
          let raw = '';
          res.on('data', (chunk) => { raw += chunk; });
          res.on('end', () => {
            try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Invalid JSON from Cobalt')); }
          });
        });
        req.on('timeout', () => { req.destroy(new Error('Cobalt timeout')); });
        req.on('error', reject);
        req.write(body);
        req.end();
      });
      if (data.status === 'success' && data.url) {
        console.log(`[music] Cobalt (${endpoint}) returned direct audio URL.`);
        return data.url;
      }
      if (data.status === 'tunnel' && data.url) {
        console.log(`[music] Cobalt (${endpoint}) returned tunnel URL.`);
        return data.url;
      }
      console.log(`[music] Cobalt (${endpoint}) no URL: ${data.text || data.error || 'unknown'}`);
    } catch (err) {
      console.log(`[music] Cobalt (${endpoint}) failed: ${err.message}`);
    }
  }
  return null;
}

async function ensureYtDlp() {
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    ytdlp.setBinaryPath(process.env.YTDLP_PATH);
    return;
  }
  if (!fs.existsSync(defaultYtDlpPath)) {
    console.log(`[music] Downloading yt-dlp binary for ${process.platform} to ${defaultYtDlpPath}...`);
    fs.mkdirSync(path.dirname(defaultYtDlpPath), { recursive: true });
    const binaryUrl = isWin
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
      : (process.platform === 'darwin'
        ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
        : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp');

    try {
      await downloadFile(binaryUrl, defaultYtDlpPath);
      if (!isWin) fs.chmodSync(defaultYtDlpPath, 0o755);
      console.log(`[music] yt-dlp binary downloaded successfully via direct CDN.`);
    } catch (dlErr) {
      console.error(`[music] Direct binary download failed (${dlErr.message}), attempting YTDlpWrap fallback...`);
      const platformName = isWin ? 'win32' : (process.platform === 'darwin' ? 'mac' : 'linux');
      await YTDlpWrap.downloadFromGithub(defaultYtDlpPath, undefined, platformName);
      if (!isWin) fs.chmodSync(defaultYtDlpPath, 0o755);
    }
  }
  ytdlp.setBinaryPath(defaultYtDlpPath);
}

function normalizeYouTubeUrl(input) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.replace('www.', '').replace('m.', '');
  if (!['youtube.com', 'youtu.be', 'music.youtube.com'].includes(hostname) &&
      !hostname.endsWith('youtube.com') && hostname !== 'youtu.be') return null;

  let videoId = parsed.searchParams.get('v');
  if (hostname === 'youtu.be') videoId = parsed.pathname.slice(1).split(/[?&/]/)[0];
  if (parsed.pathname.startsWith('/shorts/')) videoId = parsed.pathname.split('/')[2]?.split('?')[0];
  if (parsed.pathname.startsWith('/embed/')) videoId = parsed.pathname.split('/')[2]?.split('?')[0];

  // Accept IDs 10-13 chars and trim to 11 (handles accidental extra chars from copy-paste)
  if (videoId && /^[\w-]{10,13}$/.test(videoId)) {
    videoId = videoId.slice(0, 11);
  }

  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// ---------------------------------------------------------------------------
// Mood-based autoplay — each mood maps to several SoundCloud search queries.
// When `!autoplay <mood>` is set, the bot keeps the music going forever by
// picking a random query from that mood whenever the queue runs dry.
// Any custom word works too (e.g. `!autoplay vibecifi` searches it directly).
// ---------------------------------------------------------------------------
const MOODS = {
  tamil:      ['tamil hit songs 2024', 'tamil melody songs', 'tamil kuthu songs', 'anirudh hits', 'tamil evergreen melody', 'tamil love hits', 'tamil mass songs'],
  sad:        ['sad tamil songs', 'sad songs playlist', 'emotional tamil songs', 'sad lofi songs', 'breakup songs tamil', 'sad melody songs'],
  happy:      ['happy feel good songs', 'upbeat tamil songs', 'feel good pop hits', 'happy english songs', 'feel good melody tamil'],
  romantic:   ['tamil romantic hits', 'love songs tamil', 'romantic melody songs', 'tamil love failure songs', 'romantic english hits'],
  lofi:       ['lofi hip hop beats', 'tamil lofi songs', 'lofi study playlist', 'chill lofi mix', 'sleepy lofi beats'],
  party:      ['party songs tamil', 'edm party mix', 'kuthu songs tamil', 'dance hits tamil', 'party english songs'],
  english:    ['top english hits 2024', 'english pop songs', 'billboard hits', 'classic rock hits', 'english acoustic songs'],
  hindi:      ['hindi hit songs 2024', 'bollywood hits', 'hindi melody songs', 'hindi romantic songs', 'hindi party songs'],
  telugu:     ['telugu hit songs', 'telugu melody songs', 'telugu love songs', 'telugu mass songs'],
  malayalam:  ['malayalam hit songs', 'malayalam melody songs', 'malayalam love songs'],
  kannada:    ['kannada hit songs', 'kannada melody songs', 'kannada love songs'],
  punjabi:    ['punjabi hits 2024', 'punjabi party songs', 'punjabi sad songs'],
  kpop:       ['kpop hits 2024', 'kpop girl group', 'kpop boy group', 'kpop chill songs'],
  chill:      ['chill vibes playlist', 'chill acoustic songs', 'relaxing music playlist', 'chill english songs'],
  gym:        ['gym workout songs', 'motivational workout mix', 'phonk gym songs', 'hype workout music'],
  devotional: ['tamil devotional songs', 'bhakti songs', 'tamil god songs', 'devotional morning songs'],
  melody:     ['tamil melody hits', 'evergreen melody songs', 'soft melody playlist', 'ilaiyaraaja melody hits'],
  mass:       ['tamil mass songs', 'tamil intro songs', 'mass beats tamil', 'background score tamil'],
  '90s':      ['90s tamil hits', '90s melody songs', '90s english hits', 'retro songs tamil'],
  remix:      ['tamil remix songs', 'edm remix hits', 'club remix songs', 'slowed reverb songs'],
};

function getMoodQueries(moodKey) {
  if (!moodKey) return null;
  const key = String(moodKey).toLowerCase().trim();
  if (MOODS[key]) return MOODS[key];
  // Unknown/custom mood → use the raw word as the search query itself
  return [key];
}

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    const queue = { connection: null, player, tracks: [], current: null, playing: false, loop: false, volume: 1, lastError: null, autoplayMood: null };
    player.on(AudioPlayerStatus.Idle, () => {
      onTrackEnd(guildId);
      playNext(guildId);
    });
    player.on(AudioPlayerStatus.Playing, () => console.log(`[music:${guildId}] AudioPlayer is PLAYING audio.`));
    player.on('error', (error) => console.error(`[music:${guildId}] player error: ${error.message}`));
    queues.set(guildId, queue);
  }
  return queues.get(guildId);
}

let isPlayDlInitialized = false;
async function initPlayDl() {
  if (isPlayDlInitialized) return;
  try {
    const scClientId = await play.getFreeClientID();
    if (scClientId) {
      await play.setToken({ soundcloud: { client_id: scClientId } });
      console.log('[music] play-dl SoundCloud client_id initialized successfully.');
    }
  } catch (err) {
    console.log(`[music] play-dl SoundCloud client_id init warning: ${err.message}`);
  }
  isPlayDlInitialized = true;
}

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function getPipedAudioStream(videoId) {
  const apis = [
    `https://pipedapi.tokhmi.xyz/streams/${videoId}`,
    `https://pipedapi.kavin.rocks/streams/${videoId}`,
    `https://api.piped.video/streams/${videoId}`
  ];

  for (const apiUrl of apis) {
    try {
      const data = await new Promise((resolve, reject) => {
        https.get(apiUrl, { agent: httpsAgent, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
          });
        }).on('error', reject);
      });

      const audioStreams = data?.audioStreams || [];
      if (audioStreams.length > 0) {
        const bestStream = audioStreams.find(s => s.mimeType?.includes('opus')) || audioStreams[0];
        if (bestStream?.url) {
          const resStream = await new Promise((resolve, reject) => {
            https.get(bestStream.url, { agent: httpsAgent, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
              if (res.statusCode < 400) resolve(res);
              else reject(new Error(`HTTP ${res.statusCode}`));
            }).on('error', reject);
          });
          const probe = await demuxProbe(resStream);
          return { stream: probe.stream, type: probe.type };
        }
      }
    } catch (err) {
      console.log(`[music] Piped API ${apiUrl} failed: ${err.message}`);
    }
  }
  throw new Error('All Piped API audio stream mirrors failed');
}

function cleanSongTitle(title) {
  if (!title) return 'music';
  let clean = title.replace(/@\w+/g, '');
  clean = clean.split('|')[0];
  clean = clean.replace(/\[.*?\]|\(.*?\)/g, '');
  clean = clean.replace(/official music video|official video|lyric video|official audio|music video|video|hd|4k|audio/gi, '');
  clean = clean.replace(/[^\w\s-]/gi, ' ');
  clean = clean.replace(/^[-\s]+/, '');
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean || 'music';
}

async function playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;
  if (queue.tracks.length === 0) {
    queue.current = null;
    queue.playing = false;
    return;
  }

  const track = queue.tracks.shift();
  queue.current = track;
  try {
    await initPlayDl();
    let stream, type;

    // Layer 1: Direct YouTube extraction via yt-dlp — try multiple player clients
    try {
      if (track.url.includes('soundcloud.com')) {
        const scStream = await play.stream(track.url);
        stream = scStream.stream;
        type = scStream.type;
        console.log(`[music:${guildId}] Layer 1 (Direct SoundCloud Stream) succeeded!`);
      } else {
        await ensureYtDlp();
        const cookiePath = ensureCookiesFile();

        let directUrl = null;

        // ---- Attempt A: Cobalt API (fast, works on datacenter IPs) ----
        try {
          const cobaltUrl = await getStreamViaCobalt(track.url);
          if (cobaltUrl) {
            directUrl = cobaltUrl;
            console.log(`[music:${guildId}] Layer 1 (Cobalt API) succeeded!`);
          }
        } catch (cobaltErr) {
          console.log(`[music:${guildId}] Cobalt failed: ${cobaltErr.message}`);
        }

        // ---- Attempt B: yt-dlp multi-player-client chain ----
        if (!directUrl) {
          // YouTube player clients, most-likely-to-bypass-bot-detection first.
          const PLAYER_CLIENTS = [
            'android_vr',
            'tv',
            'ios',
            'web_embedded',
            'android_music',
            'tv_embedded',
            'web_safari',
            'mweb',
          ];

          let lastClientError = null;

          for (const client of PLAYER_CLIENTS) {
            const ytArgs = [
              track.url,
              '--no-playlist',
              '-f', 'ba/b',
              '--get-url',
              '--no-warnings',
              '--socket-timeout', '15',
              '--extractor-args', `youtube:player_client=${client}`,
            ];
            if (cookiePath) ytArgs.push('--cookies', cookiePath);
            try {
              const output = await ytdlp.execPromise(ytArgs);
              const url = (output || '').trim().split(/\s+/)[0];
              if (url && url.startsWith('http')) {
                directUrl = url;
                console.log(`[music:${guildId}] yt-dlp succeeded with player_client=${client}${cookiePath ? ' (+cookies)' : ''}`);
                break;
              }
              lastClientError = new Error(`Empty output for ${client}`);
            } catch (clientErr) {
              lastClientError = clientErr;
              console.log(`[music:${guildId}] player_client=${client} failed: ${clientErr.message.split('\n')[0]}`);
            }
          }

          if (!directUrl) throw lastClientError || new Error('All YouTube player clients + Cobalt failed');
        }

        const audioStream = await new Promise((resolve, reject) => {
          const request = https.get(directUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}`));
            else resolve(res);
          });
          request.on('error', reject);
        });
        const probe = await demuxProbe(audioStream);
        stream = probe.stream;
        type = probe.type;
        console.log(`[music:${guildId}] Layer 1 (Cobalt/yt-dlp) succeeded!`);
      }
    } catch (layer1Err) {
      console.log(`[music:${guildId}] Layer 1 failed (${layer1Err.message}), trying Layer 2 (SoundCloud Mirror with cleaned title)...`);

      // Layer 2: SoundCloud Mirror Engine with cleaned title — try each result until one streams
      try {
        const rawTitle = track.title && track.title !== 'YouTube Track' ? track.title : 'music';
        const cleaned = cleanSongTitle(rawTitle);
        console.log(`[music:${guildId}] Searching SoundCloud mirror for core title: "${cleaned}" (raw: "${rawTitle}")`);

        let scResults = await play.search(cleaned, { source: { soundcloud: 'tracks' }, limit: 5 });

        // Sort: keyword match first, then the rest
        if (scResults && scResults.length > 0) {
          const firstWord = cleaned.split(' ')[0].toLowerCase();
          scResults.sort((a, b) => {
            const aHit = (a.title || a.name || '').toLowerCase().includes(firstWord) ? 0 : 1;
            const bHit = (b.title || b.name || '').toLowerCase().includes(firstWord) ? 0 : 1;
            return aHit - bHit;
          });
        }

        let played = false;
        if (scResults && scResults.length > 0) {
          for (const result of scResults) {
            const scUrl = result.permalink || result.url;
            if (!scUrl) continue;
            try {
              const scStream = await play.stream(scUrl);
              stream = scStream.stream;
              type = scStream.type;
              console.log(`[music:${guildId}] Layer 2 (SoundCloud Mirror: "${result.name || result.title}") succeeded! URL: ${scUrl}`);
              played = true;
              break;
            } catch (err) {
              console.log(`[music:${guildId}] SoundCloud candidate failed (${err.message}), trying next...`);
            }
          }
        }

        if (!played) throw new Error(`No streamable SoundCloud mirror for "${cleaned}"`);
      } catch (layer2Err) {
        console.log(`[music:${guildId}] Layer 2 (SoundCloud Mirror) failed (${layer2Err.message}), trying Layer 3 (Piped API)...`);

        // Layer 3: Piped API proxy
        const videoIdMatch = track.url.match(/(?:v=|\/shorts\/|\/embed\/|youtu\.be\/)([\w-]{11})/);
        const videoId = videoIdMatch ? videoIdMatch[1] : null;

        if (videoId) {
          try {
            const pipedData = await getPipedAudioStream(videoId);
            stream = pipedData.stream;
            type = pipedData.type;
            console.log(`[music:${guildId}] Layer 3 (Piped API) succeeded!`);
          } catch (layer3Err) {
            console.log(`[music:${guildId}] Layer 3 failed (${layer3Err.message}), trying Layer 4 (play-dl)...`);
            const playStream = await play.stream(track.url);
            stream = playStream.stream;
            type = playStream.type;
          }
        } else {
          const playStream = await play.stream(track.url);
          stream = playStream.stream;
          type = playStream.type;
        }
      }
    }

    const resource = createAudioResource(stream, { inputType: type, inlineVolume: true });
    resource.volume.setVolume(queue.volume);
    queue.player.play(resource);
    queue.playing = true;
  } catch (error) {
    const errorMsg = error?.message || (typeof error === 'string' ? error : (error?.statusMessage || String(error))) || 'Unknown audio extraction error';
    console.error(`[music:${guildId}] unable to play ${track.url}:`, errorMsg);
    queue.lastError = errorMsg;
    queue.current = null;
    // Provide helpful guidance for YouTube bot detection errors
    if (errorMsg.includes('Sign in to confirm') || errorMsg.includes('bot')) {
      console.log(`[music:${guildId}] YouTube blocked this request (datacenter IP detected). Try: SoundCloud links, a VPS host, or a YouTube cookies file.`);
    }
    await playNext(guildId);
  }
}

async function onTrackEnd(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.current) return;

  if (queue.loop) {
    queue.tracks.unshift(queue.current);
  } else if (queue.tracks.length === 0 && (queue.autoplayMood || queue.autoplay !== false)) {
    // Pick the search query: mood-based autoplay uses a random query from the
    // mood's query pool; default autoplay continues with the last song's title.
    let query;
    if (queue.autoplayMood) {
      const pool = getMoodQueries(queue.autoplayMood);
      query = pool[Math.floor(Math.random() * pool.length)];
      console.log(`[music:${guildId}] Mood autoplay "${queue.autoplayMood}" → searching "${query}"...`);
    } else {
      query = cleanSongTitle(queue.current.title);
      console.log(`[music:${guildId}] Autoplay active! Searching related tracks for "${query}"...`);
    }
    try {
      await initPlayDl();
      const related = await play.search(query, { limit: 5, source: { soundcloud: 'tracks' } });
      // Pick a random result (skip index 0 to avoid repeating the same top hit)
      const candidates = (related || []).filter(Boolean);
      const nextTrack = candidates.length > 1 ? candidates[1 + Math.floor(Math.random() * (candidates.length - 1))] : candidates[0];
      if (nextTrack) {
        queue.tracks.push({
          title: nextTrack.title || nextTrack.name || 'Related Song',
          url: nextTrack.url || nextTrack.permalink,
          thumbnail: nextTrack.thumbnail || null
        });
        console.log(`[music:${guildId}] Autoplay queued next song: "${nextTrack.title || nextTrack.name}"`);
      }
    } catch (err) {
      console.log(`[music:${guildId}] Autoplay warning: ${err.message}`);
    }
  }

  queue.current = null;
}

async function addTrack(context, url) {
  const member = context.member;
  const guild = context.guild;
  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel) return 'Join a voice channel first.';

  await initPlayDl();
  const cleanUrl = normalizeYouTubeUrl(url);
  let title = url;
  let thumbnail = null;
  let finalUrl = cleanUrl;

  if (cleanUrl) {
    // It's a valid YouTube URL — fetch title via play-dl or oEmbed
    title = 'YouTube Track';
    try {
      const info = await play.video_info(cleanUrl);
      title = info.video_details?.title || title;
      thumbnail = info.video_details?.thumbnails?.[0]?.url || thumbnail;
    } catch (err) {
      console.log(`[music] play.video_info failed (${err.message}), using YouTube oEmbed fallback...`);
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`;
        const oembedData = await new Promise((resolve, reject) => {
          https.get(oembedUrl, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
          }).on('error', reject);
        });
        title = oembedData.title || title;
        thumbnail = oembedData.thumbnail_url || thumbnail;
      } catch (oembedErr) {
        console.error('[music] oEmbed fallback failed:', oembedErr.message);
      }
    }
  } else if (url.startsWith('https://soundcloud.com/') || url.startsWith('http://soundcloud.com/')) {
    // It's a direct SoundCloud permalink URL (e.g. selected from autocomplete)
    console.log(`[music] Direct SoundCloud URL detected: ${url}`);
    finalUrl = url;
    try {
      const scInfo = await play.soundcloud(url);
      title = scInfo.name || scInfo.title || url;
      thumbnail = scInfo.thumbnail || null;
      console.log(`[music] SoundCloud track info resolved: "${title}"`);
    } catch (infoErr) {
      console.log(`[music] SoundCloud info fetch warning: ${infoErr.message} — using URL as title`);
      title = url.split('/').pop().replace(/-/g, ' ');
    }
  } else if (/youtube\.com|youtu\.be/i.test(url)) {
    // Looks like a YouTube URL but couldn't be parsed — give a clear error rather than searching
    console.log(`[music] Unparseable YouTube URL: ${url}`);
    return `❌ Could not parse that YouTube URL. Please double-check it and try again.`;
  } else {
    // It's a plain text search query — find best match on SoundCloud
    console.log(`[music] Input is a search query: "${url}". Searching SoundCloud...`);
    try {
      const scResults = await play.search(url, { source: { soundcloud: 'tracks' }, limit: 1 });
      if (!scResults || scResults.length === 0) throw new Error('No SoundCloud results found');
      const best = scResults[0];
      title = best.name || best.title || url;
      thumbnail = best.thumbnail || null;
      finalUrl = best.permalink || best.url;  // use permalink — api.soundcloud.com URLs are not streamable
      console.log(`[music] SoundCloud search resolved "${url}" => "${title}" at ${finalUrl}`);
    } catch (scErr) {
      return `Could not find any track matching: **${url}**. Try a YouTube URL or a more specific search term.`;
    }
  }

  const queue = getQueue(guild.id);
  queue.tracks.push({
    title,
    url: finalUrl,
    thumbnail
  });
  queue.connection ??= joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false
  });
  queue.connection.on('stateChange', (oldState, newState) => {
    console.log(`[voice:${guild.id}] ${oldState.status} -> ${newState.status}`);
  });
  queue.connection.on('debug', (debugMessage) => {
    console.log(`[voice:${guild.id}] ${debugMessage}`);
  });
  queue.connection.on('error', (error) => {
    if (error.code !== 'ABORT_ERR') console.error(`[voice:${guild.id}] connection error: ${error.message}`);
  });
  try {
    await entersState(queue.connection, VoiceConnectionStatus.Ready, 30_000);
  } catch (error) {
    const state = queue.connection.state.status;
    queue.connection.destroy();
    queue.connection = null;
    const reason = state === VoiceConnectionStatus.Destroyed
      ? 'Discord closed the voice session before it started. Use a normal voice channel (not a Stage channel), check the bot role and channel overrides, and ensure only one bot process is running.'
      : state === VoiceConnectionStatus.Signalling || state === VoiceConnectionStatus.Connecting
        ? 'Discord voice UDP handshake did not complete. Check the voice channel permissions, disable VPN/firewall blocking for Node.js, and try another voice channel.'
        : `Connection stopped in ${state} state.`;
    throw new Error(`Voice connection failed. ${reason}`);
  }
  queue.connection.subscribe(queue.player);
  if (!queue.playing) {
    await playNext(guild.id);
    if (!queue.playing) return `Could not play that URL. ${queue.lastError || 'Check that the YouTube video is public and playable.'}`;
  }
  return `Queued: **${title}**`;
}

async function connect(message) {
  const voiceChannel = message.member?.voice.channel;
  if (!voiceChannel) return 'Join a voice channel first.';
  const queue = getQueue(message.guild.id);
  if (queue.connection?.state.status === VoiceConnectionStatus.Ready) return `Already connected to **${voiceChannel.name}**.`;
  queue.connection ??= joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false
  });
  // Log voice connection state changes and errors (same handlers as addTrack).
  queue.connection.on('stateChange', (oldState, newState) => {
    console.log(`[voice:${message.guild.id}] ${oldState.status} -> ${newState.status}`);
  });
  queue.connection.on('debug', (debugMessage) => {
    console.log(`[voice:${message.guild.id}] ${debugMessage}`);
  });
  queue.connection.on('error', (error) => {
    if (error.code !== 'ABORT_ERR') console.error(`[voice:${message.guild.id}] connection error: ${error.message}`);
  });
  try {
    await entersState(queue.connection, VoiceConnectionStatus.Ready, 30_000);
    // CRITICAL: subscribe the audio player to the connection. Without this the
    // player "plays" into the void — voice joins, stream loads, but silence.
    queue.connection.subscribe(queue.player);
    return `Connected to **${voiceChannel.name}**. Now use \`!play <YouTube URL>\`.`;
  } catch {
    queue.connection.destroy();
    queue.connection = null;
    return 'Voice connection failed. Use a normal Voice Channel and check Connect, Speak, and Use Voice Activity permissions.';
  }
}

function skip(guildId) {
  const queue = queues.get(guildId);
  if (!queue || (!queue.current && queue.tracks.length === 0)) return false;
  queue.current = null;
  queue.player.stop();
  return true;
}

function pause(guildId) {
  return queues.get(guildId)?.player.pause() ?? false;
}

function resume(guildId) {
  return queues.get(guildId)?.player.unpause() ?? false;
}

function setLoop(guildId, enabled) {
  const queue = getQueue(guildId);
  queue.loop = enabled;
  return queue.loop;
}

function setVolume(guildId, value) {
  const queue = getQueue(guildId);
  queue.volume = Math.max(0, Math.min(2, value / 100));
  return Math.round(queue.volume * 100);
}

function status(guildId) {
  const queue = queues.get(guildId);
  return queue ? {
    current: queue.current,
    tracks: queue.tracks,
    loop: queue.loop,
    volume: Math.round(queue.volume * 100),
    playing: queue.playing,
    paused: queue.player.state.status === AudioPlayerStatus.Paused
  } : null;
}

async function search(query) {
  try {
    await initPlayDl();
    const scResults = await play.search(query, { limit: 10, source: { soundcloud: 'tracks' } });
    if (scResults && scResults.length > 0) {
      return scResults.map((result) => ({
        title: result.name || result.title || 'Audio Track',
        url: result.permalink || result.url,  // permalink is the proper soundcloud.com URL
        duration: result.durationInSec ? `${Math.floor(result.durationInSec / 60)}:${String(result.durationInSec % 60).padStart(2, '0')}` : 'Track'
      }));
    }
  } catch (err) {
    console.log(`[search] SoundCloud search warning: ${err.message}`);
  }

  try {
    const ytResults = await play.search(query, { limit: 10, source: { youtube: 'video' } });
    return ytResults.map((result) => ({ title: result.title, url: result.url, duration: result.durationRaw }));
  } catch (err) {
    console.error(`[search] YouTube search error: ${err.message}`);
    return [];
  }
}

function stop(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return false;
  queue.tracks = [];
  queue.current = null;
  queue.playing = false;
  queue.player.stop();
  return true;
}

function leave(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return false;
  queue.player.stop();
  queue.connection?.destroy();
  queue.current = null;
  queue.tracks = [];
  queue.playing = false;
  queues.delete(guildId);
  return true;
}

function list(guildId) {
  return queues.get(guildId)?.tracks ?? [];
}

// ---------------------------------------------------------------------------
// Mood autoplay controls — used by the !autoplay command in index.js
// ---------------------------------------------------------------------------
function setAutoplayMood(guildId, mood) {
  const queue = getQueue(guildId);
  queue.autoplayMood = mood || null;
  return queue.autoplayMood;
}

function getAutoplayMood(guildId) {
  return queues.get(guildId)?.autoplayMood ?? null;
}

// Immediately search a mood and queue `count` tracks so playback can start
// right away when the user types `!autoplay <mood>` with an empty queue.
async function queueMoodTracks(guildId, mood, count = 2) {
  const pool = getMoodQueries(mood);
  if (!pool) return 0;
  await initPlayDl();
  let added = 0;
  const seen = new Set();
  for (let attempt = 0; attempt < 3 && added < count; attempt++) {
    const query = pool[Math.floor(Math.random() * pool.length)];
    try {
      const results = await play.search(query, { limit: 10, source: { soundcloud: 'tracks' } });
      for (const result of results || []) {
        const url = result.permalink || result.url;
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const queue = getQueue(guildId);
        queue.tracks.push({
          title: result.name || result.title || 'Mood Track',
          url,
          thumbnail: result.thumbnail || null
        });
        added++;
        if (added >= count) break;
      }
    } catch (err) {
      console.log(`[music:${guildId}] Mood search "${query}" failed: ${err.message}`);
    }
  }
  console.log(`[music:${guildId}] Mood "${mood}" queued ${added} track(s).`);
  return added;
}

function listMoods() {
  return Object.keys(MOODS);
}

// ---------------------------------------------------------------------------
// Interactive queue management — powers the "Similar Songs" add buttons and
// the "remove from queue" select menu in the dashboard.
// ---------------------------------------------------------------------------
// Add a track (already resolved title + URL) directly to the queue.
function addUrlTrack(guildId, title, url, thumbnail = null) {
  const queue = getQueue(guildId);
  queue.tracks.push({ title, url, thumbnail });
  return queue.tracks.length;
}

// Remove the first queued track matching the given URL. Returns the removed
// track (with title) or null if not found.
function removeTrack(guildId, url) {
  const queue = queues.get(guildId);
  if (!queue) return null;
  const index = queue.tracks.findIndex((t) => t.url === url);
  if (index === -1) return null;
  const [removed] = queue.tracks.splice(index, 1);
  return removed;
}

// Start playback only if the bot is connected and currently idle.
async function playNextIfIdle(guildId) {
  const queue = queues.get(guildId);
  if (!queue || queue.playing) return;
  if (!queue.connection || queue.connection.state.status !== VoiceConnectionStatus.Ready) return;
  await playNext(guildId);
}

// One-shot `!autoplay <mood>` handler: joins the user's voice channel, sets the
// mood, immediately queues tracks, and starts playback. Returns a status string.
async function startMoodAutoplay(message, mood) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return '❌ Join a voice channel first, then use `!autoplay <mood>`.';

  // Reuse connect() to join voice with all the error handling/logging intact
  const connectResult = await connect(message);
  if (connectResult.startsWith('Voice connection failed') || connectResult.startsWith('❌')) {
    return connectResult;
  }

  const guildId = message.guild.id;
  const added = await queueMoodTracks(guildId, mood, 2);
  if (added === 0) {
    return `⚠️ Couldn't find any tracks for mood **${mood}**. Try one of: ${Object.keys(MOODS).join(', ')}`;
  }
  setAutoplayMood(guildId, mood);

  const queue = getQueue(guildId);
  // Defensive: make sure the player is subscribed even if connect() was a no-op
  // ("Already connected") from a path that never subscribed.
  queue.connection?.subscribe(queue.player);
  if (!queue.playing) await playNext(guildId);

  if (!queue.playing) {
    return `⚠️ Queued mood tracks but playback failed. ${queue.lastError || 'Try again or use a SoundCloud link.'}`;
  }
  return `♾️ **Mood autoplay: ${mood}** — queued ${added} track(s) and started playing. The bot will keep playing ${mood} songs forever. Use \`!autoplay off\` to stop.`;
}

module.exports = { addTrack, connect, normalizeYouTubeUrl, skip, pause, resume, setLoop, setVolume, status, search, onTrackEnd, stop, leave, list, setAutoplayMood, getAutoplayMood, queueMoodTracks, startMoodAutoplay, listMoods, addUrlTrack, removeTrack, playNextIfIdle, cleanSongTitle };
