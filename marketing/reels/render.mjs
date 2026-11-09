#!/usr/bin/env node
/**
 * Renders the OpenNodes cartoon reels to MP4: a local static server serves the page,
 * headless Chrome draws every frame at an exact time (the page is frame-driven, nothing
 * runs on timers), and ffmpeg encodes 1080×1920 at 30 fps.
 *
 *   node render.mjs              → out/reel01.mp4 … out/reel10.mp4
 *   node render.mjs 3 7          → only reels 3 and 7
 *   node render.mjs 3 --still 0 4.2 --still-last → PNG stills for checking
 *
 * Needs Google Chrome and ffmpeg. The rounded system font (SF Pro Rounded) is copied into
 * .cache/ for the page to use; it is not part of the repository.
 */
import http from 'node:http';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = dirname(fileURLToPath(import.meta.url));
const CHROME =
  process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FPS = 30;
const W = 1080;
const H = 1920;

const args = process.argv.slice(2);
const stills = [];
let stillLast = false;
const ids = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--still') stills.push(Number(args[++i]));
  else if (args[i] === '--still-last') stillLast = true;
  else ids.push(Number(args[i]));
}
const reels = ids.length ? ids : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

mkdirSync(join(root, '.cache'), { recursive: true });
mkdirSync(join(root, 'out'), { recursive: true });
for (const [from, to] of [
  ['/System/Library/Fonts/SFNSRounded.ttf', 'rounded.ttf'],
  ['/System/Library/Fonts/Supplemental/Arial Black.ttf', 'black.ttf'],
]) {
  if (existsSync(from) && !existsSync(join(root, '.cache', to)))
    copyFileSync(from, join(root, '.cache', to));
}

/**
 * The voiceover of a reel, if there is one: audio/reelNN/beatXX.(mp3|wav), one file per
 * beat. Silence at both ends is trimmed so the beats follow the voice tightly.
 */
// Voice lines are sped up a little: short videos want a brisk read (pitch unchanged).
const TEMPO = Number(process.env.VOICE_TEMPO ?? 1.1);

const WHISPER_MODEL = process.env.WHISPER_MODEL ?? join(homedir(), '.cache', 'whisper', 'ggml-small.bin');

/** Words of a text, normalised for matching speech to the script. */
const norm = (w) => w.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');
const wordsOf = (text) => text.split(/\s+/).map(norm).filter(Boolean);

/** Speech recognition with a time for every word: [{w, from, to}] in seconds. */
function transcribe(file, tag) {
  const wav = join(root, '.cache', 'stt', `${tag}.wav`);
  mkdirSync(dirname(wav), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-ar', '16000', '-ac', '1', wav]);
  execFileSync('whisper-cli', ['-m', WHISPER_MODEL, '-f', wav, '-l', 'ru', '-ml', '1', '-sow', '-oj', '-of', wav.replace(/\.wav$/, ''), '-np'], { stdio: 'ignore' });
  const json = JSON.parse(readFileSync(wav.replace(/\.wav$/, '.json'), 'utf8'));
  return json.transcription
    .map((x) => ({ w: norm(x.text), from: x.offsets.from / 1000, to: x.offsets.to / 1000 }))
    .filter((x) => x.w);
}

const similar = (a, b) => {
  if (a === b) return 2;
  if (!a || !b) return -1;
  const n = Math.max(a.length, b.length);
  let same = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) same++;
  return same / n >= 0.6 || a.startsWith(b.slice(0, 4)) ? 1 : -1;
};

/** Needleman–Wunsch: the recognised word index for each script word (or -1). */
function align(script, heard) {
  const n = script.length;
  const m = heard.length;
  const S = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => -(i + j)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      S[i][j] = Math.max(S[i - 1][j - 1] + similar(script[i - 1], heard[j - 1].w), S[i - 1][j] - 1, S[i][j - 1] - 1);
  const at = new Array(n).fill(-1);
  for (let i = n, j = m; i > 0 && j > 0; ) {
    if (S[i][j] === S[i - 1][j - 1] + similar(script[i - 1], heard[j - 1].w)) {
      if (similar(script[i - 1], heard[j - 1].w) > 0) at[i - 1] = j - 1;
      i--;
      j--;
    } else if (S[i][j] === S[i - 1][j] - 1) i--;
    else j--;
  }
  return at;
}

/**
 * A whole-reel take (audio/reelNN/full.mp3 + script.txt, one spoken line per beat) is cut
 * into one piece per beat where the speech recogniser hears each line begin.
 */
function splitTake(id, dir) {
  const full = readdirSync(dir).find((f) => /^full\.(mp3|wav)$/.test(f));
  if (!full) return false;
  const lines = readFileSync(join(dir, 'script.txt'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const src = join(dir, full);
  const total = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString());
  const heard = transcribe(src, `reel${String(id).padStart(2, '0')}-full`);
  const script = [];
  lines.forEach((l, k) => wordsOf(l).forEach((w) => script.push({ w, k })));
  const at = align(script.map((x) => x.w), heard);
  // Per line: the first and last recognised word.
  const span = lines.map((_, k) => {
    const idx = script.map((x, i) => (x.k === k ? at[i] : -1)).filter((j) => j >= 0);
    return idx.length ? { a: heard[Math.min(...idx)].from, b: heard[Math.max(...idx)].to, matched: idx.length, of: script.filter((x) => x.k === k).length } : null;
  });
  span.forEach((x, k) => {
    if (!x || x.matched / x.of < 0.5) throw new Error(`reel ${id}: line ${k} was not recognised in the take (“${lines[k]}”)`);
  });
  const bounds = [0, ...span.slice(1).map((x, k) => (span[k].b + x.a) / 2), total];
  bounds.slice(0, -1).forEach((a, k) =>
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-ss', a.toFixed(3), '-to', bounds[k + 1].toFixed(3), join(dir, `beat${String(k).padStart(2, '0')}.wav`)])
  );
  console.log(`reel ${id}: take split by speech into ${lines.length} lines (${span.map((x) => `${x.matched}/${x.of}`).join(' ')} words matched)`);
  return true;
}

function prepareVoice(id) {
  const name = `reel${String(id).padStart(2, '0')}`;
  const dir = join(root, 'audio', name);
  if (!existsSync(dir)) return null;
  splitTake(id, dir);
  const files = [...new Set(readdirSync(dir).filter((f) => /^beat\d+\.(mp3|wav)$/.test(f)).map((f) => f.replace(/\.\w+$/, '')))]
    .sort()
    .map((b) => (existsSync(join(dir, `${b}.wav`)) ? `${b}.wav` : `${b}.mp3`));
  if (!files.length) return null;
  const cache = join(root, '.cache', 'audio', name);
  mkdirSync(cache, { recursive: true });
  return files.map((f) => {
    const out = join(cache, f.replace(/\.\w+$/, '.wav'));
    const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05';
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(dir, f), '-af', `${trim},areverse,${trim},areverse,atempo=${TEMPO}`, '-ar', '48000', '-ac', '2', out]);
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim());
    // When each word is said in this line (for word-synced subtitles).
    const words = transcribe(out, `${name}-${f.replace(/\.\w+$/, '')}`).map((x) => x.from);
    return { file: out, dur, words };
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
};
const server = http.createServer((req, res) => {
  const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none'],
});

try {
  for (const id of reels) {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error(`reel ${id}: ${e.message}`));
    // The beats' word counts (for splitting a whole-reel take) come from the page itself.
    await page.goto(`${base}/index.html?reel=${id}`, { waitUntil: 'load' });
    const voice = prepareVoice(id);
    const q = voice
      ? `&durs=${voice.map((v) => v.dur.toFixed(3)).join(',')}&wt=${voice.map((v) => v.words.map((x) => x.toFixed(2)).join(',')).join(';')}`
      : '';
    await page.goto(`${base}/index.html?reel=${id}${q}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const duration = await page.evaluate(() => window.REEL_DURATION);
    const name = `reel${String(id).padStart(2, '0')}`;

    if (stills.length || stillLast) {
      const times = [...stills, ...(stillLast ? [duration - 1 / FPS] : [])];
      for (const t of times) {
        await page.evaluate((x) => window.renderAt(x), t);
        const file = join(root, 'out', `${name}-${t.toFixed(2)}.png`);
        await page.screenshot({ path: file });
        console.log(file);
      }
      await page.close();
      continue;
    }

    const frames = Math.round(duration * FPS);
    const ff = spawn(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', join(root, 'out', `${name}.mp4`)],
      { stdio: ['pipe', 'inherit', 'inherit'] }
    );
    const started = Date.now();
    for (let f = 0; f < frames; f++) {
      await page.evaluate((x) => window.renderAt(x), f / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error(`ffmpeg ${c}`)))));
    if (voice) {
      // Each line starts with its beat (+80 ms); the video stream is copied as is.
      const starts = await page.evaluate(() => window.REEL_BEATS.map((b) => b.start));
      const video = join(root, 'out', `${name}.mp4`);
      const silent = join(root, 'out', `${name}-silent.mp4`);
      renameSync(video, silent);
      const inputs = voice.flatMap((v) => ['-i', v.file]);
      const delays = voice.map((v, k) => `[${k + 1}:a]adelay=${Math.round((starts[k] + 0.08) * 1000)}:all=1[a${k}]`).join(';');
      const mix = `${delays};${voice.map((_, k) => `[a${k}]`).join('')}amix=inputs=${voice.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad[a]`;
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, ...inputs, '-filter_complex', mix, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', duration.toFixed(3), video]);
      rmSync(silent);
    }
    console.log(`${name}.mp4  ${duration.toFixed(1)} s, ${frames} frames, ${((Date.now() - started) / 1000).toFixed(0)} s`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
