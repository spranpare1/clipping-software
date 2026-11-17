# Stream Clipper

The primary project in this repository is now **Stream Clipper**: a local-first app for watching up to five streams captured in OBS, scoring chat/audio moments, and saving replay clips for review. The earlier Splice Studio upload/import application is preserved in [`legacy/splice-studio/`](legacy/splice-studio/).

## Current implementation

- Five persistent agent slots with per-agent stream labels, chat configuration, replay settings, and activity history. All agents use one shared clip-criteria profile; edit it once in the dashboard to update all five.
- OBS WebSocket connection, Replay Buffer start/status, manual replay save, download, and reconnect after an OBS restart or dropped connection.
- Twitch chat reading over Twitch's secure IRC WebSocket using a user OAuth token with `chat:read`.
- YouTube Live chat reading through the official Live Chat Messages API, honoring the API's returned polling interval.
- Explainable moment score combines Twitch/YouTube chat bursts, repeated vote replies, emote/high-energy spam, YouTube poll events, and (when configured) sustained OBS audio peaks. Overlapping independent signals raise the score. Automatic saving is opt-in per agent; a global stop cancels pending saves for all agents.
- Each agent targets roughly 180 seconds and delays saves by 20 seconds by default to include reaction context. Set that agent's OBS Replay Buffer to the configured duration; saves wait the post-trigger setting before asking OBS to write the rolling buffer.
- Every saved replay enters a persistent, single-worker formatting queue. FFmpeg creates an MP4 in the selected output ratio; ffprobe checks the rendered dimensions, duration, and audio. The original is preserved, and formatted outputs appear under `clips/<agent-id>/formatted/`.
- The automatic layout keeps the entire source visible over a blurred background fill, so it never guesses a face or cuts off gameplay. It does not yet detect speakers, track subjects, recognize content types, or add captions.
- Formatting continues when the browser tab closes. Queued or interrupted jobs resume when the service restarts. Failed jobs show the error and can be retried from the dashboard.
- Clips and configuration are stored in this directory.
- Browser shortcut `Ctrl+Shift+S` saves a replay for the first enabled, connected agent while the dashboard tab has focus.

The shared criteria box stores the selection rules for all five agents. The implemented detector covers chat signals, YouTube poll events, and loud audio bursts from a named OBS input. Loudness is only an audio-intensity signal; it does not classify laughter, rage, exhaustion, or other emotions. Detecting streamer phrases such as “clip that,” spoken polls/questions, and emotional speech requires a live speech-to-text source, which is not connected yet. Visual event recognition, context-aware trimming, captions, editing, and social publishing are also not implemented. The first publishing workflow will be review-first; the publishing panel is intentionally marked unavailable until official account integrations are built.

## Architecture

- **Local API and dashboard:** Node.js 22+ built-in HTTP server and browser JavaScript, bound only to `127.0.0.1`.
- **Capture and rolling buffer:** OBS Studio 28+ with its official obs-websocket protocol and Replay Buffer. Configure an OBS Browser Source or Window/Display Capture to show the stream. This captures the OBS scene, not a downloaded platform video file.
- **Chat events:** Twitch secure IRC WebSocket (`chat:read`) and YouTube Live Chat Messages API (authorized bearer token and a broadcast `liveChatId`).
- **Audio event signal:** OBS high-volume `InputVolumeMeters` events, filtered to the exact source name entered on that agent. The threshold is configurable in dBFS and is intended to find sustained loud bursts, not understand their meaning.
- **Persistence:** Local JSON files in `data/` and media in `clips/`. Both are ignored by Git. Clip state updates use atomic file replacement.
- **Background work:** The Node service stays running after the browser closes. OBS maintains the rolling buffer; a single FFmpeg worker formats clips sequentially to limit resource use. The process must remain running for chat monitoring and active rendering; interrupted formatting resumes when it is started again.

Running five agents means running five OBS instances (or otherwise providing five separately addressable OBS WebSocket endpoints), each with a separate stream capture and Replay Buffer. This can be resource intensive. The actual buffer duration and disk consumption are controlled by OBS settings and the local disk. The app does not set an artificial source-video duration limit.

## Setup on Windows or macOS

1. Install Node.js 22 or newer, OBS Studio 28 or newer, Git, and FFmpeg (including `ffprobe`). Make sure `ffmpeg` and `ffprobe` work from a new terminal, or set `FFMPEG_PATH` and `FFPROBE_PATH` in `.env` to their full paths. Windows builds are available from the FFmpeg download page; macOS users can install with Homebrew (`brew install ffmpeg`).
2. Clone the repository and run commands from its root, or run `git pull` in an existing clone:

   ```powershell
   git clone https://github.com/spranpare1/clipping-software.git
   cd clipping-software
   ```

3. In OBS, add a Browser Source or Window/Display Capture for each stream, configure audio, and enable **Tools → WebSocket Server Settings**. Set a password and port. In **Settings → Output → Replay Buffer**, enable Replay Buffer and choose a duration and save path. For previews, use OBS Hybrid MP4 output; MKV is saved and downloadable but may not preview in a browser.
4. For multiple streams, start separate OBS instances and give each its own WebSocket port, stream source, replay buffer, and output folder. Enter the corresponding port in each agent card.
5. Copy `.env.example` to `.env` and add credentials for the chat providers you want. Keep `.env` private. Do not put OAuth client secrets in the browser.
6. From the repository root, start the app:

   **Windows PowerShell**

   ```powershell
   Copy-Item .env.example .env
   npm start
   ```

   **macOS / Linux**

   ```sh
   cp .env.example .env
   npm start
   ```

7. Open <http://127.0.0.1:4179>, set each agent's source and chat source, enter the shared clip criteria once, then connect the agents to OBS. The password entered in the page is kept only in the running process; environment variables are better for unattended use (`OBS_PASSWORD_AGENT_1`, etc.).

To reach the dashboard from your other devices privately, connect those devices to your Tailscale network and run `tailscale serve --bg 4179` on the capture PC. Open the HTTPS address it prints. Do not expose this app with Tailscale Funnel or router port forwarding; it does not have its own login system yet.

## Chat credentials

### Twitch

Set `TWITCH_NICK` to the Twitch account name and `TWITCH_OAUTH_TOKEN` to a user access token authorized for `chat:read`. This one account can join the channels configured on enabled agent slots. Twitch may require the authenticated account to have access to a channel's chat.

### YouTube Live

Set `YOUTUBE_ACCESS_TOKEN` to a valid Google OAuth access token with YouTube Data API access. Put the broadcast's `liveChatId` into that agent's YouTube field. Access tokens expire; this initial version does not refresh them automatically, so unattended YouTube chat monitoring requires a refreshed token. Google API project setup, API enablement, quota, and chat permissions apply.

Missing or expired credentials leave the provider disconnected and create an error in the agent activity log; they do not produce fake activity or saves.

## Operating notes and limits

- The OBS Replay Buffer duration determines how much footage is included before you trigger a save. The `preRollSeconds` value is stored as a workflow preference; this version does not change OBS's buffer duration. Configure OBS's Replay Buffer duration directly.
- The browser shortcut works while the dashboard tab has focus. For a system-wide hotkey, use OBS's own **Save Replay** hotkey or add a native desktop tray wrapper in a later step.
- Each save copies OBS's last replay file into `clips/<agent-id>/`, then creates a formatted MP4 in `clips/<agent-id>/formatted/`. The dashboard previews/downloads the formatted output and retains a download for the original. Free disk space is the limiting factor; clear old clips when needed.
- Choose the output aspect ratio in each agent's settings. The first formatter supports 9:16, 1:1, 4:5, and 16:9, preserving the whole original frame with a blurred fill. It is not yet platform-specific validation and does not add captions or content-aware subject tracking.
- Keep OBS and this local service running during an unattended session. The dashboard itself can close.
- Chat and audio spike matching is heuristic and can produce false positives. Start with automatic saving off, review event logs, and tune each agent's message window and audio threshold before enabling it.
- The current app captures the OBS scene. It does not bypass platform restrictions or fetch media from a stream URL. Use content you have the rights and account permission to capture.

## Official references

- [OBS WebSocket protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md)
- [Twitch Chat and Chatbots](https://dev.twitch.tv/docs/chat/)
- [YouTube Live Chat Messages: list](https://developers.google.com/youtube/data/live/reference/rest/v3/liveChatMessages/list)
- [FFmpeg](https://ffmpeg.org/download.html)

## Publishing roadmap

Publishing is a separate phase. YouTube, TikTok, Instagram, and Facebook need platform-specific OAuth consent, permissions/approval, upload handling, and status checks. Add one official integration at a time; until then, use the downloaded clip with the platform's own uploader.

## Previous project

The former Splice Studio project is archived under `legacy/splice-studio/`. Its own README and package files remain there for reference; the repository-root `npm start` now launches Stream Clipper.
