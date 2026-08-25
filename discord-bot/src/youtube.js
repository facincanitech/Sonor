// YouTube via yt-dlp (binário do sistema, ver README) — não usa nenhuma API
// oficial, só extrai o áudio igual um bot de música comum. Precisa de
// cookies de uma conta logada (YOUTUBE_COOKIES_FILE) porque IP de VPS/
// datacenter costuma ser bloqueado pelo YouTube ("Sign in to confirm
// you're not a bot") sem isso.
const { spawn } = require('child_process');
const supabase = require('./supabase');

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

// Favoritos do YouTube — tabela separada dos favoritos de rádio (mesmo
// projeto Supabase), porque tocar de volta é um fluxo diferente (spawna
// yt-dlp de novo, não é um stream direto pro ffmpeg).
async function salvarFavorita(discordUserId, item) {
  if (!supabase) throw new Error('Supabase não configurado (faltam as env vars).');
  const { error } = await supabase.from('discord_youtube_favorites').upsert(
    {
      discord_user_id: discordUserId,
      video_title: item.name,
      video_url: item.url,
      uploader: item.uploader || null,
    },
    { onConflict: 'discord_user_id,video_url' }
  );
  if (error) throw new Error(error.message);
}

async function listarFavoritas(discordUserId) {
  if (!supabase) throw new Error('Supabase não configurado (faltam as env vars).');
  const { data, error } = await supabase
    .from('discord_youtube_favorites')
    .select('video_title, video_url, uploader')
    .eq('discord_user_id', discordUserId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((f) => ({ name: f.video_title, url: f.video_url, uploader: f.uploader }));
}

module.exports = { buscar, spawnAudioStream, salvarFavorita, listarFavoritas };
