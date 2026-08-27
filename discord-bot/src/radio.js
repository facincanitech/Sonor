// Busca e "aleatório" espelham a mesma lógica do app SonorHub (Rádio), pra
// manter a mesma sensação de uso: radio-browser.info como fonte, pool de
// descoberta com TODAS as estações cadastradas de ~40 países (a API não
// tem teto de verdade — testado com limit=99999 só nos EUA e voltou ~7000
// estações). Escolha de propósito, sabendo que isso puxa rádio bem menos
// popular/mais propensa a cair no meio (ordenado por clickcount, mas sem
// filtrar "toca e cai toda hora", só "já confirmada quebrada").
const supabase = require('./supabase');

const RADIO_API = 'https://de1.api.radio-browser.info/json/stations';

// Metadado ICY (StreamTitle) — mesma Edge Function que o app SonorHub usa
// (radio-nowplaying), reaproveitada aqui pro bot também mostrar "tocando
// agora" no painel. Usa a mesma SUPABASE_URL/SERVICE_ROLE_KEY já configuradas
// pro resto do bot (favoritos/histórico), só precisa de um JWT válido no
// Authorization, não precisa ser especificamente a anon key.
async function buscarMusicaAtualIcy(streamUrl) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !streamUrl) return null;
  try {
    const resp = await fetch(`${url}/functions/v1/radio-nowplaying?url=${encodeURIComponent(streamUrl)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.title || null;
  } catch {
    return null;
  }
}

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

// Nome de país (PT/EN, sem acento) -> código de 2 letras. Cobre os mesmos
// ~40 países do pool de descoberta. Se o termo digitado bater com um desses
// nomes, a busca passa a incluir também as rádios DO país, além das que têm
// esse termo no nome — ex: "brasil" traz rádios brasileiras, não só rádios
// chamadas literalmente "Brasil".
function normalizar(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
const NOME_PAIS_PARA_CODIGO = {
  brasil: 'BR', brazil: 'BR',
  'estados unidos': 'US', eua: 'US', usa: 'US', 'united states': 'US',
  portugal: 'PT',
  espanha: 'ES', spain: 'ES',
  argentina: 'AR',
  mexico: 'MX',
  colombia: 'CO',
  chile: 'CL',
  peru: 'PE',
  uruguai: 'UY', uruguay: 'UY',
  paraguai: 'PY', paraguay: 'PY',
  'reino unido': 'GB', inglaterra: 'GB', uk: 'GB', 'united kingdom': 'GB',
  franca: 'FR', france: 'FR',
  alemanha: 'DE', germany: 'DE',
  italia: 'IT', italy: 'IT',
  holanda: 'NL', netherlands: 'NL', 'paises baixos': 'NL',
  belgica: 'BE', belgium: 'BE',
  suecia: 'SE', sweden: 'SE',
  noruega: 'NO', norway: 'NO',
  dinamarca: 'DK', denmark: 'DK',
  finlandia: 'FI', finland: 'FI',
  polonia: 'PL', poland: 'PL',
  russia: 'RU',
  turquia: 'TR', turkey: 'TR',
  grecia: 'GR', greece: 'GR',
  japao: 'JP', japan: 'JP',
  coreia: 'KR', 'coreia do sul': 'KR', korea: 'KR',
  china: 'CN',
  india: 'IN',
  indonesia: 'ID',
  tailandia: 'TH', thailand: 'TH',
  filipinas: 'PH', philippines: 'PH',
  vietna: 'VN', vietnam: 'VN',
  australia: 'AU',
  'nova zelandia': 'NZ', 'new zealand': 'NZ',
  canada: 'CA',
  'africa do sul': 'ZA', 'south africa': 'ZA',
  egito: 'EG', egypt: 'EG',
  nigeria: 'NG',
  'arabia saudita': 'SA', 'saudi arabia': 'SA',
};

// Busca até 200 rádios (a API não filtra "confiável", só "confirmada
// quebrada" — mais que isso vira ruído). Se o termo bater com um país
// conhecido, junta busca por país + busca por nome, sem duplicar (usa
// stationuuid, que é único por estação no radio-browser).
async function buscarRadios(termo) {
  if (!termo) return [];
  const base = { limit: '200', hidebroken: 'true', order: 'clickcount', reverse: 'true' };
  const codigoPais = NOME_PAIS_PARA_CODIGO[normalizar(termo)];
  if (!codigoPais) {
    const resp = await fetch(`${RADIO_API}/search?${new URLSearchParams({ ...base, name: termo })}`);
    if (!resp.ok) throw new Error(`Radio Browser respondeu erro ${resp.status}.`);
    return resp.json();
  }
  const [porPais, porNome] = await Promise.all([
    fetch(`${RADIO_API}/search?${new URLSearchParams({ ...base, countrycode: codigoPais })}`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetch(`${RADIO_API}/search?${new URLSearchParams({ ...base, name: termo })}`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ]);
  const vistos = new Set();
  const combinado = [];
  for (const e of [...porPais, ...porNome]) {
    if (vistos.has(e.stationuuid)) continue;
    vistos.add(e.stationuuid);
    combinado.push(e);
  }
  return combinado;
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
  buscarMusicaAtualIcy,
};
