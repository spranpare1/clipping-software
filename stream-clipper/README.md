# Stream Clipper Agent

A local-first desktop-side service for saving moments from livestreams already playing in OBS. It can run up to five independent agent slots. Each slot uses a separate OBS WebSocket endpoint and Replay Buffer so clips do not get mixed between streams.

## Current implementation

- Five persistent agent slots with per-agent source labels, criteria, chat configuration, replay settings, and activity history. New slots include the provided 3-minute highlight rubric.
- OBS WebSocket connection, Replay Buffer start/status, manual replay save, download, and reconnect after an OBS restart or dropped connection.
- Twitch chat reading over Twitch's secure IRC WebSocket using a user OAuth token with `chat:read`.
- YouTube Live chat reading through the official Live Chat Messages API, honoring the API's returned polling interval.
- Explainable moment score combines Twitch/YouTube chat bursts, repeated vote replies, emote/high-energy spam, YouTube poll events, and (when configured) sustained OBS audio peaks. Overlapping independent signals raise the score. Automatic saving is opt-in per agent; a global stop cancels pending saves for all agents.
- Each agent targets roughly 180 seconds and delays saves by 20 seconds by default to include reaction context. Set that agent's OBS Replay Buffer to the configured duration; saves wait the post-trigger setting before asking OBS to write the rolling buffer.
- Server keeps running when the browser tab closes. Clips and configuration are stored in this directory.
- Browser shortcut `Ctrl+Shift+S` saves a replay for the first enabled, connected agent while the dashboard tab has focus.

The agent criteria box stores event instructions, while the current implemented detector covers chat signals, YouTube poll events, and loud audio bursts from a named OBS input. Loudness is only an audio-intensity signal; it does not classify laughter, rage, exhaustion, or other emotions. Detecting streamer phrases such as “clip that,” spoken polls/questions, and emotional speech requires a live speech-to-text source, which is not connected yet. Visual event recognition, context-aware trimming, captions, editing, and social publishing are also not implemented. The publishing panel is intentionally marked unavailable; it never claims a post was uploaded.

## Architecture

- **Local API and dashboard:** Node.js 22+ built-in HTTP server and browser JavaScript, bound only to `127.0.0.1`.
- **Capture and rolling buffer:** OBS Studio 28+ with its official obs-websocket protocol and Replay Buffer. Configure an OBS Browser Source or Window/Display Capture to show the stream. This captures the OBS scene, not a downloaded platform video file.
- **Chat events:** Twitch secure IRC WebSocket (`chat:read`) and YouTube Live Chat Messages API (authorized bearer token and a broadcast `liveChatId`).
- **Audio event signal:** OBS high-volume `InputVolumeMeters` events, filtered to the exact source name entered on that agent. The threshold is configurable in dBFS and is intended to find sustained loud bursts, not understand their meaning.
- **Persistence:** Local JSON files in `data/` and media in `clips/`. Both are ignored by Git.
- **Background work:** The Node service stays running after the browser closes. OBS maintains the rolling buffer. The process must remain running for chat automation; configure it to launch at login if you need unattended starts.

Running five agents means running five OBS instances (or otherwise providing five separately addressable OBS WebSocket endpoints), each with a separate stream capture and Replay Buffer. This can be resource intensive. The actual buffer duration and disk consumption are controlled by OBS settings and the local disk. The app does not set an artificial source-video duration limit.

## Setup

1. Install Node.js 22 or newer and OBS Studio 28 or newer.
2. Copy `.env.example` to `.env` and add credentials for the chat providers you want. Keep `.env` private. Do not put OAuth client secrets in the browser.
3. In OBS, add a Browser Source or Window/Display Capture for each stream, configure audio, and enable **Tools → WebSocket Server Settings**. Set a password and port. In **Settings → Output → Replay Buffer**, enable Replay Buffer and choose a duration and save path. For previews, use OBS Hybrid MP4 output; MKV is saved and downloadable but may not preview in a browser.
4. For multiple streams, start separate OBS instances and give each its own WebSocket port, stream source, replay buffer, and output folder. Enter the corresponding port in each agent card.
5. Start the app:

   ```sh
   cd stream-clipper
   cp .env.example .env
   # edit .env, then:
   npm start
   ```

6. Open <http://127.0.0.1:4179>, set each agent's source/criteria and chat source, then connect it to OBS. The password entered in the page is kept only in the running process; environment variables are better for unattended use (`OBS_PASSWORD_AGENT_1`, etc.).

## Chat credentials

### Twitch

Set `TWITCH_NICK` to the Twitch account name and `TWITCH_OAUTH_TOKEN` to a user access token authorized for `chat:read`. This one account can join the channels configured on enabled agent slots. Twitch may require the authenticated account to have access to a channel's chat.

### YouTube Live

Set `YOUTUBE_ACCESS_TOKEN` to a valid Google OAuth access token with YouTube Data API access. Put the broadcast's `liveChatId` into that agent's YouTube field. Access tokens expire; this initial version does not refresh them automatically, so unattended YouTube chat monitoring requires a refreshed token. Google API project setup, API enablement, quota, and chat permissions apply.

Missing or expired credentials leave the provider disconnected and create an error in the agent activity log; they do not produce fake activity or saves.

## Operating notes and limits

- The OBS Replay Buffer duration determines how much footage is included before you trigger a save. The `preRollSeconds` value is stored as a workflow preference; this version does not change OBS's buffer duration. Configure OBS's Replay Buffer duration directly.
- The browser shortcut works while the dashboard tab has focus. For a system-wide hotkey, use OBS's own **Save Replay** hotkey or add a native desktop tray wrapper in a later step.
- Each save copies OBS's last replay file into `clips/<agent-id>/`. Free disk space is the limiting factor; clear old clips when needed.
- Keep OBS and this local service running during an unattended session. The dashboard itself can close.
- Chat and audio spike matching is heuristic and can produce false positives. Start with automatic saving off, review event logs, and tune each agent's message window and audio threshold before enabling it.
- The current app captures the OBS scene. It does not bypass platform restrictions or fetch media from a stream URL. Use content you have the rights and account permission to capture.

## Official references

- [OBS WebSocket protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md)
- [Twitch Chat and Chatbots](https://dev.twitch.tv/docs/chat/)
- [YouTube Live Chat Messages: list](https://developers.google.com/youtube/data/live/reference/rest/v3/liveChatMessages/list)

## Publishing roadmap

Publishing is a separate phase. YouTube, TikTok, Instagram, and Facebook need platform-specific OAuth consent, permissions/approval, upload handling, and status checks. Add one official integration at a time; until then, use the downloaded clip with the platform's own uploader.
