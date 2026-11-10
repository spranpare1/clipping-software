import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { selectMoments, requestedCount, aspectFilter } from './engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const sourceDir = path.join(dataDir, 'sources');
const outputDir = path.join(dataDir, 'clips');
for (const dir of [dataDir, sourceDir, outputDir]) mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dataDir, 'splice.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(readFileSync(path.join(here, 'migrations/001_init.sql'), 'utf8'));
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/media', express.static(outputDir));
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const run = (bin, args, onLine, onStdout) => new Promise((resolve, reject) => {
  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', stdout = '';
  proc.stdout.on('data', d => { const s=d.toString(); stdout=(stdout+s).slice(-8000); onStdout?.(s); });
  proc.stderr.on('data', d => { const s = d.toString(); stderr += s; onLine?.(s); if (stderr.length > 8000) stderr = stderr.slice(-8000); });
  proc.on('error', reject);
  proc.on('close', code => code === 0 ? resolve(stdout.trim() || stderr) : reject(new Error(`${bin} exited with ${code}: ${stderr.slice(-1200)}`)));
});
const updateJob = (jobId, fields) => {
  const keys = Object.keys(fields); db.prepare(`UPDATE jobs SET ${keys.map(k => `${k}=@${k}`).join(', ')}, updated_at=@updated_at WHERE id=@id`).run({ ...fields, id: jobId, updated_at: now() });
};
function safeName(s) { return path.basename(String(s || 'video').replace(/[^\w .()-]/g, '_')).slice(0, 150) || 'video'; }
function publicProject(row) {
  return { ...row, clips: db.prepare('SELECT id,title,start,duration,score,reason,created_at FROM clips WHERE project_id=? ORDER BY created_at DESC').all(row.id) };
}
app.get('/api/health', (_req, res) => res.json({ ok: true, ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg', storage: 'local disk', maxUploadBytes: process.env.MAX_UPLOAD_BYTES || null, note: 'Local disk capacity and reverse-proxy request limits apply.' }));
app.get('/api/projects', (_req, res) => res.json(db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all().map(publicProject)));
app.get('/api/jobs', (_req, res) => res.json(db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all().map(j => ({ ...j, config: JSON.parse(j.config) }))));
app.post('/api/uploads', (req, res) => {
  const { filename, size, chunkSize = 8 * 1024 * 1024 } = req.body || {};
  const bytes = Number(size); const chunk = Number(chunkSize);
  if (!filename || !Number.isSafeInteger(bytes) || bytes <= 0 || !Number.isSafeInteger(chunk) || chunk < 256 * 1024 || chunk > 32 * 1024 * 1024) return res.status(400).json({ error: 'Provide a filename, positive byte size, and chunk size from 256 KB to 32 MB.' });
  const max = Number(process.env.MAX_UPLOAD_BYTES || 0);
  if (max && bytes > max) return res.status(413).json({ error: `Upload exceeds configured MAX_UPLOAD_BYTES (${max}).` });
  const projectId = id(), uploadId = id(), stamp = now();
  db.prepare('INSERT INTO projects(id,name,source_name,status,created_at) VALUES(?,?,?,?,?)').run(projectId, safeName(filename), safeName(filename), 'uploading', stamp);
  db.prepare('INSERT INTO uploads(id,project_id,filename,total_bytes,chunk_size,created_at) VALUES(?,?,?,?,?,?)').run(uploadId, projectId, safeName(filename), bytes, chunk, stamp);
  mkdirSync(path.join(sourceDir, uploadId), { recursive: true });
  res.status(201).json({ projectId, uploadId, chunkSize: chunk, chunks: Math.ceil(bytes / chunk), receivedBytes: 0 });
});
app.put('/api/uploads/:uploadId/chunks/:index', async (req, res) => {
  const upload = db.prepare('SELECT * FROM uploads WHERE id=?').get(req.params.uploadId);
  if (!upload || upload.status !== 'uploading') return res.status(404).json({ error: 'Upload not found or no longer active.' });
  const index = Number(req.params.index), count = Math.ceil(upload.total_bytes / upload.chunk_size);
  if (!Number.isInteger(index) || index < 0 || index >= count) return res.status(400).json({ error: 'Invalid chunk index.' });
  const file = path.join(sourceDir, upload.id, `${index}.part`), tmp = `${file}.tmp`;
  try {
    await new Promise((resolve, reject) => { const out = createWriteStream(tmp); req.pipe(out); out.on('finish', resolve); out.on('error', reject); req.on('error', reject); });
    const expected = Math.min(upload.chunk_size, upload.total_bytes - index * upload.chunk_size);
    if (statSync(tmp).size !== expected) { unlinkSync(tmp); return res.status(400).json({ error: `Chunk ${index} size mismatch; expected ${expected} bytes.` }); }
    renameSync(tmp, file);
    const files = Array.from({ length: count }, (_, i) => path.join(sourceDir, upload.id, `${i}.part`)).filter(existsSync);
    const sum = files.reduce((n, f) => n + statSync(f).size, 0);
    db.prepare('UPDATE uploads SET chunks=?,received_bytes=? WHERE id=?').run(files.length, sum, upload.id);
    res.json({ receivedBytes: sum, chunksReceived: files.length, chunksTotal: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/uploads/:uploadId/complete', async (req, res) => {
  const upload = db.prepare('SELECT * FROM uploads WHERE id=?').get(req.params.uploadId);
  if (!upload) return res.status(404).json({ error: 'Upload not found.' });
  if (upload.status === 'complete') return res.json(db.prepare('SELECT * FROM projects WHERE id=?').get(upload.project_id));
  const count = Math.ceil(upload.total_bytes / upload.chunk_size), dir = path.join(sourceDir, upload.id);
  const missing = Array.from({ length: count }, (_, i) => i).filter(i => !existsSync(path.join(dir, `${i}.part`)));
  if (missing.length) return res.status(409).json({ error: `Upload is incomplete. Missing chunks: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}`, missing });
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(upload.project_id);
  const finalPath = path.join(sourceDir, `${upload.project_id}-${safeName(upload.filename)}`);
  try {
    const out = createWriteStream(finalPath);
    for (let i = 0; i < count; i++) await new Promise((resolve, reject) => { const input = createReadStream(path.join(dir, `${i}.part`)); input.on('error', reject); input.on('end', resolve); input.pipe(out, { end: i === count - 1 }); });
    const probe = await run(process.env.FFPROBE_PATH || 'ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',finalPath]);
    const duration = Number(probe.trim());
    db.prepare('UPDATE projects SET source_path=?,duration=?,status=? WHERE id=?').run(finalPath, duration || 0, 'ready', project.id);
    db.prepare('UPDATE uploads SET status=? WHERE id=?').run('complete', upload.id);
    res.json(db.prepare('SELECT * FROM projects WHERE id=?').get(project.id));
  } catch (e) { res.status(422).json({ error: `Could not finalize video: ${e.message}` }); }
});

const active = new Set();
async function processJob(job) {
  if (active.has(job.id)) return;
  active.add(job.id);
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(job.project_id), config = JSON.parse(job.config);
  try {
    // Rebuild from the start after a worker restart or explicit retry; completed clip rows
    // from this job are removed first so retries cannot create duplicate gallery entries.
    const prior = db.prepare('SELECT path FROM clips WHERE job_id=?').all(job.id);
    for (const clip of prior) if (existsSync(clip.path)) unlinkSync(clip.path);
    db.prepare('DELETE FROM clips WHERE job_id=?').run(job.id);
    updateJob(job.id, { status: 'processing', stage: 'Scanning scene changes', progress: 3 });
    if (!project?.source_path || !existsSync(project.source_path)) throw new Error('Source video is missing. Re-upload the source to continue.');
    const cuts = [];
    let tail = '';
    let progressLine = '';
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner','-loglevel','info','-progress','pipe:1','-nostats','-i',project.source_path,'-vf',"select='gt(scene,0.25)',showinfo",'-an','-f','null','-'], chunk => {
      tail += chunk;
      const lines = tail.split(/\r?\n/);
      tail = lines.pop() || '';
      for (const line of lines) { const match = line.match(/pts_time:([0-9.]+)/); if (match) cuts.push(Number(match[1])); }
    }, chunk => {
      progressLine += chunk;
      const lines=progressLine.split(/\r?\n/);progressLine=lines.pop()||'';
      for(const line of lines){const match=line.match(/^out_time_ms=(\d+)/);if(match){const pct=Math.min(12,Math.max(3,Math.floor(Number(match[1])/1e6/Math.max(project.duration,1)*12)));updateJob(job.id,{progress:pct});}}
    });
    const moments = selectMoments(project.duration, config.count, config.length, cuts);
    const requested = requestedCount(config.count, project.duration);
    if (!moments.length) throw new Error('Source is shorter than the minimum clip length. Choose a shorter preferred length or upload a longer video.');
    updateJob(job.id, { stage: 'Rendering clips', progress: 15 });
    for (let i = 0; i < moments.length; i++) {
      const latest = db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id);
      if (latest.status === 'cancelled') return;
      const m = moments[i], clipId = id(), out = path.join(outputDir, `${clipId}.mp4`);
      await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner','-loglevel','error','-ss',String(m.start),'-i',project.source_path,'-t',String(m.duration),'-map','0:v:0','-map','0:a?','-vf',aspectFilter(config.aspect),'-c:v','libx264','-preset',process.env.FFMPEG_PRESET || 'veryfast','-crf','21','-c:a','aac','-b:a','160k','-movflags','+faststart','-y',out]);
      const title = `${config.category || 'Highlight'} ${String(i + 1).padStart(2,'0')}`;
      const reason = m.sceneCount ? `Contains ${m.sceneCount} detected scene changes; distinct window selected by visual-change density. Instruction saved for future semantic ranking: “${(config.instruction||'').slice(0,65)}”. No speech understanding is configured.` : `Distinct source section selected${cuts.length ? ' with low scene-change density' : ' by even spacing because no scene changes were detected'}. Score is an editorial proxy, not a performance prediction.`;
      db.prepare('INSERT INTO clips(id,project_id,job_id,title,start,duration,score,reason,path,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(clipId, project.id, job.id, title, m.start, m.duration, m.score, reason, out, now());
      updateJob(job.id, { progress: Math.round(15 + ((i + 1) / moments.length) * 80) });
    }
    const shortfall = requested - moments.length;
    updateJob(job.id, { status: 'completed', stage: shortfall > 0 ? `Complete · ${shortfall} fewer than requested` : 'Complete', progress: 100, error: shortfall > 0 ? `Created ${moments.length} clips. ${shortfall} fewer than requested because this source does not contain enough non-overlapping material at the selected length.` : null });
    db.prepare('UPDATE projects SET status=? WHERE id=?').run('complete', project.id);
  } catch (e) {
    updateJob(job.id, { status: 'failed', stage: 'Needs attention', error: e.message });
    db.prepare('UPDATE projects SET status=? WHERE id=?').run('error', project.id);
  } finally { active.delete(job.id); }
}
app.post('/api/projects/:projectId/jobs', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.projectId);
  if (!project || !project.source_path) return res.status(404).json({ error: 'Project source is unavailable.' });
  const running = db.prepare("SELECT id FROM jobs WHERE project_id=? AND status IN ('queued','processing')").get(project.id);
  if (running) return res.status(409).json({ error: 'This project already has a generation job running.' });
  const { count='5', length=35, aspect='9:16', category='Highlights', platform='Any platform', instruction='', mode='review' } = req.body || {};
  const config = { count: count === 'auto' ? 'auto' : Math.max(1, Math.min(50, Number(count) || 5)), length: Math.max(10,Math.min(90,Number(length)||35)), aspect, category, platform, instruction: String(instruction).slice(0,500), mode };
  const jobId = id(), stamp=now();
  db.prepare('INSERT INTO jobs(id,project_id,status,stage,progress,config,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(jobId, project.id, 'queued', 'Waiting for worker', 0, JSON.stringify(config), stamp, stamp);
  processJob(db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId));
  res.status(202).json({ id: jobId, project_id: project.id, status: 'queued', stage: 'Waiting for worker', progress: 0, config });
});
app.post('/api/jobs/:id/cancel', (req,res) => { const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id); if (!job) return res.status(404).json({error:'Job not found.'}); updateJob(job.id,{status:'cancelled',stage:'Cancelled'}); res.json({ok:true}); });
app.post('/api/jobs/:id/retry', (req,res) => { const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id); if (!job) return res.status(404).json({error:'Job not found.'}); if (!['failed','cancelled','completed'].includes(job.status)) return res.status(409).json({error:'Only completed, failed, or cancelled jobs can be retried.'}); const running=db.prepare("SELECT id FROM jobs WHERE project_id=? AND status IN ('queued','processing')").get(job.project_id); if (running) return res.status(409).json({error:'Another job is already running for this project.'}); updateJob(job.id,{status:'queued',stage:'Retry queued',progress:0,error:null}); processJob(db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id)); res.json({ok:true}); });
app.get('/api/projects/:id', (req,res) => { const p=db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id); if (!p) return res.status(404).json({error:'Project not found.'}); res.json(publicProject(p)); });
app.get('/api/clips/:id/download', (req,res) => { const clip=db.prepare('SELECT * FROM clips WHERE id=?').get(req.params.id); if (!clip || !existsSync(clip.path)) return res.status(404).json({error:'Clip not found.'}); res.download(clip.path, `${safeName(clip.title)}.mp4`); });
app.get('/api/clips/:id/preview', (req,res) => { const clip=db.prepare('SELECT * FROM clips WHERE id=?').get(req.params.id); if (!clip || !existsSync(clip.path)) return res.status(404).end(); res.sendFile(clip.path); });
app.get('/api/accounts', (_req,res) => res.json([{platform:'YouTube Shorts',status:'not_configured',requirement:'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, configure OAuth consent, and enable YouTube Data API video upload.'},{platform:'TikTok',status:'not_configured',requirement:'Register a TikTok developer app, obtain Content Posting API approval, and set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET.'},{platform:'Instagram Reels',status:'not_configured',requirement:'Use a Meta app with Instagram Graph API publishing permissions and an eligible professional account.'},{platform:'Facebook Reels',status:'not_configured',requirement:'Use a Meta app with Page publishing permissions and review for the relevant video publishing scopes.'}]));
app.get('/api/publishing', (_req,res) => res.json({items:[],available:false,requirement:'Publishing is not enabled until official OAuth credentials and platform approvals are configured. Download clips for manual upload.'}));
app.use((err,_req,res,_next)=>{ console.error(err); res.status(500).json({error:err.message || 'Server error'}); });
const port=Number(process.env.PORT||3001);
app.listen(port, process.env.HOST || '127.0.0.1', ()=>console.log(`Splice Studio API listening on 127.0.0.1:${port}; data in ${dataDir}`));
// Requeue interrupted jobs after a restart. Rendering starts from scratch; completed clips remain persisted.
for (const job of db.prepare("SELECT * FROM jobs WHERE status IN ('queued','processing')").all()) { updateJob(job.id,{status:'queued',stage:'Resuming after server restart'}); processJob(db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id)); }
