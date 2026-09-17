# D4C Discord Bot

**D4C** is a multipurpose Discord bot with silent bold announcements, YouTube music playback, interactive controls, and voice recording.

## Setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set `DISCORD_TOKEN`.
4. Set `OWNER_IDS` to your Discord user ID (comma-separated for multiple initial owners).
5. Optionally set `ANNOUNCEMENT_CHANNEL_ID` to restrict announcements to one channel.
6. In the Discord Developer Portal, enable the **Message Content Intent** and add the bot with permissions to view/send messages, manage messages, connect to voice, and speak.
7. Start with `npm start`.

## Commands

- `!ann <content>` or an attached image/file deletes the command and posts bold content/attachments in the same channel. Long text and more than 10 attachments are split into multiple messages. Only verified owners can trigger it; the bot needs Manage Messages to delete the original command.
- `!addowner <Discord user ID>` verifies a server member and grants full bot access. Only a verified owner or server Administrator can use it.
- `!removeowner <Discord user ID>` removes a stored owner. `!owners` lists verified owners.
- `!sendall <message>` or attached image/file sends the content and attachments to every human member in the current server. It uses one edited progress message showing `Sent: current/total` and `Failed: count`, then leaves the final summary in that same message. Long text and more than 10 attachments are split automatically. Only verified owners can use it; closed DMs are counted as failures.
- `!join` or `!connect` joins your current voice channel without playing audio. Use this first if you want to test the voice connection.
- `!leave` or `!disconnect` leaves voice and clears the music queue.
- `!play <YouTube URL>` joins your voice channel and queues audio.
- `!search <song name>` searches YouTube and returns clickable video links.
- `!music`, `!panel`, or `!player` opens the live D4C music panel.
- `!now` opens the current track, player state, and upcoming queue panel.
- `!pause`, `!resume`, `!skip`, `!stop`, `!queue`, `!loop on/off`, `!volume 0-200`, `!help`
- `!record` records the invoking member's voice to `recordings/` as PCM audio.
- `!stoprecord` stops and saves the active recording.

The `!ann` command intentionally sends no confirmation reply and always posts to the exact channel where it was typed. Link previews are suppressed, and `@everyone`/role/user mentions are disabled in the announcement output. Identical content/attachments in the same channel are ignored for 10 minutes by default to prevent accidental duplicate announcements. `ANNOUNCEMENT_CHANNEL_ID` is not used for this command.

All normal bot commands and music-panel buttons are restricted to verified owners. Put the first owner ID in `OWNER_IDS`, then use `!addowner <user ID>` in Discord. Never paste the bot token into chat or commit it; if exposed, reset it immediately in the Discord Developer Portal.

`!sendall` sends up to 50 member DMs in parallel by default with no batch delay. Discord rate limits, server size, and closed DMs can make delivery slower; exact delivery time cannot be guaranteed, and increasing concurrency too far can cause rate-limit failures. Use it only for useful server notices and make sure members have agreed to receive server DMs. Adjust `SENDALL_DELAY_MS` and `SENDALL_CONCURRENCY` carefully. If it says `Members didn't arrive in time`, enable **Server Members Intent** under Developer Portal → Bot, restart the bot, and try again.

Music commands use a persistent embed panel with **PLAYING NOW**, **PAUSED**, or **IDLE** status, current-song thumbnail, clickable YouTube title, next five tracks, queue count, volume, loop state, and Pause/Resume/Next/Loop/Stop/Refresh Queue buttons. Discord bots can send a YouTube link and play its audio in a voice channel, but they cannot render the video's picture inside a Discord voice channel.

## Always online

Run the bot with a process manager or hosting service that restarts it after a crash, such as PM2, Docker, Railway, Render, or a VPS. A local computer must remain on for the bot to stay online. The bot logs Discord errors and unhandled promise failures so a process manager can restart it.

Voice recording requires the bot to have **Connect**, **Speak**, and **Use Voice Activity** permissions. PCM files can be converted to WAV or MP3 with FFmpeg.

If `!play` reports a voice connection timeout, check that the bot role has **View Channel**, **Connect**, **Speak**, and **Use Voice Activity** in the target voice channel, then restart with `npm start`. The user running `!play` must also be connected to that voice channel. The terminal logs voice states such as `signalling -> connecting -> ready`; if it loops between `signalling` and `connecting`, allow Node.js through Windows Firewall, disable VPN/proxy/third-party firewall temporarily, and try another voice channel or server. This state means the Discord voice UDP handshake failed, not that the YouTube URL is invalid.

YouTube audio uses the project-local `yt-dlp` and FFmpeg binaries and ignores playlist parameters, so a URL such as `watch?v=VIDEO_ID&list=...` plays only that video. Both binaries are ignored by Git. On a new machine, run `npm install`, then download yt-dlp with `node -e "const YTDlpWrap=require('yt-dlp-wrap').default; YTDlpWrap.downloadFromGithub('tools/yt-dlp.exe', undefined, 'win32')"`, or set `YTDLP_PATH` to an installed executable.
