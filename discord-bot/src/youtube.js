// Extração do áudio em si (spawnAudioStream) é via yt-dlp (binário do
// sistema, ver README) — não tem API oficial que devolva bytes de áudio pra
// baixar, o YouTube não expõe isso de propósito. Precisa de cookies de uma
// conta logada (YOUTUBE_COOKIES_FILE) porque IP de VPS/datacenter costuma
// ser bloqueado pelo YouTube ("Sign in to confirm you're not a bot") sem
// isso — essa é a única parte que realmente precisa da conta.
//
// A BUSCA por nome (usuário digitou "nxzero" em vez de colar um link) já
// dava pra fazer sem tocar na conta: a YouTube Data API v3 (YOUTUBE_API_KEY,
// chave oficial do Google Cloud Console, sem OAuth/login nenhum) devolve
// título/canal/id de vídeo direto, sem precisar de cookies nem passar pelo
// yt-dlp. Reduz o uso da conta cookies só pra extração (a parte que não tem
// outro jeito), em vez de também usá-la pra toda busca por nome.
const { spawn } = require('child_process');
const supabase = require('./supabase');

const COOKIES_FILE = process.env.YOUTUBE_COOKIES_FILE || '';
const API_KEY = process.env.YOUTUBE_API_KEY || '';

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

// Se o usuário já colou um link do YouTube (watch?v=, youtu.be/, shorts/,
// embed/), não é uma "busca" de verdade — extrai o ID direto do texto em vez
// de mandar a URL inteira como termo de pesquisa (o que não fazia sentido
// nem na Data API nem no ytsearch do yt-dlp).
function extrairVideoIdDeLink(texto) {
  const m = texto.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/);
  return m ? m[1] : null;
}

async function metadadoPorId(videoId) {
  const out = await run([
    ...cookiesArgs(),
    '--no-playlist',
    '--print', '%(title)s',
    '--print', '%(webpage_url)s',
    '--print', '%(uploader)s',
    `https://www.youtube.com/watch?v=${videoId}`,
  ]);
  const [title, url, uploader] = out.split('\n');
  if (!url) throw new Error('Não consegui abrir esse vídeo.');
  return { name: title || videoId, url, uploader: uploader || '' };
}

async function buscarViaDataApi(query) {
  const params = new URLSearchParams({ part: 'snippet', q: query, type: 'video', maxResults: '1', key: API_KEY });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!resp.ok) return null; // cota estourada, chave inválida, etc. — cai pro fallback do yt-dlp
  const data = await resp.json();
  const item = data.items && data.items[0];
  if (!item) return null;
  return {
    name: item.snippet.title,
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    uploader: item.snippet.channelTitle || '',
  };
}

async function buscarViaYtDlp(query) {
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

async function buscar(query) {
  const idDoLink = extrairVideoIdDeLink(query);
  if (idDoLink) return metadadoPorId(idDoLink);
  if (API_KEY) {
    const viaApi = await buscarViaDataApi(query).catch(() => null);
    if (viaApi) return viaApi;
  }
  return buscarViaYtDlp(query);
}

// Retorna o processo yt-dlp já rodando, escrevendo o áudio bruto em stdout
// — quem chama liga esse stdout no ffmpeg (ver player.js). "bestaudio/best"
// (em vez de só "bestaudio") porque alguns vídeos só têm formato combinado
// (vídeo+áudio juntos, sem trilha de áudio separada) — sem o fallback,
// yt-dlp falhava com "Requested format is not available" nesses casos. O
// ffmpeg do lado do player.js já ignora o vídeo sozinho, só usa o áudio.
function spawnAudioStream(videoUrl) {
  return spawn('yt-dlp', [...cookiesArgs(), '-f', 'bestaudio/best', '--no-playlist', '-o', '-', videoUrl]);
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
