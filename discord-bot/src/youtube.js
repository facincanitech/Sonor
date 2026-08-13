// YouTube via yt-dlp (binário do sistema, ver README) — não usa nenhuma API
// oficial, só extrai o áudio igual um bot de música comum. Precisa de
// cookies de uma conta logada (YOUTUBE_COOKIES_FILE) porque IP de VPS/
// datacenter costuma ser bloqueado pelo YouTube ("Sign in to confirm
// you're not a bot") sem isso.
const { spawn } = require('child_process');

const COOKIES_FILE = process.env.YOUTUBE_COOKIES_FILE || '';

function cookiesArgs() {
  return COOKIES_FILE ? ['--cookies', COOKIES_FILE] : [];
}

function run(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim().split('\n').pop() || `yt-dlp saiu com código ${code}`));
      resolve(out.trim());
    });
    proc.on('error', reject);
  });
}

async function buscar(query) {
  const out = await run([
    ...cookiesArgs(),
    '--no-playlist',
    '--print', '%(title)s',
    '--print', '%(webpage_url)s',
    '--print', '%(uploader)s',
    `ytsearch1:${query}`,
  ]);
  const [title, url, uploader] = out.split('\n');
  if (!url) throw new Error(`Não achei nada pra "${query}" no YouTube.`);
  return { name: title || query, url, uploader: uploader || '' };
}

// Retorna o processo yt-dlp já rodando, escrevendo o áudio bruto em stdout
// — quem chama liga esse stdout no ffmpeg (ver player.js).
function spawnAudioStream(videoUrl) {
  return spawn('yt-dlp', [...cookiesArgs(), '-f', 'bestaudio', '--no-playlist', '-o', '-', videoUrl]);
}

module.exports = { buscar, spawnAudioStream };
