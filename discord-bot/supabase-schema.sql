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
