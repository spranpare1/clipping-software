import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ObsClient } from './lib/obs-client.js';
import { HypeMeter } from './lib/hype.js';
import { AudioPeakDetector, MomentScorer } from './lib/moments.js';
import { formattingPlan, probeMedia, renderFormattedClip } from './lib/clip-formatter.js';
import { detectSpeechCues, LiveSpeechCapture } from './lib/live-speech.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
const CLIPS = path.join(ROOT, 'clips');
await fs.mkdir(DATA, { recursive: true });
await fs.mkdir(CLIPS, { recursive: true });
if (fsSync.existsSync(path.join(ROOT, '.env'))) {
  for (const line of fsSync.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
const CONFIG_PATH = path.join(DATA, 'agents.json');
const CLIPS_PATH = path.join(DATA, 'clips.json');
const DEFAULT_CRITERIA = 'Target about 3 minutes. Include buildup, the main event, and the streamer/chat reaction. Prioritize streamer clip requests, polls and audience decisions, strong emotional reactions, chat spikes, emote spam, and repeated messages. Capture context and complete dialogue. Give extra priority when multiple independent signals overlap.';
const defaultAgents = Array.from({ length: 5 }, (_, i) => ({
  id: `agent-${i + 1}`, name: `Clipper ${i + 1}`, enabled: i === 0, criteria: DEFAULT_CRITERIA, sourceName: '', obsHost: i === 0 ? (process.env.OBS_HOST || '127.0.0.1') : '127.0.0.1', obsPort: i === 0 ? Number(process.env.OBS_PORT || 4455) : 4455 + i,
  twitchChannel: '', youtubeLiveChatId: '', autoSaveHype: false, minMessages: 8, windowSeconds: 20, multiplier: 2.5, cooldownSeconds: 90,
  clipDurationSeconds: 180, postRollSeconds: 20, audioInputName: '', audioPeakDb: -8, outputAspectRatio: '9:16', speechMonitoringEnabled: false, speechAudioDevice: ''
}));
let agents = defaultAgents;
let clips = [];
try {
  const savedAgents = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
  agents = defaultAgents.map((defaults) => {
    const saved = savedAgents.find((item) => item.id === defaults.id) || {};
    return { ...defaults, ...saved, criteria: saved.criteria?.trim() ? saved.criteria : defaults.criteria };
  });
  const sharedCriteria = agents[0]?.criteria || DEFAULT_CRITERIA;
  agents = agents.map((agent) => ({ ...agent, criteria: sharedCriteria, outputAspectRatio: ['9:16', '1:1', '4:5', '16:9'].includes(agent.outputAspectRatio) ? agent.outputAspectRatio : '9:16' }));
} catch {}
try { clips = JSON.parse(await fs.readFile(CLIPS_PATH, 'utf8')); } catch {}
const runtime = new Map();
let twitchReconnectTimer = null;
for (const agent of agents) runtime.set(agent.id, {
  obs: null, password: process.env[`OBS_PASSWORD_${agent.id.toUpperCase().replace('-', '_')}`] || (agent.id === 'agent-1' ? process.env.OBS_PASSWORD || '' : ''),
  obsInfo: { connected: false, replayBufferActive: false, error: '', host: agent.obsHost, port: agent.obsPort },
  events: [], isSaving: false, twitchStatus: 'not_configured', youtubeStatus: 'not_configured', hype: new HypeMeter(agent), moments: new MomentScorer(), audio: new AudioPeakDetector({ thresholdDb: agent.audioPeakDb }), youtubeTimer: null, youtubePageToken: '',
  twitchSocket: null, speech: null, speechStatus: { state: 'stopped', message: 'Speech monitoring is off.' }, shouldReconnect: false, reconnecting: false, pendingMoment: null, pendingMomentTimer: null, lastSavedAt: 0
});

function log(agentId, type, message, detail = '') {
  const rt = runtime.get(agentId);
  if (!rt) return;
  rt.events.unshift({ id: randomUUID(), type, message, detail, at: new Date().toISOString() });
  rt.events = rt.events.slice(0, 30);
}
async function persist() { await fs.writeFile(CONFIG_PATH, JSON.stringify(agents, null, 2)); }
let clipsPersistChain = Promise.resolve();
async function persistClips() {
  const snapshot = JSON.stringify(clips, null, 2);
  clipsPersistChain = clipsPersistChain.catch(() => {}).then(async () => {
    const tempPath = `${CLIPS_PATH}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, snapshot);
    await fs.rename(tempPath, CLIPS_PATH);
  });
  return clipsPersistChain;
}
function recordSignal(agent, { type, source, reason }, at = Date.now()) {
  const rt = runtime.get(agent.id);
  const score = rt.moments.add({ type, source, reason, at });
  if (!score.qualifies) return score;
  log(agent.id, 'moment', `${score.score}/100 moment score`, score.reason);
  if (agent.enabled && agent.autoSaveHype) {
    if (!rt.pendingMomentTimer && rt.lastSavedAt && at - rt.lastSavedAt < Number(agent.clipDurationSeconds) * 1000) {
      log(agent.id, 'system', 'Moment merged into the recent clip window', 'Skipped a second clip to reduce overlapping footage.');
      return score;
    }
    rt.pendingMoment = score;
    if (!rt.pendingMomentTimer) {
      log(agent.id, 'system', `Saving in ${agent.postRollSeconds}s for reaction context`, 'Later signals during this delay are combined into the same clip.');
      rt.pendingMomentTimer = setTimeout(async () => {
        const pending = rt.pendingMoment;
        rt.pendingMoment = null;
        rt.pendingMomentTimer = null;
        try { await saveReplay(agent.id, `Automatic moment · ${pending.score}/100 · ${pending.reason}`); }
        catch (error) { log(agent.id, 'error', 'Automatic clip save failed', error.message); }
      }, Number(agent.postRollSeconds) * 1000);
    }
  }
  return score;
}
function ingestChat(agent, { id, user, text, at = Date.now() }) {
  const signal = runtime.get(agent.id).hype.add({ id, user, text, at });
  if (!signal) return;
  log(agent.id, 'signal', 'Chat activity spike detected', signal.reason);
  for (const type of signal.triggerTypes) recordSignal(agent, { type, source: 'chat', reason: signal.reason }, at);
}
function handleSpeechTranscript(agent, { text, at }) {
  const cues = detectSpeechCues(text);
  for (const cue of cues) {
    log(agent.id, 'signal', cue.reason, 'Detected in the live audio transcript.');
    recordSignal(agent, { type: cue.type, source: 'speech', reason: cue.reason }, at);
  }
}
async function configureSpeech(agent) {
  const rt = runtime.get(agent.id);
  if (rt.speech) { await rt.speech.stop(); rt.speech = null; }
  if (!agent.enabled || !agent.speechMonitoringEnabled) {
    rt.speechStatus = { state: 'stopped', message: 'Speech monitoring is off.' };
    return;
  }
  if (process.platform !== 'win32') {
    rt.speechStatus = { state: 'unsupported', message: 'Live audio capture is currently configured for Windows DirectShow.' };
    return;
  }
  if (!agent.speechAudioDevice.trim()) {
    rt.speechStatus = { state: 'needs_device', message: 'Choose the DirectShow device receiving OBS audio.' };
    return;
  }
  const provider = process.env.SPEECH_TRANSCRIPTION_PROVIDER || 'openai';
  const speech = new LiveSpeechCapture({
    agentId: agent.id, device: agent.speechAudioDevice, folder: path.join(DATA, 'speech-temp', agent.id),
    provider, apiKey: process.env.OPENAI_API_KEY, model: process.env.SPEECH_TRANSCRIPTION_MODEL || 'gpt-transcribe',
    whisperModel: process.env.WHISPER_MODEL_PATH || '', whisperPath: process.env.WHISPER_CPP_PATH || 'whisper-cli',
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    onTranscript: (event) => handleSpeechTranscript(agent, event),
    onStatus: (status) => { rt.speechStatus = status; },
    onError: (error) => log(agent.id, 'error', 'Live speech monitor issue', error.message)
  });
  rt.speech = speech;
  try { await speech.start(); }
  catch (error) {
    rt.speech = null;
    rt.speechStatus = { state: 'error', message: error.message };
    log(agent.id, 'error', 'Live speech monitor could not start', error.message);
  }
}
function handleObsEvent(agent, type, data) {
  if (type !== 'InputVolumeMeters') return;
  const inputName = agent.audioInputName.trim();
  if (!inputName) return;
  const input = (data.inputs || []).find((item) => item.inputName === inputName);
  if (!input) return;
  const levels = (input.inputLevelsMul || []).flat().filter((value) => Number.isFinite(value));
  if (!levels.length) return;
  const signal = runtime.get(agent.id).audio.add({ inputName, multiplier: Math.max(...levels) });
  if (signal) {
    log(agent.id, 'signal', 'Loud audio burst detected', signal.reason);
    recordSignal(agent, signal);
  }
}

async function saveReplay(agentId, reason = 'Manual save') {
  const agent = agents.find((item) => item.id === agentId);
  const rt = runtime.get(agentId);
  if (!agent || !rt?.obs || !rt.obsInfo.connected) throw new Error('Connect this agent to OBS before saving a replay.');
  if (!rt.obsInfo.replayBufferActive) throw new Error('OBS Replay Buffer is off. Turn it on in OBS first.');
  if (rt.isSaving) throw new Error('This agent is already saving a replay.');
  rt.isSaving = true;
  try {
    const saved = await rt.obs.request('SaveReplayBuffer');
    let replayPath = saved.savedReplayPath || '';
    const start = Date.now();
    while (Date.now() - start < 12000) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      const last = await rt.obs.request('GetLastReplayBufferReplay');
      replayPath = last.savedReplayPath || '';
      if (replayPath && fsSync.existsSync(replayPath) && (await fs.stat(replayPath)).size > 0) break;
    }
    if (!replayPath || !fsSync.existsSync(replayPath)) throw new Error('OBS accepted the save request, but no replay file appeared. Check OBS Replay Buffer settings.');
    const ext = path.extname(replayPath) || '.mkv';
    const id = randomUUID();
    const folder = path.join(CLIPS, agentId);
    await fs.mkdir(folder, { recursive: true });
    const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${id.slice(0, 8)}${ext}`;
    await fs.copyFile(replayPath, path.join(folder, filename));
    const stat = await fs.stat(path.join(folder, filename));
    const clip = {
      id, agentId, filename, reason, bytes: stat.size, createdAt: new Date().toISOString(), source: agent.sourceName || agent.name,
      formatting: { status: 'queued', stage: 'Waiting for formatter', progress: 0, aspectRatio: agent.outputAspectRatio || '9:16', updatedAt: new Date().toISOString() }
    };
    clips.unshift(clip); await persistClips();
    rt.lastSavedAt = Date.now();
    log(agentId, 'clip', 'Replay saved · formatting queued', reason);
    enqueueFormatting(clip.id);
    return clip;
  } finally { rt.isSaving = false; }
}

const formattingQueue = [];
const queuedFormatting = new Set();
let formattingWorkerRunning = false;
function enqueueFormatting(clipId) {
  if (queuedFormatting.has(clipId)) return;
  const clip = clips.find((item) => item.id === clipId);
  if (!clip || clip.formatting?.status === 'ready' || clip.formatting?.status === 'failed') return;
  queuedFormatting.add(clipId);
  formattingQueue.push(clipId);
  void drainFormattingQueue();
}
async function drainFormattingQueue() {
  if (formattingWorkerRunning) return;
  formattingWorkerRunning = true;
  try {
    while (formattingQueue.length) {
      const clipId = formattingQueue.shift();
      queuedFormatting.delete(clipId);
      const clip = clips.find((item) => item.id === clipId);
      const agent = agents.find((item) => item.id === clip?.agentId);
      if (!clip || !agent) continue;
      try { await formatClip(clip, agent); }
      catch (error) {
        clip.formatting = { ...clip.formatting, status: 'failed', stage: 'Formatting needs attention', error: error.message, updatedAt: new Date().toISOString() };
        await persistClips().catch(() => {});
        log(clip.agentId, 'error', 'Formatting worker stopped unexpectedly', error.message);
      }
    }
  } finally { formattingWorkerRunning = false; }
}
async function formatClip(clip, agent) {
  const sourcePath = path.join(CLIPS, clip.agentId, clip.filename);
  const folder = path.join(CLIPS, clip.agentId, 'formatted');
  const outputName = `${clip.id}-${(agent.outputAspectRatio || '9:16').replace(':', 'x')}.mp4`;
  const outputPath = path.join(folder, outputName);
  const partialPath = path.join(folder, `${clip.id}.partial.mp4`);
  const formatting = clip.formatting || { status: 'queued', progress: 0 };
  const setStage = async (stage, progress, extra = {}) => {
    Object.assign(formatting, extra, { status: 'processing', stage, progress, updatedAt: new Date().toISOString() });
    clip.formatting = formatting;
    await persistClips();
  };
  formatting.status = 'processing'; clip.formatting = formatting;
  try {
    await fs.access(sourcePath);
    await setStage('Checking source video', 5);
    const inputInfo = await probeMedia(sourcePath);
    const plan = formattingPlan(agent.outputAspectRatio, inputInfo.width, inputInfo.height);
    formatting.inputInfo = inputInfo;
    formatting.plan = plan;
    formatting.aspectRatio = plan.aspectRatio;
    formatting.outputFilename = outputName;
    await setStage('Rendering upload format', 8, { inputInfo, plan, aspectRatio: plan.aspectRatio, outputFilename: outputName });
    await fs.mkdir(folder, { recursive: true });
    await fs.rm(partialPath, { force: true });
    await fs.rm(outputPath, { force: true });
    let lastProgressSave = 0;
    await renderFormattedClip(sourcePath, partialPath, plan, {
      onProgress: (percent) => {
        formatting.progress = 8 + Math.round(percent * 0.86);
        formatting.stage = `Rendering upload format · ${percent}%`;
        formatting.updatedAt = new Date().toISOString();
        if (Date.now() - lastProgressSave > 2500) {
          lastProgressSave = Date.now();
          void persistClips().catch((error) => log(clip.agentId, 'error', 'Could not save formatting progress', error.message));
        }
      }
    });
    await fs.rename(partialPath, outputPath);
    await setStage('Checking rendered video', 96);
    const outputInfo = await probeMedia(outputPath);
    const dimensionsMatch = outputInfo.width === plan.width && outputInfo.height === plan.height;
    const durationMatch = Math.abs(outputInfo.duration - inputInfo.duration) <= Math.max(1, inputInfo.duration * 0.01);
    const audioPreserved = !inputInfo.hasAudio || outputInfo.hasAudio;
    const qualityCheck = { passed: dimensionsMatch && durationMatch && audioPreserved, dimensionsMatch, durationMatch, audioPreserved, outputInfo };
    if (!qualityCheck.passed) throw new Error('The output did not pass video, duration, or audio checks. Retry formatting after checking the source and FFmpeg installation.');
    Object.assign(formatting, {
      status: 'ready', stage: 'Ready for review', progress: 100, outputFilename: outputName,
      outputInfo, qualityCheck, layout: plan.layout, explanation: plan.explanation,
      completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), error: ''
    });
    await persistClips();
    log(clip.agentId, 'clip', 'Formatted clip ready for review', `${plan.aspectRatio} · ${plan.layout}`);
  } catch (error) {
    await fs.rm(partialPath, { force: true }).catch(() => {});
    Object.assign(formatting, { status: 'failed', stage: 'Formatting needs attention', error: error.message, updatedAt: new Date().toISOString() });
    await persistClips();
    log(clip.agentId, 'error', 'Clip formatting failed', error.message);
  }
}
async function retryFormatting(clipId) {
  const clip = clips.find((item) => item.id === clipId);
  if (!clip) throw new Error('Clip not found.');
  if (clip.formatting?.status === 'processing') throw new Error('This clip is already being formatted.');
  if (!clip.formatting || clip.formatting.status === 'ready') throw new Error('This clip does not need formatting retry.');
  clip.formatting.status = 'queued'; clip.formatting.stage = 'Queued for retry'; clip.formatting.progress = 0; clip.formatting.error = '';
  await persistClips();
  enqueueFormatting(clip.id);
  return clip;
}

function refreshHype(agent) {
  const meter = runtime.get(agent.id).hype;
  meter.windowMs = Number(agent.windowSeconds) * 1000;
  meter.minMessages = Number(agent.minMessages);
  meter.multiplier = Number(agent.multiplier);
  meter.cooldownMs = Number(agent.cooldownSeconds) * 1000;
}

function parseTags(raw) {
  return Object.fromEntries(raw.split(';').map((part) => { const [key, ...values] = part.split('='); return [key, values.join('=')]; }));
}
function restartTwitch() {
  clearTimeout(twitchReconnectTimer);
  for (const rt of runtime.values()) { rt.twitchSocket?.close(); rt.twitchSocket = null; rt.twitchStatus = 'not_configured'; }
  const nick = process.env.TWITCH_NICK, token = process.env.TWITCH_OAUTH_TOKEN;
  const targets = agents.filter((agent) => agent.enabled && agent.twitchChannel.trim());
  if (!targets.length || !nick || !token) return;
  const socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  for (const agent of targets) { runtime.get(agent.id).twitchSocket = socket; runtime.get(agent.id).twitchStatus = 'connecting'; }
  socket.addEventListener('open', () => {
    socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n');
    socket.send(`PASS oauth:${token.replace(/^oauth:/, '')}\r\n`);
    socket.send(`NICK ${nick.toLowerCase()}\r\n`);
    for (const agent of targets) socket.send(`JOIN #${agent.twitchChannel.replace(/^#/, '').toLowerCase()}\r\n`);
  });
  socket.addEventListener('message', (event) => {
    for (const line of String(event.data).split(/\r?\n/)) {
      if (!line) continue;
      if (line.startsWith('PING ')) { socket.send(line.replace('PING', 'PONG') + '\r\n'); continue; }
      if (line.includes(' 001 ')) { for (const agent of targets) runtime.get(agent.id).twitchStatus = 'connected'; continue; }
      if (line.includes('NOTICE * :Login authentication failed')) {
        for (const agent of targets) { runtime.get(agent.id).twitchStatus = 'error'; log(agent.id, 'error', 'Twitch chat login failed', 'Check TWITCH_NICK and the user OAuth token with chat:read.'); }
        continue;
      }
      const parsed = line.match(/^@([^ ]+) :([^!]+)!.* PRIVMSG #([^ ]+) :(.*)$/);
      if (parsed) {
        const tags = parseTags(parsed[1]);
        const channel = parsed[3].toLowerCase();
        const matchingAgents = targets.filter((item) => item.twitchChannel.replace(/^#/, '').toLowerCase() === channel);
        for (const agent of matchingAgents) ingestChat(agent, { id: `${tags.id}:${agent.id}`, user: parsed[2], text: parsed[4] });
      }
    }
  });
  socket.addEventListener('error', () => { for (const agent of targets) { runtime.get(agent.id).twitchStatus = 'error'; log(agent.id, 'error', 'Twitch chat connection failed', 'Check the Twitch chat:read token and network.'); } });
  socket.addEventListener('close', () => {
    for (const agent of targets) if (runtime.get(agent.id).twitchSocket === socket) runtime.get(agent.id).twitchStatus = 'disconnected';
    twitchReconnectTimer = setTimeout(restartTwitch, 10000);
  });
}

async function youtubePoll(agent) {
  const rt = runtime.get(agent.id);
  if (!agent.enabled) { rt.youtubeStatus = 'paused'; return; }
  if (!process.env.YOUTUBE_ACCESS_TOKEN || !agent.youtubeLiveChatId) { rt.youtubeStatus = 'not_configured'; return; }
  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/liveChat/messages');
    url.searchParams.set('liveChatId', agent.youtubeLiveChatId); url.searchParams.set('part', 'snippet,authorDetails'); url.searchParams.set('maxResults', '200');
    if (rt.youtubePageToken) url.searchParams.set('pageToken', rt.youtubePageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.YOUTUBE_ACCESS_TOKEN}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || `YouTube API returned ${response.status}`);
    rt.youtubeStatus = 'connected'; rt.youtubePageToken = body.nextPageToken || rt.youtubePageToken;
    for (const item of body.items || []) {
      const snippet = item.snippet || {};
      const text = snippet.textMessageDetails?.messageText || snippet.superChatDetails?.userComment || snippet.memberMilestoneChatDetails?.userComment || snippet.messageType || '';
      if (String(snippet.messageType || '').toLowerCase().includes('poll')) {
        const question = snippet.pollDetails?.metadata?.questionText || 'A live poll was created or updated.';
        recordSignal(agent, { type: 'poll_interaction', source: 'youtube_live_chat', reason: `YouTube poll interaction: ${question}` });
      }
      ingestChat(agent, { id: `yt:${item.id}`, user: item.authorDetails?.channelId, text });
    }
    rt.youtubeTimer = setTimeout(() => youtubePoll(agent), Math.max(1000, Math.min(Number(body.pollingIntervalMillis || 5000), 30000)));
  } catch (error) {
    rt.youtubeStatus = 'error'; log(agent.id, 'error', 'YouTube Live chat unavailable', error.message);
    rt.youtubeTimer = setTimeout(() => youtubePoll(agent), 15000);
  }
}

async function connectAgent(agent, body = {}) {
  const rt = runtime.get(agent.id);
  if (rt.reconnecting) return;
  rt.reconnecting = true;
  rt.obs?.close();
  const host = String(body.host || agent.obsHost || '127.0.0.1');
  const port = Number(body.port || agent.obsPort || 4455);
  rt.password = body.password ?? rt.password;
  rt.obsInfo = { connected: false, replayBufferActive: false, error: '', host, port };
  rt.obs = new ObsClient({ host, port, password: rt.password });
  rt.obs.onEvent((type, data) => handleObsEvent(agent, type, data));
  try {
    const status = await rt.obs.connect();
    rt.obsInfo = { ...rt.obsInfo, connected: true, replayBufferActive: Boolean(status.outputActive), error: '' };
    if (!status.outputActive) {
      try { await rt.obs.request('StartReplayBuffer'); rt.obsInfo.replayBufferActive = true; }
      catch (error) { rt.obsInfo.error = `Connected, but OBS Replay Buffer could not start: ${error.message}`; }
    }
    agent.obsHost = host; agent.obsPort = port; await persist();
    rt.shouldReconnect = true;
    log(agent.id, 'system', 'Connected to OBS', `${host}:${port}`);
  } catch (error) { rt.obsInfo.error = error.message; throw error; }
  finally { rt.reconnecting = false; }
}

function getState() {
  return {
    agents: agents.map((agent) => {
      const rt = runtime.get(agent.id);
      const items = clips.filter((clip) => clip.agentId === agent.id);
      return { ...agent, obs: rt.obsInfo, speech: rt.speechStatus, isSaving: rt.isSaving, clips: items, events: rt.events, chat: { twitch: rt.twitchStatus, youtube: rt.youtubeStatus },
        capabilities: { capture: 'OBS Replay Buffer captures the scene configured for this OBS instance.', criteria: 'Chat spikes, configured OBS loudness peaks, and optional speech phrase cues are detected. Speech reaction phrases are heuristic, not vocal emotion recognition.', visualDetection: 'Not enabled in this build.' } };
    }), maxAgents: 5, publishing: { status: 'not_configured', note: 'Official upload integrations are not implemented yet. No publishing is simulated.' }
  };
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
async function bodyJson(req) { let raw = ''; for await (const part of req) { raw += part; if (raw.length > 50000) throw new Error('Request too large.'); } return raw ? JSON.parse(raw) : {}; }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, getState());
    if (req.method === 'PUT' && url.pathname === '/api/criteria') {
      const body = await bodyJson(req);
      const criteria = String(body.criteria ?? '').slice(0, 2000);
      agents = agents.map((agent) => ({ ...agent, criteria }));
      await persist();
      for (const agent of agents) log(agent.id, 'system', 'Shared clip criteria updated', 'This profile applies to every agent.');
      return send(res, 200, getState());
    }
    const match = url.pathname.match(/^\/api\/agents\/(agent-[1-5])(?:\/(connect|disconnect|save))?$/);
    if (match) {
      const [, id, action] = match; const agent = agents.find((item) => item.id === id); const rt = runtime.get(id);
      if (!agent) return send(res, 404, { error: 'Agent slot not found.' });
      if (req.method === 'POST' && action === 'connect') { await connectAgent(agent, await bodyJson(req)); return send(res, 200, getState()); }
      if (req.method === 'POST' && action === 'disconnect') { rt.shouldReconnect = false; rt.obs?.close(); rt.obs = null; rt.obsInfo.connected = false; rt.obsInfo.replayBufferActive = false; return send(res, 200, getState()); }
      if (req.method === 'POST' && action === 'save') { const body = await bodyJson(req); const clip = await saveReplay(id, body.reason || 'Manual save'); return send(res, 200, { clip, state: getState() }); }
      return send(res, 405, { error: 'Method not allowed.' });
    }
    const settingsMatch = url.pathname.match(/^\/api\/agents\/(agent-[1-5])\/settings$/);
    if (req.method === 'PUT' && settingsMatch) {
      const agent = agents.find((item) => item.id === settingsMatch[1]); if (!agent) return send(res, 404, { error: 'Agent slot not found.' });
      const body = await bodyJson(req);
      Object.assign(agent, {
        name: String(body.name || agent.name).slice(0, 80), enabled: Boolean(body.enabled), sourceName: String(body.sourceName || '').slice(0, 100),
        obsHost: String(body.host || agent.obsHost || '127.0.0.1').trim().slice(0, 255),
        obsPort: Number.isInteger(Number(body.port)) && Number(body.port) >= 1 && Number(body.port) <= 65535 ? Number(body.port) : agent.obsPort,
        outputAspectRatio: ['9:16', '1:1', '4:5', '16:9'].includes(body.outputAspectRatio) ? body.outputAspectRatio : agent.outputAspectRatio,
        speechMonitoringEnabled: Boolean(body.speechMonitoringEnabled), speechAudioDevice: String(body.speechAudioDevice || '').slice(0, 200),
        twitchChannel: String(body.twitchChannel || '').replace(/^#/, '').slice(0, 60), youtubeLiveChatId: String(body.youtubeLiveChatId || '').slice(0, 200),
        autoSaveHype: Boolean(body.autoSaveHype), minMessages: Math.max(3, Math.min(100, Number(body.minMessages || 8))), windowSeconds: Math.max(5, Math.min(120, Number(body.windowSeconds || 20))),
        multiplier: Math.max(1.2, Math.min(10, Number(body.multiplier || 2.5))), cooldownSeconds: Math.max(20, Math.min(3600, Number(body.cooldownSeconds || 90))),
        clipDurationSeconds: Math.max(150, Math.min(210, Number(body.clipDurationSeconds || 180))), postRollSeconds: Math.max(5, Math.min(60, Number(body.postRollSeconds || 20))),
        audioInputName: String(body.audioInputName || '').slice(0, 100), audioPeakDb: Math.max(-30, Math.min(0, Number(body.audioPeakDb ?? -8)))
      });
      refreshHype(agent); await persist(); restartTwitch();
      await configureSpeech(agent);
      runtime.get(agent.id).audio = new AudioPeakDetector({ thresholdDb: agent.audioPeakDb });
      if (!agent.autoSaveHype) { clearTimeout(runtime.get(agent.id).pendingMomentTimer); runtime.get(agent.id).pendingMomentTimer = null; runtime.get(agent.id).pendingMoment = null; }
      clearTimeout(runtime.get(agent.id).youtubeTimer); void youtubePoll(agent);
      return send(res, 200, getState());
    }
    if (req.method === 'POST' && url.pathname === '/api/stop-auto') {
      agents = agents.map((agent) => ({ ...agent, autoSaveHype: false }));
      await persist();
      for (const agent of agents) {
        const rt = runtime.get(agent.id); clearTimeout(rt.pendingMomentTimer); rt.pendingMomentTimer = null; rt.pendingMoment = null;
        log(agent.id, 'system', 'Global stop used', 'Automatic moment saves paused for every agent.');
      }
      return send(res, 200, getState());
    }
    const retryMatch = url.pathname.match(/^\/api\/clips\/([^/]+)\/retry-format$/);
    if (req.method === 'POST' && retryMatch) {
      const clip = await retryFormatting(decodeURIComponent(retryMatch[1]));
      return send(res, 202, { clip });
    }
    const clipMatch = url.pathname.match(/^\/api\/clips\/([^/]+)(\/formatted)?$/);
    if (req.method === 'GET' && clipMatch) {
      const id = decodeURIComponent(clipMatch[1]); const clip = clips.find((item) => item.id === id);
      if (!clip) return send(res, 404, { error: 'Clip not found.' });
      if (clipMatch[2] && clip.formatting?.status !== 'ready') return send(res, 409, { error: 'Formatted clip is not ready yet.' });
      const filename = clipMatch[2] ? clip.formatting.outputFilename : clip.filename;
      const file = path.join(CLIPS, clip.agentId, ...(clipMatch[2] ? ['formatted', filename] : [filename]));
      if (!fsSync.existsSync(file)) return send(res, 404, { error: 'Clip file is missing.' });
      const ext = path.extname(file).toLowerCase();
      const contentType = ext === '.mp4' || ext === '.mov' ? 'video/mp4' : ext === '.webm' ? 'video/webm' : 'video/x-matroska';
      const size = fsSync.statSync(file).size;
      const range = req.headers.range;
      if (range && !url.searchParams.has('download')) {
        const [startText, endText] = range.replace(/bytes=/, '').split('-');
        const start = Number(startText || 0); const end = Math.min(Number(endText || size - 1), size - 1);
        if (!Number.isSafeInteger(start) || start < 0 || start >= size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
        fsSync.createReadStream(file, { start, end }).pipe(res); return;
      }
      res.writeHead(200, { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', ...(url.searchParams.has('download') ? { 'Content-Disposition': `attachment; filename="${filename}"` } : {}), 'Content-Length': size });
      fsSync.createReadStream(file).pipe(res); return;
    }
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': mime['.html'] }); fsSync.createReadStream(path.join(ROOT, 'index.html')).pipe(res); return; }
    if (req.method === 'GET' && ['/app.css', '/app.js'].includes(url.pathname)) { const file = path.join(ROOT, url.pathname.slice(1)); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] }); fsSync.createReadStream(file).pipe(res); return; }
    send(res, 404, { error: 'Not found.' });
  } catch (error) { send(res, 400, { error: error.message || 'Request failed.' }); }
});

restartTwitch();
for (const agent of agents) if (agent.enabled) {
  void youtubePoll(agent);
  void configureSpeech(agent);
}
for (const clip of clips) {
  if (['queued', 'processing'].includes(clip.formatting?.status)) enqueueFormatting(clip.id);
}
setInterval(async () => {
  for (const agent of agents) {
    const rt = runtime.get(agent.id);
    if (rt.obs?.state === 'connected') {
      try {
        const status = await rt.obs.request('GetReplayBufferStatus');
        rt.obsInfo = { ...rt.obsInfo, connected: true, replayBufferActive: Boolean(status.outputActive), error: '' };
      } catch (error) { rt.obsInfo.connected = false; rt.obsInfo.replayBufferActive = false; rt.obsInfo.error = error.message; }
    } else {
      rt.obsInfo.connected = false;
      if (rt.shouldReconnect && agent.enabled && !rt.reconnecting) {
        void connectAgent(agent).catch((error) => { rt.obsInfo.error = `OBS reconnecting: ${error.message}`; });
      }
    }
  }
}, 5000);
const port = Number(process.env.PORT || 4179);
server.listen(port, '127.0.0.1', () => console.log(`Stream Clipper Agent running at http://127.0.0.1:${port}`));
server.on('close', () => { clearTimeout(twitchReconnectTimer); for (const rt of runtime.values()) { rt.obs?.close(); rt.twitchSocket?.close(); clearTimeout(rt.youtubeTimer); void rt.speech?.stop(); } });
