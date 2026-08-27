// Busca e "aleatório" espelham a mesma lógica do app SonorHub (Rádio), pra
// manter a mesma sensação de uso: radio-browser.info como fonte, pool de
// descoberta com TODAS as estações cadastradas de ~40 países (a API não
// tem teto de verdade — testado com limit=99999 só nos EUA e voltou ~7000
// estações). Escolha de propósito, sabendo que isso puxa rádio bem menos
// popular/mais propensa a cair no meio (ordenado por clickcount, mas sem
// filtrar "toca e cai toda hora", só "já confirmada quebrada").
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
      fetch(`${RADIO_API}/search?limit=99999&hidebroken=true&order=clickcount&reverse=true&countrycode=${cc}`)
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

const HISTORICO_MAX_POR_USUARIO = 20;

async function registrarHistorico(discordUserId, est) {
  if (!supabase) return; // histórico é "nice to have" — não quebra o /radio tocar se faltar Supabase
  try {
    await supabase.from('discord_radio_history').insert({
      discord_user_id: discordUserId,
      station_name: est.name,
      station_url: streamUrl(est),
      country: est.country || null,
    });
    const { data } = await supabase
      .from('discord_radio_history')
      .select('id')
      .eq('discord_user_id', discordUserId)
      .order('played_at', { ascending: false })
      .range(HISTORICO_MAX_POR_USUARIO, 9999);
    if (data && data.length) {
      await supabase.from('discord_radio_history').delete().in('id', data.map((r) => r.id));
    }
  } catch (err) {
    console.error('[radio] falha ao registrar histórico:', err.message);
  }
}

async function listarHistorico(discordUserId) {
  if (!supabase) throw new Error('Supabase não configurado (faltam as env vars).');
  const { data, error } = await supabase
    .from('discord_radio_history')
    .select('station_name, station_url, country, played_at')
    .eq('discord_user_id', discordUserId)
    .order('played_at', { ascending: false })
    .limit(HISTORICO_MAX_POR_USUARIO);
  if (error) throw new Error(error.message);
  // Remove tocadas repetidas seguidas (ex: deu play na mesma 3x seguidas),
  // mantém só a mais recente de cada estação.
  const vistas = new Set();
  const unicas = [];
  for (const h of data || []) {
    if (vistas.has(h.station_url)) continue;
    vistas.add(h.station_url);
    unicas.push(h);
  }
  return unicas;
}

module.exports = {
  buscarRadios,
  estacaoAleatoriaGlobal,
  salvarFavorita,
  listarFavoritas,
  registrarHistorico,
  listarHistorico,
  streamUrl,
};
