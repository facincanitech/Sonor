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
