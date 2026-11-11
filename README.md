# Splice Studio

A single-user, local-first video clipping application. It accepts uploaded files, direct HTTPS video-file links, authorized YouTube account exports, Twitch Clip links, and user-selected Twitch VOD segments. It creates clips with FFmpeg in server-side workers and supports OAuth publishing to YouTube and TikTok when you provide provider credentials.

## Architecture

- **Frontend:** React + Vite dashboard.
- **API and worker:** Node.js + Express. SQLite-backed jobs continue after closing the browser; long tasks run in a separate server process from the browser.
- **Database:** SQLite migrations in `server/migrations/` store projects, upload/import checkpoints, transcripts, edits, social tokens, publishing jobs, workflows, and activity.
- **Media storage:** local filesystem under `DATA_DIR` (default `./data`). Source files and rendered clips are private local files; the clip preview/download API serves generated clips.
- **Media engine:** FFmpeg and ffprobe for chunk assembly, scene detection, audio analysis, transcoding, crops, layouts, and renders.
- **Live capture:** FFmpeg's RTMP listener records an incoming creator-owned stream as Matroska on local disk. Stop the encoder and finish the recording to add it to Projects. This accepts your encoder output; it does not ingest a Twitch or YouTube watch/player URL.
- **Speech:** optional OpenAI transcription, called only from the server with `OPENAI_API_KEY`. Audio is segmented into 8-minute MP3 chunks to stay below the transcription upload limit. Word-level timestamps currently use `whisper-1`, which supports word timestamp output; it is deprecated with a published shutdown date of February 26, 2027, so plan to migrate before then. See [OpenAI speech-to-text documentation](https://developers.openai.com/api/docs/guides/speech-to-text).

## Run locally

Requirements: Node.js 20+, FFmpeg with `libx264`/AAC encoders, ffprobe, and enough free disk space for source media plus generated clips and temporary transcription audio.

```sh
npm install
cp .env.example .env
npm run dev
```

Open the Vite URL printed in the terminal. The API defaults to `http://localhost:3001`. For a production build, run `npm run build` and `npm start`. The server is intended for personal use on a trusted local machine; it has no multi-user authentication. Do not expose it directly to the public internet.

### Environment setup

Copy `.env.example` to `.env`. Set `OPENAI_API_KEY` to enable word-level transcription, and set the OAuth variables for the providers you intend to connect. `TOKEN_ENCRYPTION_KEY` is required before any social account can be connected. Generate a long random secret, keep it outside source control, and back it up securely: losing it makes saved social tokens unreadable. OAuth callback URLs must exactly match the URLs registered in the provider consoles. TikTok requires an HTTPS callback.

Google setup: create OAuth web credentials, register `http://localhost:3001/api/oauth/youtube/callback` for local development (or set `GOOGLE_REDIRECT_URI`), enable YouTube Data API v3, and request the needed upload scopes.

TikTok setup: create a Login Kit and Content Posting API app, configure the HTTPS callback and `TIKTOK_REDIRECT_URI`, then authorize `user.info.basic` and `video.publish`. The app implements FILE_UPLOAD Direct Post. TikTok requires audit for public visibility; unaudited clients are restricted to private posts. Provider review/approval is outside this application.

## Video sources and provider rules

Uploads are resumable in chunks. Link import accepts public Google Drive file shares, Dropbox shared-file links, direct HTTPS URLs, Twitch Clip links, Twitch VOD links (a user-selected 5–60 second segment only), and YouTube links for videos owned by the connected Google account. Twitch links use official OAuth endpoints; VOD imports create a Twitch clip at the requested time then download its temporary media URL. The Twitch account must be the broadcaster or an authorized editor. Full Twitch VOD media is not exposed by Twitch's API. See [Twitch Clips API](https://dev.twitch.tv/docs/api/reference/clips), [Twitch Videos API](https://dev.twitch.tv/docs/api/reference/videos), and [Twitch OAuth scopes](https://dev.twitch.tv/docs/authentication/scopes).

YouTube video imports use Google's [Data Portability API](https://developers.google.com/data-portability/schema-reference/youtube) to export the original media file from the authenticated owner's account, rather than downloading from the playback page. Select the video's visibility when authorizing (public, unlisted, or private), then paste its link. A Data Portability export includes the account's videos for that visibility, not just the linked video, so the server downloads the archive and extracts the requested video ID. Export size can be large. Google may take minutes or hours and its documentation does not guarantee a maximum shorter than seven days. Google requires API enablement, supported-region availability, and OAuth app verification; the feature returns a setup error until credentials/approval are present. The archive matcher expects the exported MP4 filename to contain its YouTube video ID; if not, import fails with a manual download/upload fallback.

For live content you control, open **Live ingest**, create a key, and configure OBS → Settings → Stream → Custom with the displayed RTMP server and stream key. Start streaming; when done, stop OBS and choose **Finish recording**. The API runs on one stream at a time. Configure `LIVE_RTMP_HOST` to the machine's LAN address when OBS runs elsewhere, and allow inbound TCP at `LIVE_RTMP_PORT` (1935 by default). The listener binds to `LIVE_RTMP_BIND` (0.0.0.0 by default). RTMP here is unencrypted, so keep its port on a trusted network; the randomly generated key is private. Server/FFmpeg restarts interrupt active recordings. There is no app duration cap; disk capacity, network stability, and FFmpeg/runtime determine practical limits.

Drive links are converted to the file-download endpoint; Drive sharing must allow anyone with the link to view/download. Dropbox links are changed to download mode and must permit downloads. HTTP Range resume is used where the source supports it; if a host returns a sharing/confirmation page, the import fails with an actionable message. Zoom, Loom, Rumble, and private Drive/Dropbox files are not connected yet. The app does not scrape provider pages, extract protected streams, or pull Twitch/YouTube player URLs. YouTube's developer policies restrict downloading/importing copies of YouTube audiovisual content without prior written approval. Use the streamer's own encoder output or a video file you are authorized to use. See [YouTube API policies](https://developers.google.com/youtube/terms/developer-policies).

For full Twitch VODs, the official Videos API exposes VOD metadata but not a full-media download. This app can request one creator-authorized 5–60 second clip at a specified timestamp; it cannot automatically analyze the full Twitch VOD. To clip a longer VOD in one pass, download it yourself in Twitch Video Producer and upload it here. See [Twitch VOD help](https://help.twitch.tv/s/article/video-on-demand).

There is no application-level source-duration cap. Actual limits are free disk space, FFmpeg runtime, available memory, provider/link expiry, local HTTP proxy limits, and optional `MAX_UPLOAD_BYTES`. Check disk usage before importing multi-hour material. Upload/import progress, failures, retry, and cancellation are surfaced in the project library. The source and outputs stay on the configured local disk; deleting the project/source files must currently be done outside the application.

## Implemented functionality

- Clip counts include 3, 5, 10, 20, Auto, and custom; results do not overlap by design. The generator explains how many clips were created and why it returned fewer than requested.
- Selection uses word-level transcript density when configured, scene-change frequency, silence ratio, per-second relative audio energy, and instruction keyword matches. Its 0–100 score is a deterministic editorial signal from those features, not an audience-performance prediction. Without transcription credentials, speech and keyword signals are omitted; scene/audio analysis still runs.
- Captions are editable word-level transcript entries with generated WebVTT, including timing recomputed for a saved trim. Captions appear as a selectable caption track in compatible browsers and can be downloaded as a sidecar from `/api/clips/:id/captions`. Captions are **not burned into the rendered MP4** yet; caption font/color/highlight/logo choices are stored only where the current editor exposes them and are not all rendered.
- The editor saves trim, crop rectangles, aspect ratio, captions, caption position, and gaming/interview layout choices. FFmpeg rerenders those changes. Gaming stacked output requires manually entered face-camera/gameplay regions. Interview split layout requires manually entered speaker regions. There is no automatic face/speaker/subject detection or tracking yet; use padded whole-frame output or enter crop coordinates manually when uncertain.
- Projects, background generation jobs, cancellation/retry, previews, individual downloads, batch downloads, and direct RTMP stream capture are available. Background jobs use SQLite records, but the worker is a single Node process rather than a distributed queue. Interrupted processing jobs restart from the beginning; completed source downloads and completed transcription records are checkpointed. Live capture currently supports one RTMP stream at a time and cannot survive an API/FFmpeg process restart.
- Review mode requires explicit clip approval before creating a publishing job. YouTube and TikTok use their official OAuth/API flows, encrypted AES-GCM token storage, refresh handling, upload/status tracking, per-destination queues, and stable idempotency keys. A remote upload whose outcome cannot be confirmed is moved to `needs_review` instead of silently starting another post. Provider credentials, account eligibility, quota, audit, and publishing permissions remain necessary.
- Scheduled publishing is checked by the running server. Workflow rules can set clip count, length, aspect, instructions, destinations, score threshold, timezone and daily limit. Autopilot requires explicit global enablement, an enabled workflow, a connected account, and clips over the configured threshold. A global stop prevents queued publisher jobs from starting. Watch-folder automation is not implemented; workflows are run manually on a ready project.

Twitch OAuth setup: create a Twitch developer application; set `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `TWITCH_REDIRECT_URI` (default `http://localhost:3001/api/oauth/twitch/callback`); register that exact callback URI; set `TOKEN_ENCRYPTION_KEY`; then open Connections → Source accounts → Connect Twitch and authorize `channel:manage:clips` / `editor:manage:clips`. Twitch clips/VOD segments require broadcaster/editor permission. This is separate from social publishing accounts.

YouTube source setup: enable Google Data Portability API, configure an OAuth web client and API key, set `GOOGLE_DATA_PORTABILITY_API_KEY` and `GOOGLE_DATA_PORTABILITY_REDIRECT_URI` (default `http://localhost:3001/api/oauth/youtube-source/callback`), and complete Google's verification/region requirements. Open Connections → YouTube video import and authorize the corresponding visibility. Scopes are requested separately because Google restricts mixing Data Portability scopes with other API scopes. The standard YouTube publishing connection is independent.

## Integrations not available yet

Instagram Reels and Facebook Reels are visibly marked as not implemented. They need separate official Meta OAuth, account/Page selection, provider-specific upload and processing-state flows, and permissions/app review. This version does not simulate those connections. Manual MP4 download remains available. Official references supplied for future work: [Instagram publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/) and [Facebook Reels publishing](https://developers.facebook.com/docs/video-api/guides/reels-publishing/).

Other unimplemented features: automatic face/speaker/action detection, automatic crop tracking, word-synchronous burned-in caption styling, audio normalization/silence removal, AI-generated title/hashtag/thumbnail suggestions, publishing metrics sync, spend budgets, configurable retention UI, watched folders, and multi-user access controls. The current usage estimate is local storage and FFmpeg work rather than a billed cloud estimate.

## Data and migrations

SQL files in `server/migrations/` are applied at startup. SQLite stores metadata/job state; video files are stored on local disk, not in the database. Default `DATA_DIR=./data` is ignored by git. Back up that folder together with the matching encryption secret. For deletion, stop the application and remove the relevant project files/database records or the entire data directory; there is no deletion UI yet.

## Verify

```sh
npm test
npm run build
```

Tests exercise source-link policy and clip selection/render layout helpers. A full upload/transcription/OAuth/publish test requires FFmpeg, media, external credentials, and provider account permissions.
