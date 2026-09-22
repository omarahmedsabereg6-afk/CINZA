import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const env = {};
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const idx = line.indexOf('=');
  const key = line.slice(0, idx).trim();
  const value = line.slice(idx + 1).trim();
  env[key] = value;
}

const token = env.TMDB_ACCESS_TOKEN;
if (!token) throw new Error('TMDB_ACCESS_TOKEN missing');

const movieData = await fetch('https://api.themoviedb.org/3/movie/27205/images?include_image_language=en', {
  headers: { Authorization: `Bearer ${token}` },
});
if (!movieData.ok) throw new Error(`TMDB image lookup failed: ${movieData.status}`);
const tmdb = await movieData.json();
const backdrop = (tmdb.backdrops || [])[0];
if (!backdrop) throw new Error('No TMDB backdrop available');
const imgUrl = `https://image.tmdb.org/t/p/original${backdrop.file_path}`;
const imgRes = await fetch(imgUrl);
if (!imgRes.ok) throw new Error(`TMDB image download failed: ${imgRes.status}`);
const bytes = Buffer.from(await imgRes.arrayBuffer());
fs.writeFileSync(path.join(root, 'tmp-real-recognition.jpg'), bytes);

const form = new FormData();
form.append('meta', JSON.stringify({
  mode: 'image',
  source: 'gallery',
  describe: 'A man in a dark suit stands in a rainy city street',
  region: 'US',
  language: 'en-US',
  files: [{ pHash: null, dHash: null, aHash: null, thumbDataUrl: null, frameTimeMs: null }],
}));
form.append('images', new Blob([bytes], { type: 'image/jpeg' }), 'movie.jpg');

const response = await fetch('http://localhost:8787/api/recognitions', {
  method: 'POST',
  body: form,
  signal: AbortSignal.timeout(120000),
});
const text = await response.text();
console.log('STATUS', response.status);
console.log(text.slice(0, 4000));
