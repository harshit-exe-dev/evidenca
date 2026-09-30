#!/usr/bin/env node
/*
 * Evidenca film renderer (render.js)
 *
 * Reads a session timeline (.evidenca/<project>/timeline.json) plus the
 * screenshot frames captured by watcher/watch.py, and cuts a cinematic
 * proof-of-work film:
 *
 *   intro card -> screenshot montage (Ken Burns) -> commit title cards ->
 *   stats card -> HUMAN-MADE stamp.
 *
 * Grade: film grain + vignette, amber-on-ink trailer styling.
 *
 * Only dependencies: node and ffmpeg on PATH. No network, ever.
 *
 * Usage:
 *   node render.js --timeline /path/to/.evidenca/my-project/timeline.json \
 *                  --out /path/to/evidenca-film.mp4 [--format 16:9|9:16]
 *
 * Set TMPDIR to a roomy disk before running (intermediate segments live there).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FPS = 30;
const XFADE = 0.45;
const MAX_FRAMES = 24;
const FRAME_DUR = 1.4;

const INK = '0x0b0b0d';
const AMBER = '#f2b13d';
const CREAM = '#f5efe2';
const DIM = '#8a8578';

const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    out[args[i].replace(/^--/, '')] = args[i + 1];
  }
  return out;
}

function die(msg) {
  console.error('evidenca render: ' + msg);
  process.exit(1);
}

function run(cmd, args, label) {
  const r = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' });
  if (r.status !== 0) {
    die(`${label} failed:\n${r.stderr || r.stdout}`.slice(0, 2000));
  }
  return r;
}

function checkFfmpeg() {
  const r = spawnSync('ffmpeg', ['-version'], { stdio: 'pipe' });
  if (r.status !== 0 || r.error) {
    die('ffmpeg not found on PATH — install it first (https://ffmpeg.org).');
  }
}

function findFont() {
  for (const f of FONT_CANDIDATES) {
    if (fs.existsSync(f)) {
      return f;
    }
  }
  die('no usable TTF font found; checked: ' + FONT_CANDIDATES.join(', '));
}

// Escape text for ffmpeg drawtext (no shell involved, but drawtext has its
// own metacharacters).
function dt(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, ' ');
}

function wrap(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) {
      if (cur) {
        lines.push(cur);
      }
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) {
    lines.push(cur);
  }
  return lines.slice(0, 4);
}

function textBlock(lines, font, size, color, cx, yStart, lineH) {
  // Returns drawtext filters stacked vertically, centered on cx.
  return lines
    .map((line, i) => {
      const y = yStart + i * lineH;
      return (
        `drawtext=fontfile=${font}:text='${dt(line)}':fontsize=${size}:` +
        `fontcolor=${color}:x=${cx}-text_w/2:y=${y}`
      );
    })
    .join(',');
}

function main() {
  checkFfmpeg();
  const args = parseArgs();
  if (!args.timeline || !args.out) {
    die('usage: render.js --timeline <timeline.json> --out <film.mp4> [--format 16:9|9:16]');
  }
  const timelinePath = path.resolve(args.timeline);
  const outPath = path.resolve(args.out);
  if (!fs.existsSync(timelinePath)) {
    die('timeline not found: ' + timelinePath);
  }

  const vertical = (args.format || '16:9') === '9:16';
  const W = vertical ? 1080 : 1920;
  const H = vertical ? 1920 : 1080;
  const font = findFont();
  const sessionDir = path.dirname(timelinePath);
  const framesDir = path.join(sessionDir, 'frames');

  const tl = JSON.parse(fs.readFileSync(timelinePath, 'utf8'));
  const project = tl.project || 'project';
  const author = tl.author || 'the developer';

  // ---- stats ----
  let activeSeconds = 0;
  let saves = 0;
  let commits = 0;
  for (const s of tl.sessions || []) {
    activeSeconds += s.activeSeconds || 0;
    saves += s.saves || 0;
    commits += s.commits || 0;
  }
  const commitEvents = (tl.events || []).filter((e) => e.type === 'commit');
  commits = Math.max(commits, commitEvents.length);
  const files = new Set(
    (tl.events || []).filter((e) => e.type === 'save' && e.file).map((e) => e.file)
  );
  const hh = Math.floor(activeSeconds / 3600);
  const mm = Math.round((activeSeconds % 3600) / 60);
  const timeStr = hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;

  // ---- frames ----
  let frames = [];
  if (fs.existsSync(framesDir)) {
    frames = fs
      .readdirSync(framesDir)
      .filter((f) => /^frame-\d+\.png$/i.test(f))
      .sort()
      .slice(0, MAX_FRAMES)
      .map((f) => path.join(framesDir, f));
  }

  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'evidenca-'));
  const segFiles = [];
  const segDurs = [];
  let n = 0;
  const segPath = () => path.join(tmp, `seg-${String(n++).padStart(3, '0')}.mp4`);

  const encArgs = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS)];

  function cardSegment(drawFilters, dur) {
    const out = segPath();
    const total = Math.round(dur * FPS);
    const vf = `drawtext=fontfile=${font}:text=' ':fontsize=1:fontcolor=white:x=0:y=0` +
      (drawFilters ? ',' + drawFilters : '') +
      `,fade=t=in:st=0:d=0.3`;
    run(
      'ffmpeg',
      [
        '-y', '-v', 'error',
        '-f', 'lavfi', '-i', `color=c=${INK}:s=${W}x${H}:r=${FPS}:d=${dur}`,
        '-vf', vf,
        '-frames:v', String(total),
        ...encArgs,
        out,
      ],
      'card render'
    );
    segFiles.push(out);
    segDurs.push(dur);
  }

  function frameSegment(img, zoomIn) {
    const out = segPath();
    const total = Math.round(FRAME_DUR * FPS);
    // Gentle Ken Burns: alternate slow push-in / pull-out.
    const zExpr = zoomIn ? "'min(1+0.12*on/42,1.12)'" : "'max(1.12-0.12*on/42,1.0)'";
    const vf =
      `scale=${vertical ? '-2:2600' : '2600:-2'},` +
      `zoompan=z=${zExpr}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${total}:s=${W}x${H}:fps=${FPS},` +
      `fade=t=in:st=0:d=0.25,fade=t=out:st=${(FRAME_DUR - 0.25).toFixed(2)}:d=0.25`;
    run(
      'ffmpeg',
      ['-y', '-v', 'error', '-loop', '1', '-i', img, '-vf', vf, '-frames:v', String(total), ...encArgs, out],
      'frame render'
    );
    segFiles.push(out);
    segDurs.push(FRAME_DUR);
  }

  const cy = (frac) => Math.round(H * frac);

  // ---- 1. intro card ----
  {
    const title = vertical ? 120 : 150;
    const sub = vertical ? 44 : 54;
    const small = vertical ? 34 : 40;
    const f =
      textBlock(['EVIDENCA'], font, title, AMBER, `w/2`, cy(0.36), title + 20) +
      ',' +
      textBlock([project], font, sub, CREAM, `w/2`, cy(0.52), sub + 16) +
      ',' +
      textBlock(['a film of real work'], font, small, DIM, `w/2`, cy(0.62), small + 14);
    cardSegment(f, 2.6);
  }

  // ---- 2. montage with commit cards interleaved ----
  let commitIdx = 0;
  const wrapLen = vertical ? 26 : 44;
  frames.forEach((img, i) => {
    frameSegment(img, i % 2 === 0);
    if ((i + 1) % 6 === 0 && commitIdx < commitEvents.length) {
      const c = commitEvents[commitIdx++];
      const msgLines = wrap(c.message || '(no message)', wrapLen);
      const f =
        textBlock(['COMMIT'], font, vertical ? 36 : 44, AMBER, `w/2`, cy(0.3), 60) +
        ',' +
        textBlock([c.hash || ''], font, vertical ? 40 : 48, DIM, `w/2`, cy(0.38), 62) +
        ',' +
        textBlock(msgLines, font, vertical ? 44 : 56, CREAM, `w/2`, cy(0.5), (vertical ? 44 : 56) + 18);
      cardSegment(f, 2.2);
    }
  });

  // Remaining commits (if frames were few) get their cards too.
  while (commitIdx < commitEvents.length && commitIdx < 12) {
    const c = commitEvents[commitIdx++];
    const msgLines = wrap(c.message || '(no message)', wrapLen);
    const f =
      textBlock(['COMMIT'], font, vertical ? 36 : 44, AMBER, `w/2`, cy(0.3), 60) +
      ',' +
      textBlock([c.hash || ''], font, vertical ? 40 : 48, DIM, `w/2`, cy(0.38), 62) +
      ',' +
      textBlock(msgLines, font, vertical ? 44 : 56, CREAM, `w/2`, cy(0.5), (vertical ? 44 : 56) + 18);
    cardSegment(f, 2.2);
  }

  // If there were no frames at all, hold a simple project card so the film
  // still has a body.
  if (frames.length === 0) {
    const f = textBlock(
      ['no screenshots captured', 'the timeline still tells the story'],
      font, vertical ? 40 : 48, DIM, `w/2`, cy(0.45), 70
    );
    cardSegment(f, 2.4);
  }

  // ---- 3. stats card ----
  {
    const big = vertical ? 64 : 84;
    const small = vertical ? 40 : 50;
    const lines = [
      `${timeStr} at the keyboard`,
      `${commits} commit${commits === 1 ? '' : 's'}`,
      `${saves} saves · ${files.size} files touched`,
    ];
    const f =
      textBlock(['THE RECEIPTS'], font, vertical ? 44 : 56, AMBER, `w/2`, cy(0.28), 70) +
      ',' +
      textBlock(lines, font, big, CREAM, `w/2`, cy(0.42), big + 26) +
      ',' +
      textBlock(
        ['every minute of it human'],
        font, small, DIM, `w/2`, cy(0.72), small + 14
      );
    cardSegment(f, 3.2);
  }

  // ---- 4. stamp ----
  {
    const stamp = vertical ? 110 : 150;
    const f =
      textBlock(['HUMAN-MADE'], font, stamp, AMBER, `w/2`, cy(0.4), stamp + 20) +
      ',' +
      textBlock(
        [`built by ${author}`],
        font, vertical ? 40 : 52, CREAM, `w/2`, cy(0.58), 70
      ) +
      ',' +
      textBlock(['evidenca'], font, vertical ? 32 : 38, DIM, `w/2`, cy(0.7), 52);
    cardSegment(f, 3.0);
  }

  // ---- assemble: xfade chain ----
  const listPath = path.join(tmp, 'inputs.txt');
  const fcParts = [];
  let last = '[0:v]';
  let dur = segDurs[0];
  const inputs = [];
  segFiles.forEach((f) => inputs.push('-i', f));
  for (let i = 1; i < segFiles.length; i++) {
    const offset = (dur - XFADE).toFixed(3);
    fcParts.push(`${last}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset}[x${i}]`);
    last = `[x${i}]`;
    dur = dur + segDurs[i] - XFADE;
  }
  const chained = path.join(tmp, 'chained.mp4');
  run(
    'ffmpeg',
    ['-y', '-v', 'error', ...inputs, '-filter_complex', fcParts.join(';'), '-map', last, ...encArgs, chained],
    'assembly'
  );

  // ---- grade: grain + vignette ----
  run(
    'ffmpeg',
    [
      '-y', '-v', 'error', '-i', chained,
      '-vf', `noise=alls=9:allf=t,vignette=PI/4.4`,
      ...encArgs,
      outPath,
    ],
    'grade'
  );

  // ---- verify ----
  const probe = run(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'stream=width,height,codec_name,avg_frame_rate,duration', '-show_entries', 'format=duration', '-of', 'json', outPath],
    'ffprobe'
  );
  const info = JSON.parse(probe.stdout);
  const vs = (info.streams || []).find((s) => s.width);
  console.log(`evidenca render: done -> ${outPath}`);
  console.log(
    `  video: ${vs.codec_name} ${vs.width}x${vs.height} @ ${vs.avg_frame_rate}fps, ` +
    `${Number(info.format.duration).toFixed(1)}s`
  );

  // Clean up intermediates (keep the film).
  fs.rmSync(tmp, { recursive: true, force: true });
}

main();
