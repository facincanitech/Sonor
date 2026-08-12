// Busca e "aleatório" espelham a mesma lógica do app SonorHub (Rádio), pra
// manter a mesma sensação de uso: radio-browser.info como fonte, pool de
// descoberta pré-montado com as top ~5 estações de ~40 países.
const supabase = require('./supabase');

const RADIO_API = 'https://de1.api.radio-browser.info/json/stations';

const DISCOVERY_COUNTRIES = [
  'BR', 'US', 'PT', 'ES', 'AR', 'MX', 'CO', 'CL', 'PE', 'UY',
  'PY', 'GB', 'FR', 'DE', 'IT', 'NL', 'BE', 'SE', 'NO', 'DK',
  'FI', 'PL', 'RU', 'TR', 'GR', 'JP', 'KR', 'CN', 'IN', 'ID',
  'TH', 'PH', 'VN', 'AU', 'NZ', 'CA', 'ZA', 'EG', 'NG', 'SA',
];

let discoveryPoolCache = null;

async function buildDiscoveryPool() {
  if (discoveryPoolCache) return discoveryPoolCache;
  const results = await Promise.all(
    DISCOVERY_COUNTRIES.map((cc) =>
      fetch(`${RADIO_API}/search?limit=5&hidebroken=true&order=clickcount&reverse=true&countrycode=${cc}`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
    )
  );
  const pool = results.flat();
  if (pool.length) discoveryPoolCache = pool;
  return pool;
}

async function buscarRadios(termo) {
  if (!termo) return [];
  const resp = await fetch(`${RADIO_API}/search?name=${encodeURIComponent(termo)}&limit=10&hidebroken=true&order=clickcount&reverse=true`);
  if (!resp.ok) throw new Error(`Radio Browser respondeu erro ${resp.status}.`);
  return resp.json();
}

async function estacaoAleatoriaGlobal() {
  const pool = await buildDiscoveryPool();
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function streamUrl(est) {
  return est.url_resolved || est.url;
}

async function salvarFavorita(discordUserId, est) {
  if (!supabase) throw new Error('Supabase não configurado (faltam as env vars).');
  const { error } = await supabase.from('discord_radio_favorites').upsert(
    {
      discord_user_id: discordUserId,
      station_name: est.name,
      station_url: streamUrl(est),
      country: est.country || null,
    },
    { onConflict: 'discord_user_id,station_url' }
  );
  if (error) throw new Error(error.message);
}

async function listarFavoritas(discordUserId) {
  if (!supabase) throw new Error('Supabase não configurado (faltam as env vars).');
  const { data, error } = await supabase
    .from('discord_radio_favorites')
    .select('station_name, station_url, country')
    .eq('discord_user_id', discordUserId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function estacaoAleatoriaFavorita(discordUserId) {
  const favs = await listarFavoritas(discordUserId);
  if (!favs.length) return null;
  const fav = favs[Math.floor(Math.random() * favs.length)];
  return { name: fav.station_name, url_resolved: fav.station_url, country: fav.country };
}

module.exports = {
  buscarRadios,
  estacaoAleatoriaGlobal,
  estacaoAleatoriaFavorita,
  salvarFavorita,
  listarFavoritas,
  streamUrl,
};
