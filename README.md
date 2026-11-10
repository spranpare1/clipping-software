# Splice Studio

A locally hosted video repurposing workspace. The current working vertical slice uploads a source in resumable chunks, stores project/job state in SQLite, selects distinct source intervals, renders MP4 clips with FFmpeg in a server worker, previews them in the browser, and downloads one or all outputs.

## Architecture

- **Frontend:** React 18 + Vite dashboard.
- **API and worker:** Node.js 20+ / Express. One persistent worker currently runs alongside the API process.
- **Database:** SQLite via `better-sqlite3`; schema is in `server/migrations/001_init.sql`. Queued/interrupted jobs are recovered on server startup.
- **Media storage:** local filesystem under `DATA_DIR/sources` and `DATA_DIR/clips`.
- **Processing:** FFmpeg/ffprobe. A scene-change scan ranks candidate windows by detected visual change density; sparse/static footage uses a spaced structural fallback. Render jobs create H.264/AAC MP4s at 9:16, 1:1, 4:5, or 16:9 with letterboxing to preserve the source image.
- **Queue:** SQLite-backed job rows with status, stage, and progress checkpoints. This is appropriate for a single-host MVP; use a dedicated queue such as Redis/BullMQ plus separate worker processes for multi-host production.

## Run locally

Requirements: Node.js 20+, FFmpeg and ffprobe on `PATH`, and enough local disk for source files plus rendered outputs.

```sh
npm install
cp .env.example .env
npm run dev
```

Vite serves the UI on `http://localhost:5173`; the API listens on `http://localhost:3001`. `DATA_DIR` defaults to `./data`. Set `MAX_UPLOAD_BYTES` to impose a deployment-specific source limit; unset, there is no application-level duration or upload-size limit. Real limits are available disk space, the browser/network, reverse-proxy request/timeout settings, and FFmpeg/host capacity. Set reverse-proxy timeouts for large chunked uploads. The app accepts resumable 8 MiB chunks by default, with chunk sizes configurable from 256 KiB to 32 MiB at the API.

The API currently assumes one trusted local operator. It has no user authentication or per-user ACL and must not be exposed to the public internet as-is. Source/output files are local and not encrypted at rest. Back up the `DATA_DIR` directory to preserve projects, jobs, and clips.

## What works today

- Chunked source upload with browser resume state; reselect the same file after an interrupted upload to continue.
- Project library, source duration probing, clip count presets/custom/Auto, clip length and aspect selection, category, and a free-form instruction field.
- Durable SQLite job records, background rendering independent of the browser tab, progress display, cancel, and retry endpoints.
- FFmpeg rendering, playable previews, clip downloads, and batch downloads.
- Shortfall errors when the source cannot provide the requested number of non-overlapping clips at the chosen duration.
- Platform setup requirements and manual-download fallback. The app does not claim to connect or publish anywhere.

## Current limits (shown in the UI)

Moment selection scans for scene changes and favors non-overlapping windows with more detected changes; when no changes are found it spaces clips through the source. It does **not** currently analyze speech, audio energy, faces, actions, or semantic content. The instruction field is saved with the job and surfaced in the explanation but does not semantically rank footage. The displayed score is a deterministic visual-structure proxy, not a model prediction or performance guarantee. Captions/transcription, language detection, subject/speaker tracking, gaming-camera layouts, crop editing, timeline/trimming, silence removal, audio normalization, metadata generation, thumbnail extraction, watched folders, and reusable autopilot workflows are not implemented yet. Framing preserves the full original image in a padded canvas, so it avoids cutting off subjects but does not create intelligent portrait crops.

OAuth connections, token encryption/refresh, platform publishing, scheduling, per-destination state, duplicate-safe publish retries, status synchronization, and metrics are not implemented. No platform credentials are present. The Connections page lists current prerequisites; YouTube uploads use OAuth and the YouTube Data API `videos.insert` endpoint, TikTok Direct Post needs Content Posting API setup and approved/authorized `video.publish`, and Meta publishing needs eligible Instagram professional/Facebook Page accounts and the appropriate app products/permissions. See current official docs: [YouTube upload guide](https://developers.google.com/youtube/data/guides/uploading_a_video), [TikTok Direct Post setup](https://developers.tiktok.com/docs/en/content-posting-api-get-started), [Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/), [Facebook Reels publishing](https://developers.facebook.com/docs/video-api/guides/reels-publishing/).

## Environment variables

See `.env.example`. Credentials stay server-side. The OAuth variables are placeholders and do not activate integrations. There is currently no secret/token encryption implementation because no connection flow exists.

## Database and retention

Schema changes belong in ordered SQL files in `server/migrations/`. The initial migration runs idempotently at API startup. To remove media, stop the server and delete `DATA_DIR`; there is not yet a UI retention/deletion control. SQLite stores paths and job state, not video blobs.

## Tests

```sh
npm test
npm run build
```

The automated tests exercise server-side clip-count/shortfall logic and layout filter generation. A full browser upload/render acceptance run requires FFmpeg/ffprobe and local disk, just like a deployment.
