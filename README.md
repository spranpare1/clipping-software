# Splice Studio

A single-user, local-first video clipping application. It accepts uploaded files and direct HTTPS video-file links, creates clips with FFmpeg in a server-side worker, lets you edit and download them, and supports OAuth publishing to YouTube and TikTok when you provide provider credentials.

## Architecture

- **Frontend:** React + Vite dashboard.
- **API and worker:** Node.js + Express. SQLite-backed jobs continue after closing the browser; long tasks run in a separate server process from the browser.
- **Database:** SQLite migrations in `server/migrations/` store projects, upload/import checkpoints, transcripts, edits, social tokens, publishing jobs, workflows, and activity.
- **Media storage:** local filesystem under `DATA_DIR` (default `./data`). Source files and rendered clips are private local files; the clip preview/download API serves generated clips.
- **Media engine:** FFmpeg and ffprobe for chunk assembly, scene detection, audio analysis, transcoding, crops, layouts, and renders.
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

Uploads are resumable in chunks. Direct-link import accepts public HTTPS URLs that return a video file (for example MP4, MOV, or WebM), supports HTTP Range resume where the host allows it, and reports when a host does not support resume. A provider watch-page URL is not a direct media URL. The app intentionally does not scrape YouTube/Twitch pages or extract protected streams.

YouTube's developer policies restrict downloading/importing copies of YouTube audiovisual content without prior written approval. For Twitch, the public Videos API exposes VOD metadata, not full VOD download; download your own VOD from Twitch Video Producer, then upload it. Official references: [YouTube API policies](https://developers.google.com/youtube/terms/developer-policies), [YouTube upload guide](https://developers.google.com/youtube/data/guides/uploading_a_video), [Twitch Videos API](https://dev.twitch.tv/docs/api/videos/), [Twitch VOD help](https://help.twitch.tv/s/article/video-on-demand).

There is no application-level source-duration cap. Actual limits are free disk space, FFmpeg runtime, available memory, provider/link expiry, local HTTP proxy limits, and optional `MAX_UPLOAD_BYTES`. Check disk usage before importing multi-hour material. Upload/import progress, failures, retry, and cancellation are surfaced in the project library. The source and outputs stay on the configured local disk; deleting the project/source files must currently be done outside the application.

## Implemented functionality

- Clip counts include 3, 5, 10, 20, Auto, and custom; results do not overlap by design. The generator explains how many clips were created and why it returned fewer than requested.
- Selection uses word-level transcript density when configured, scene-change frequency, silence ratio, per-second relative audio energy, and instruction keyword matches. Its 0–100 score is a deterministic editorial signal from those features, not an audience-performance prediction. Without transcription credentials, speech and keyword signals are omitted; scene/audio analysis still runs.
- Captions are editable word-level transcript entries with generated WebVTT, including timing recomputed for a saved trim. Captions appear as a selectable caption track in compatible browsers and can be downloaded as a sidecar from `/api/clips/:id/captions`. Captions are **not burned into the rendered MP4** yet; caption font/color/highlight/logo choices are stored only where the current editor exposes them and are not all rendered.
- The editor saves trim, crop rectangles, aspect ratio, captions, caption position, and gaming/interview layout choices. FFmpeg rerenders those changes. Gaming stacked output requires manually entered face-camera/gameplay regions. Interview split layout requires manually entered speaker regions. There is no automatic face/speaker/subject detection or tracking yet; use padded whole-frame output or enter crop coordinates manually when uncertain.
- Projects, background generation jobs, cancellation/retry, previews, individual downloads, and batch downloads are available. Background jobs use SQLite records, but the worker is a single Node process rather than a distributed queue. Interrupted processing jobs restart from the beginning; completed source downloads and completed transcription records are checkpointed.
- Review mode requires explicit clip approval before creating a publishing job. YouTube and TikTok use their official OAuth/API flows, encrypted AES-GCM token storage, refresh handling, upload/status tracking, per-destination queues, and stable idempotency keys. A remote upload whose outcome cannot be confirmed is moved to `needs_review` instead of silently starting another post. Provider credentials, account eligibility, quota, audit, and publishing permissions remain necessary.
- Scheduled publishing is checked by the running server. Workflow rules can set clip count, length, aspect, instructions, destinations, score threshold, timezone and daily limit. Autopilot requires explicit global enablement, an enabled workflow, a connected account, and clips over the configured threshold. A global stop prevents queued publisher jobs from starting. Watch-folder automation is not implemented; workflows are run manually on a ready project.

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
