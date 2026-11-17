import { spawn } from 'node:child_process';

const RATIOS = {
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '16:9': [1920, 1080]
};

function run(command, args, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let progress = '';
    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      progress += text;
      const rows = progress.split(/\r?\n/);
      progress = rows.pop() || '';
      for (const row of rows) {
        const [key, value] = row.split('=');
        if (key === 'out_time_ms' && Number.isFinite(Number(value))) onProgress?.(Number(value) / 1_000_000);
      }
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-12_000); });
    child.once('error', (error) => reject(new Error(`${command} could not start: ${error.message}`)));
    child.once('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited with code ${code}: ${stderr.trim().slice(-1800) || 'No diagnostic output.'}`)));
  });
}

export async function probeMedia(file, ffprobePath = process.env.FFPROBE_PATH || 'ffprobe') {
  const { stdout } = await run(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,width,height', '-of', 'json', file]);
  const result = JSON.parse(stdout);
  const video = result.streams?.find((stream) => stream.codec_type === 'video');
  if (!video?.width || !video?.height) throw new Error('The saved replay has no readable video stream. Try changing the OBS recording format.');
  const duration = Number(result.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not read the replay duration. Check the OBS file and recording format.');
  return { duration, width: video.width, height: video.height, hasAudio: result.streams.some((stream) => stream.codec_type === 'audio'), bytes: Number(result.format?.size || 0) };
}

export function formattingPlan(aspectRatio, width, height) {
  const ratio = Object.hasOwn(RATIOS, aspectRatio) ? aspectRatio : '9:16';
  const [targetWidth, targetHeight] = RATIOS[ratio];
  const sourceRatio = width / height;
  const targetRatio = targetWidth / targetHeight;
  const direction = sourceRatio > targetRatio ? 'wide' : sourceRatio < targetRatio ? 'tall' : 'matching';
  return {
    aspectRatio: ratio,
    width: targetWidth,
    height: targetHeight,
    layout: direction === 'matching' ? 'Original frame · exact fit' : `${direction === 'wide' ? 'Wide' : 'Tall'} source · fully visible over a blurred fill`,
    explanation: 'The full source frame stays visible; a blurred copy fills the remaining canvas. No face or gameplay crop is guessed.'
  };
}

export async function renderFormattedClip(input, output, plan, { ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg', onProgress } = {}) {
  const { width, height } = plan;
  const filter = `[0:v:0]split=2[background][foreground];[background]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=24:12[blurred];[foreground]scale=${width}:${height}:force_original_aspect_ratio=decrease[fit];[blurred][fit]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[outv]`;
  const probe = await probeMedia(input);
  await run(ffmpegPath, [
    '-hide_banner', '-y', '-i', input,
    '-filter_complex', filter, '-map', '[outv]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output
  ], { onProgress: (seconds) => onProgress?.(Math.min(99, Math.round((seconds / probe.duration) * 100))) });
}
