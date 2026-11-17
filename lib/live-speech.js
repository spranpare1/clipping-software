import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SEGMENT_SECONDS = 8;

export class LiveSpeechCapture {
  constructor({ agentId, device, folder, provider = 'openai', apiKey, model = 'gpt-transcribe', whisperPath = process.env.WHISPER_CPP_PATH || 'whisper-cli', whisperModel = process.env.WHISPER_MODEL_PATH || '', ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg', onTranscript, onStatus, onError }) {
    Object.assign(this, { agentId, device, folder, provider, apiKey, model, whisperPath, whisperModel, ffmpegPath, onTranscript, onStatus, onError });
    this.child = null;
    this.scanTimer = null;
    this.seen = new Set();
    this.processing = false;
    this.stopped = true;
    this.retryAfter = 0;
    this.retryDelay = 5000;
    this.restartTimer = null;
    this.runId = randomUUID();
    this.startedAt = 0;
    this.status = { state: 'stopped', message: 'Speech monitoring is off.' };
  }

  setStatus(state, message) {
    this.status = { state, message, updatedAt: new Date().toISOString() };
    this.onStatus?.(this.status);
  }

  async start() {
    if (this.provider === 'openai' && !this.apiKey) throw new Error('Set OPENAI_API_KEY in .env to enable hosted speech transcription.');
    if (this.provider === 'local-whisper' && !this.whisperModel) throw new Error('Set WHISPER_MODEL_PATH to a local Whisper.cpp model file.');
    if (!['openai', 'local-whisper'].includes(this.provider)) throw new Error('SPEECH_TRANSCRIPTION_PROVIDER must be openai or local-whisper.');
    if (!this.device?.trim()) throw new Error('Enter the Windows DirectShow audio device receiving OBS monitor audio.');
    await fs.mkdir(this.folder, { recursive: true });
    this.seen.clear();
    for (const name of await fs.readdir(this.folder)) if (/^speech-\d{8}\.wav$/.test(name)) await fs.rm(path.join(this.folder, name), { force: true });
    const args = [
      '-hide_banner', '-loglevel', 'warning', '-thread_queue_size', '1024',
      '-f', 'dshow', '-i', `audio=${this.device.trim()}`,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
      '-f', 'segment', '-segment_time', String(SEGMENT_SECONDS), '-reset_timestamps', '1',
      '-segment_format', 'wav', path.join(this.folder, 'speech-%08d.wav')
    ];
    this.stopped = false;
    this.startedAt = Date.now();
    this.runId = randomUUID();
    this.setStatus('starting', 'Starting audio capture…');
    this.child = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    this.child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-5000); });
    this.child.once('error', (error) => {
      if (this.stopped) return;
      this.setStatus('error', error.message);
      this.onError?.(new Error(`Audio capture could not start: ${error.message}`));
    });
    this.child.once('close', (code) => {
      this.child = null;
      clearInterval(this.scanTimer);
      if (this.stopped) return;
      const detail = stderr.trim().split(/\r?\n/).slice(-2).join(' ');
      const message = `FFmpeg audio capture stopped (${code ?? 'unknown'}).${detail ? ` ${detail}` : ''}`;
      this.setStatus('error', message);
      this.onError?.(new Error(message));
      this.restartTimer = setTimeout(() => {
        void this.start().catch((error) => {
          this.setStatus('error', error.message);
          this.onError?.(error);
        });
      }, 15000);
    });
    this.scanTimer = setInterval(() => { void this.scanSegments(); }, 500);
    this.setStatus('listening', `Listening to OBS audio via “${this.device}”.`);
  }

  async scanSegments() {
    if (this.processing || this.stopped || Date.now() < this.retryAfter) return;
    let names;
    try { names = (await fs.readdir(this.folder)).filter((name) => /^speech-\d{8}\.wav$/.test(name)).sort(); }
    catch (error) { this.onError?.(error); return; }
    for (const name of names) {
      if (this.seen.has(name)) continue;
      const file = path.join(this.folder, name);
      try {
        const stat = await fs.stat(file);
        if (Date.now() - stat.mtimeMs < 1200 || stat.size < 1200) continue;
      } catch { continue; }
      this.seen.add(name);
      this.processing = true;
      const runId = this.runId;
      try { await this.transcribe(file, name, runId); }
      catch (error) {
        this.setStatus('error', error.message);
        this.onError?.(error);
        this.retryAfter = Date.now() + this.retryDelay;
        this.retryDelay = Math.min(120000, this.retryDelay * 2);
      } finally {
        await fs.rm(file, { force: true }).catch(() => {});
        this.processing = false;
      }
      return;
    }
  }

  async transcribe(file, name, runId) {
    this.setStatus('transcribing', 'Transcribing a short audio window…');
    let text;
    if (this.provider === 'local-whisper') {
      const result = await runCommand(this.whisperPath, ['-m', this.whisperModel, '-f', file, '-nt', '-np']);
      text = result.stdout.trim();
    } else {
      const audio = await fs.readFile(file);
      const form = new FormData();
      form.set('file', new Blob([audio], { type: 'audio/wav' }), path.basename(file));
      form.set('model', this.model);
      form.set('response_format', 'json');
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}` }, body: form,
        signal: AbortSignal.timeout(30000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.message || `Speech provider returned HTTP ${response.status}.`);
      text = String(result.text || '').trim();
    }
    const index = Number(name.match(/(\d+)\.wav$/)?.[1] || 0);
    const at = this.startedAt + (index + 1) * SEGMENT_SECONDS * 1000;
    if (text && !this.stopped && runId === this.runId) this.onTranscript?.({ agentId: this.agentId, text, at, segment: index });
    this.retryAfter = 0;
    this.retryDelay = 5000;
    this.setStatus('listening', `Listening to OBS audio via “${this.device}”.`);
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.scanTimer);
    clearTimeout(this.restartTimer);
    this.scanTimer = null;
    this.runId = randomUUID();
    if (this.child) {
      const child = this.child;
      this.child = null;
      child.kill('SIGTERM');
    }
    this.setStatus('stopped', 'Speech monitoring is off.');
    await fs.rm(this.folder, { recursive: true, force: true }).catch(() => {});
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout = (stdout + String(chunk)).slice(-100_000); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-6000); });
    child.once('error', (error) => reject(new Error(`${command} could not start: ${error.message}`)));
    child.once('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited with code ${code}: ${stderr.trim().slice(-1800) || 'No diagnostic output.'}`)));
  });
}

export function detectSpeechCues(text) {
  const normalized = String(text || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const cues = [];
  if (/\b(?:clip (?:that|this|it|that part)|someone clip|somebody clip|chat clip|clip worthy|we need to clip)\b/.test(normalized)) {
    cues.push({ type: 'streamer_clip_request', reason: 'Streamer asked for a clip.' });
  }
  if (/\b(?:make a poll|start a poll|vote (?:on|for)|cast your vote|chat (?:decide|choose|pick)|what do you think chat|chat[, ]+(?:what|who|which|should|would|do you|are we|is it|choose|pick)|should i .{2,45}|which (?:one|option)|a or b|left or right|yes or no)\b/.test(normalized)) {
    cues.push({ type: 'poll_interaction', reason: 'Streamer asked chat to vote or make a decision.' });
  }
  if (/\b(?:let's go|lets go|no way|oh my god|holy (?:\w+)|i can't believe|unbelievable|that's insane|thats insane|laughing so hard|i'm crying|im crying)\b|\b(?:hahaha|lmao|rofl)\b/.test(normalized)) {
    cues.push({ type: 'speech_reaction', reason: 'Excited or amused speech cue detected; this is a heuristic, not emotion recognition.' });
  }
  return cues;
}
