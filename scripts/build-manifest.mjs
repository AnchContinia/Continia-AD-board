#!/usr/bin/env node
// Builds content.json for the moodboard from Assets/ and videos.txt.
// Runs in the GitHub Pages workflow on every push; run it locally before previewing.
//
//   node scripts/build-manifest.mjs

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS_DIR = 'Assets';
const VIDEOS_FILE = 'videos.txt';
const OUT_FILE = 'content.json';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v']);
const DEFAULT_VIDEO_GROUP = 'Video';

const collator = new Intl.Collator('da', { numeric: true, sensitivity: 'base' });

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

// Hashes, "Untitled(3)", random IDs: names that say nothing to a viewer.
function isMeaningless(fileName) {
  const n = fileName.trim();
  if (/^untitled(\s*\(\d+\))?$/i.test(n)) return true;
  if (/^[0-9a-f]{12,}(\(\d+\))?$/i.test(n)) return true;
  if (/^[0-9a-f.]{16,}$/i.test(n)) return true;
  if (/^[A-Za-z0-9]{20,}$/.test(n) && /\d/.test(n)) return true;
  return false;
}

function prettify(fileName) {
  const text = fileName.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function toUrlPath(relPath) {
  return relPath.split(sep).map(encodeURIComponent).join('/');
}

function parseStart(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return 0;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

function parseVideoUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.)/, '');

  if (host === 'youtu.be' || host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
      if (m) id = m[1];
    }
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    const start = parseStart(u.searchParams.get('t') || u.searchParams.get('start'));
    const params = new URLSearchParams({ autoplay: '1', rel: '0', playsinline: '1' });
    if (start) params.set('start', String(start));
    return {
      provider: 'youtube',
      videoId: id,
      url: `https://www.youtube.com/watch?v=${id}`,
      embed: `https://www.youtube-nocookie.com/embed/${id}?${params}`,
      thumb: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
      oembed: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
    };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = u.pathname.match(/(?:\/video)?\/(\d+)(?:\/([0-9a-f]+))?/);
    if (!m) return null;
    const id = m[1];
    const hash = m[2] || u.searchParams.get('h') || '';
    const params = new URLSearchParams({ autoplay: '1', dnt: '1' });
    if (hash) params.set('h', hash);
    const pageUrl = `https://vimeo.com/${id}${hash ? `/${hash}` : ''}`;
    return {
      provider: 'vimeo',
      videoId: id,
      url: pageUrl,
      embed: `https://player.vimeo.com/video/${id}?${params}`,
      thumb: null,
      oembed: `https://vimeo.com/api/oembed.json?width=1280&url=${encodeURIComponent(pageUrl)}`,
    };
  }

  if (/\.(mp4|webm|m4v)$/i.test(u.pathname)) {
    return { provider: 'file', url: u.href, src: u.href, embed: null, thumb: null, oembed: null };
  }

  return null;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function readVideos() {
  let text;
  try {
    text = await readFile(join(ROOT, VIDEOS_FILE), 'utf8');
  } catch {
    return [];
  }
  const seen = new Set();
  const items = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const [rawUrl, title = '', group = ''] = line.split('|').map((s) => s.trim());
    const video = parseVideoUrl(rawUrl);
    if (!video) {
      console.warn(`  ! ${VIDEOS_FILE}:${i + 1} kunne ikke læses som YouTube, Vimeo eller .mp4/.webm: ${rawUrl}`);
      continue;
    }
    if (seen.has(video.url)) continue;
    seen.add(video.url);

    let finalTitle = title;
    let thumb = video.thumb;
    if (video.oembed && (!finalTitle || !thumb)) {
      const meta = await fetchJson(video.oembed);
      if (meta) {
        if (!finalTitle && meta.title) finalTitle = meta.title;
        if (!thumb && meta.thumbnail_url) thumb = meta.thumbnail_url;
      }
    }
    if (!finalTitle) {
      finalTitle = video.provider === 'file' ? prettify(basename(new URL(video.url).pathname, extname(new URL(video.url).pathname))) : `Video ${items.length + 1}`;
    }

    items.push({
      id: `video:${video.url}`,
      type: 'video',
      provider: video.provider,
      videoId: video.videoId || null,
      title: finalTitle,
      group: group || DEFAULT_VIDEO_GROUP,
      url: video.url,
      embed: video.embed,
      src: video.src || null,
      thumb: thumb || null,
    });
  }
  return items;
}

async function readAssets() {
  const files = await walk(join(ROOT, ASSETS_DIR));
  const items = [];
  for (const full of files) {
    const ext = extname(full).toLowerCase();
    const isImage = IMAGE_EXT.has(ext);
    const isVideo = VIDEO_EXT.has(ext);
    if (!isImage && !isVideo) continue;

    const relFromRoot = relative(ROOT, full);
    const relFromAssets = relative(join(ROOT, ASSETS_DIR), full);
    const parts = relFromAssets.split(sep);
    const group = parts.length > 1 ? parts[0] : null;
    const src = toUrlPath(relFromRoot);

    const name = basename(full, extname(full));
    items.push({
      id: `asset:${relFromRoot}`,
      type: isImage ? 'image' : 'video',
      provider: isImage ? null : 'file',
      title: isMeaningless(name) ? '' : prettify(name),
      group: group || (isImage ? 'Moodboard' : DEFAULT_VIDEO_GROUP),
      src,
      url: src,
      embed: null,
      thumb: null,
    });
  }
  // Root files first, then subfolders, each sorted by name.
  items.sort((a, b) => {
    const ar = a.group === 'Moodboard' ? 0 : 1;
    const br = b.group === 'Moodboard' ? 0 : 1;
    if (ar !== br) return ar - br;
    return collator.compare(a.group, b.group) || collator.compare(a.src, b.src);
  });
  // Number the untitled ones in their order on the board.
  let n = 0;
  for (const item of items) {
    if (item.title) continue;
    n += 1;
    item.title = `${item.type === 'image' ? 'Billede' : 'Video'} ${n}`;
  }
  return items;
}

const assets = await readAssets();
const videos = await readVideos();
const items = [...assets, ...videos];

const manifest = {
  generatedAt: new Date().toISOString(),
  counts: {
    images: items.filter((i) => i.type === 'image').length,
    videos: items.filter((i) => i.type === 'video').length,
  },
  items,
};

await writeFile(join(ROOT, OUT_FILE), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${OUT_FILE}: ${manifest.counts.images} billeder, ${manifest.counts.videos} videoer`);
