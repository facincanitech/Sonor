-- Rode isso no SQL Editor do Supabase (mesmo projeto do SonorHub) antes de
-- usar o comando /radio salvar. Guarda as rádios favoritas por usuário do
-- Discord. RLS ativa e sem nenhuma policy pra anon/authenticated: só o bot
-- (com a service_role key, nunca exposta) consegue ler ou escrever aqui.

create table if not exists discord_radio_favorites (
  id bigint generated always as identity primary key,
  discord_user_id text not null,
  station_name text not null,
  station_url text not null,
  country text,
  created_at timestamptz not null default now(),
  unique (discord_user_id, station_url)
);

alter table discord_radio_favorites enable row level security;

-- Histórico (últimas rádios tocadas por usuário) — diferente de favoritos,
-- é preenchido automaticamente toda vez que alguém toca uma rádio, sem
-- precisar salvar. Guardamos só as últimas 20 por usuário (o bot mesmo
-- apaga as mais antigas, ver limparHistoricoAntigo em radio.js).
create table if not exists discord_radio_history (
  id bigint generated always as identity primary key,
  discord_user_id text not null,
  station_name text not null,
  station_url text not null,
  country text,
  played_at timestamptz not null default now()
);

create index if not exists discord_radio_history_user_idx
  on discord_radio_history (discord_user_id, played_at desc);

alter table discord_radio_history enable row level security;

-- Favoritos do /youtube (separado dos favoritos de rádio porque a forma de
-- tocar de volta é diferente — vídeo do YouTube via yt-dlp, não stream de
-- rádio direto no ffmpeg).
create table if not exists discord_youtube_favorites (
  id bigint generated always as identity primary key,
  discord_user_id text not null,
  video_title text not null,
  video_url text not null,
  uploader text,
  created_at timestamptz not null default now(),
  unique (discord_user_id, video_url)
);

alter table discord_youtube_favorites enable row level security;

-- Referência do painel fixo (/radio painel) por servidor. Antes só vivia em
-- memória (Map no processo do bot) — um restart do PM2 (crash, deploy, etc.)
-- apagava a referência e o painel já postado ficava "órfão": a rádio
-- continuava trocando normal, só que ninguém mais editava aquela mensagem
-- (sintoma visto na prática: painel preso mostrando a rádio/música de antes
-- do restart, mesmo já tocando outra coisa). Persistindo aqui, o bot recarrega
-- todos os painéis no evento "ready" e volta a editá-los normalmente.
create table if not exists discord_radio_panel (
  guild_id text primary key,
  channel_id text not null,
  message_id text not null,
  updated_at timestamptz not null default now()
);

alter table discord_radio_panel enable row level security;
