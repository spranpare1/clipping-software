# Stream Clipper Agent — Change Report

**Subject:** Stream Clipper Agent changes

Stream Clipper is now the primary app in the repository root. The earlier Splice Studio project is preserved in `legacy/splice-studio/`.

## Added

- Dashboard for up to five streamer agents, each with its own OBS connection, chat source, settings, logs, and saved clips; all agents share one criteria profile.
- OBS Replay Buffer integration for rolling capture, manual replay saves, downloads, previews for browser-compatible files, and OBS reconnect handling.
- Optional Twitch chat monitoring and YouTube Live chat monitoring using authorized credentials.
- Moment scoring for chat bursts, repeated vote replies, emote/high-energy spam, YouTube poll events, and sustained loudness peaks from a configured OBS audio source. Overlapping signals increase the score.
- Approximate three-minute clip target with a configurable post-trigger delay, per-agent automatic saves, a global stop control, and overlap suppression.
- Local setup documentation, environment-variable example, and six unit tests.

## Not implemented yet

- Live speech transcription, so spoken “clip that” requests, streamer-spoken questions/polls, and emotion classification are not detected yet. Audio peaks measure loudness only.
- Visual event recognition, context-aware trimming, caption generation, and automated publishing to YouTube, TikTok, Instagram, or Facebook.
- OAuth account connection and token refresh flows for chat or publishing providers.

Each active agent needs a separate OBS WebSocket endpoint and Replay Buffer. The OBS Replay Buffer duration must be set to the agent's target duration. The local service must keep running for unattended chat monitoring and saves.

## Verification and commits

- Six unit tests pass; JavaScript syntax checks pass.
- A live local-server smoke test was blocked because this execution environment denied binding to a local port.
- `e7c289e` — Add isolated multi-stream clipper agent
- `bae4a2d` — Add multi-signal highlight scoring and clip context

## Email draft

To: skypranpare@gmail.com

The Stream Clipper Agent is now in its own `stream-clipper/` folder, separate from the existing app. It supports five OBS-connected agent slots, Replay Buffer saves, optional Twitch/YouTube chat monitoring, and automatic moment scoring from chat activity, polls, and configured loud audio peaks. Clips target about three minutes, with an adjustable delay to capture reactions. Six tests pass.

Live speech transcription, spoken clip requests, emotion classification, video event recognition, and automatic social publishing are not connected yet. Each agent needs its own OBS endpoint and the Replay Buffer duration must be set in OBS. The changes are committed as `e7c289e` and `bae4a2d`.
