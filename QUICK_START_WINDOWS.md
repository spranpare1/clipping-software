# Stream Clipper: simple Windows setup

This guide gets one agent running and helps you check that it can save and format a clip. Start with manual clipping. Add speech and chat triggers after that works.

## What the app does

OBS watches the video and keeps a rolling Replay Buffer. Stream Clipper tells OBS when to save that buffer. After a clip is saved, FFmpeg creates a formatted MP4 and the dashboard shows its progress.

The app does not download a stream from a link. Add the stream to an OBS scene that you are allowed to capture. Keep OBS and Stream Clipper running while you watch; you may close the dashboard tab.

## 1. Install the required programs

Install:

- [Node.js](https://nodejs.org/en/download/) (22 or newer)
- [OBS Studio](https://obsproject.com/download) (28 or newer)
- [FFmpeg](https://ffmpeg.org/download.html), including `ffprobe`
- Git, if you are cloning the repository from GitHub

Open PowerShell and check that Node and FFmpeg work:

```powershell
node --version
ffmpeg -version
ffprobe -version
```

If Windows says `ffmpeg` is not recognized, add the folder containing `ffmpeg.exe` and `ffprobe.exe` to PATH, then close and reopen PowerShell. You can instead set their full paths as `FFMPEG_PATH` and `FFPROBE_PATH` in `.env`.

## 2. Get the project and start it

In PowerShell:

```powershell
git clone https://github.com/spranpare1/clipping-software.git
cd clipping-software
Copy-Item .env.example .env
npm start
```

Leave that PowerShell window open. In your browser, open <http://127.0.0.1:4179>.

If you already cloned the repo, go to its folder and run `git pull` before `npm start`.

## 3. Set up OBS for one stream

1. Add a source to an OBS scene. For example, add a Browser Source or Window Capture showing your stream. Check that you can see and hear it in OBS.
2. In OBS, open **Settings → Output → Replay Buffer**, enable it, and set the duration to **180 seconds**. The app’s default clip length is about three minutes.
3. In OBS, open **Tools → WebSocket Server Settings**. Enable the server, keep the default port `4455`, and set a password.
4. In the Stream Clipper agent card, enter that OBS password and click **Connect OBS**. The card should show that the Replay Buffer is ready.

OBS’s guide explains the Replay Buffer and save controls: [OBS Studio overview](https://obsproject.com/kb/OBS-Studio-Overview). Audio monitoring is covered in the [OBS Audio Mixer guide](https://obsproject.com/kb/audio-mixer-guide).

## 4. Make a first test clip

1. Let OBS run for three minutes so the Replay Buffer can fill.
2. In an agent card, choose an output ratio. Start with **9:16**.
3. Click **Save replay**.
4. In **Clip library**, wait for the status to move from queued/rendering to **Ready for review**. The video preview should show the formatted version. Use **Download formatted** to save it; **Original** downloads OBS’s untouched replay.

This test does not need Twitch credentials, a speech API key, or automatic saves. It only needs OBS, FFmpeg, and the app.

## 5. Optional: detect spoken clip requests

Live speech listening is off by default. It currently works on Windows using an audio device that carries OBS audio. Each agent needs its own device if you monitor multiple streams.

### Route OBS audio to a device

1. Install a Windows virtual audio cable or another loopback recording device.
2. In OBS, set that cable as the **Monitoring Device** under **Settings → Audio → Advanced**.
3. In the OBS Audio Mixer, open **Advanced Audio Properties** for the audio source you want analyzed and choose **Monitor and Output**. Check that OBS still plays/records the audio.
4. Find the exact recording-device name. In PowerShell, run:

   ```powershell
   ffmpeg -list_devices true -f dshow -i dummy
   ```

   FFmpeg prints device names even if it ends with an error about `dummy`. Enter the audio device name in the agent’s **Live speech** device box.

### Choose how speech is transcribed

**Hosted option:** Set these values in `.env`:

```dotenv
SPEECH_TRANSCRIPTION_PROVIDER=openai
OPENAI_API_KEY=your_api_key_here
SPEECH_TRANSCRIPTION_MODEL=gpt-transcribe
```

Keep the key in `.env`; never put it in a message, screenshot, or GitHub commit. Hosted mode sends eight-second audio windows to OpenAI while Live speech is enabled. API use may cost money. See the [OpenAI transcription API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create).

**Local option:** Install Whisper.cpp and download a model. Set its paths in `.env`:

```dotenv
SPEECH_TRANSCRIPTION_PROVIDER=local-whisper
WHISPER_CPP_PATH=C:\tools\whisper.cpp\build\bin\Release\whisper-cli.exe
WHISPER_MODEL_PATH=C:\tools\whisper.cpp\models\ggml-base.en.bin
```

Use the actual paths on your PC. Local mode keeps audio on your computer, but transcription speed depends on the model and your hardware. See the [Whisper.cpp setup guide](https://github.com/ggml-org/whisper.cpp).

After changing `.env`, stop and restart Stream Clipper. In the dashboard:

1. Enter the DirectShow device name.
2. Check **Listen for spoken clip requests and chat questions**.
3. Click **Save settings** and wait for the speech status to say it is listening.
4. First leave **Automatic moment saves** unchecked. Say “Chat, clip that” into the audio being monitored and check the activity log for a spoken clip request. This confirms transcription without automatically saving clips.
5. If that works, check **Automatic moment saves** and repeat. The agent should save a replay after the configured reaction delay. Make sure the Replay Buffer has already filled.

When Automatic moment saves is off, speech cues are only logged. When it is on, speech cues can save replays. Detection works on short audio windows, so expect a delay. Phrase cues and loudness are not reliable emotion recognition; this version does not identify faces, gameplay events, or visual reactions.

## Optional chat setup

Chat monitoring is separate from speech monitoring. Twitch needs a user token with `chat:read` plus the channel name. YouTube Live needs an access token and that broadcast’s `liveChatId`. Add credentials to `.env`, restart the app, then fill in the agent’s chat fields. The full [README](README.md) has the provider details.

## Common issues

- **Agent won’t connect:** Confirm OBS is open, WebSocket is enabled, the port/password match, and the agent shows the correct host and port.
- **Replay Buffer is off:** Enable it in OBS Output settings, then reconnect the agent.
- **Formatting fails:** Check `ffmpeg -version` and `ffprobe -version`. The original replay remains available so you can retry after fixing FFmpeg.
- **No speech status / device error:** Confirm `.env` provider settings, restart the app, and copy the device name exactly as FFmpeg lists it.
- **Speech status says unsupported:** Live audio capture currently supports Windows DirectShow only.
- **No clip after a spoken cue:** Enable **Automatic moment saves** as well as **Live speech**, and make sure OBS’s Replay Buffer is connected and has had time to fill.

## Keep the dashboard private

The app has no sign-in screen and listens only on the local computer. Do not expose it to the public internet or use Tailscale Funnel. If you want to open it from your own devices, use your private Tailscale network and the Tailscale Serve setup in the full README.

To stop the app, return to its PowerShell window and press **Ctrl+C**. To stop speech transcription but keep clipping, uncheck **Live speech** and save settings.
