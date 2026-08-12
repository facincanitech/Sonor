# Sonor Radio Bot

Bot de Discord que toca rádio de verdade (stream ao vivo, via
[radio-browser.info](https://www.radio-browser.info/), a mesma fonte do
SonorHub) direto numa call — igual um bot de música, só que em vez de link
do YouTube você busca a rádio pelo nome.

Roda separado do SonorHub (é um serviço próprio, sempre online), mas
reaproveita o mesmo projeto Supabase pra guardar os favoritos.

## Comandos

- `/radio tocar nome:<busca>` — busca e toca a rádio na sua call
- `/radio salvar` — salva a rádio que está tocando nos seus favoritos
- `/radio favoritos` — lista suas rádios salvas
- `/radio aleatoria` — toca uma aleatória (dos seus favoritos, ou de um pool
  de descoberta com as rádios mais ouvidas de ~40 países se você não tiver
  nenhuma salva ainda)
- `/radio parar` — para e sai da call

## Passo a passo pra colocar no ar

### 1. Criar o bot no Discord

1. Vai em <https://discord.com/developers/applications> > **New
   Application**, dá um nome (ex: "Sonor Radio").
2. Na aba **Bot**: **Reset Token** e copia — isso vai virar `DISCORD_TOKEN`.
   Ativa **Message Content Intent** não é necessário (esse bot só usa slash
   commands), mas deixa **Server Members Intent** e **Presence Intent**
   desligados mesmo, não precisa.
3. Em **General Information**, copia o **Application ID** — vira
   `DISCORD_CLIENT_ID`.
4. Em **OAuth2 > URL Generator**: marca `bot` e `applications.commands` em
   Scopes; em Bot Permissions marca `Connect` e `Speak`. Copia o link
   gerado embaixo e abre no navegador pra convidar o bot pro seu servidor.

### 2. Criar a tabela no Supabase

Mesmo projeto do SonorHub (`xpscjwcqgdldwtmbbzua`). No **SQL Editor**, roda
o `supabase-schema.sql` desta pasta. Em **Project Settings > API**, copia a
**service_role key** (não a anon key!) — vira `SUPABASE_SERVICE_ROLE_KEY`.

### 3. Configurar e testar local (opcional, antes de subir pra nuvem)

```bash
cd discord-bot
npm install
cp .env.example .env
# edita o .env com os valores dos passos 1 e 2
npm run register   # registra os slash commands (1x, ou de novo se mudar comandos)
npm start           # roda o bot
```

Se `npm install` falhar no `@discordjs/opus` (módulo nativo, precisa de
toolchain de C++), roda `npm install --build-from-source` ou troca a
dependência por `opusscript` no `package.json` (mais lento, mas 100% JS,
não precisa compilar nada).

### 4. Deploy 24/7 (Railway, Fly.io ou Render — qualquer um serve)

O bot é um processo Node comum (`npm start`), sem porta HTTP obrigatória —
declare como **Worker/Background Service**, não como Web Service (senão a
plataforma pode reclamar de não ter porta respondendo).

**Railway** (mais simples):
1. `railway.app` > New Project > Deploy from GitHub repo (ou `railway up`
   direto desta pasta via CLI).
2. Se for do GitHub: em **Settings > Root Directory**, aponta pra
   `discord-bot/` (esse repo tem outras coisas na raiz que não são do bot).
3. Em **Variables**, cola as 5 variáveis do `.env.example` preenchidas.
4. Depois do primeiro deploy, roda `npm run register` uma vez (Railway
   tem um "Run Command" no dashboard, ou roda local apontando pro mesmo
   `.env` — só precisa rodar uma vez, os comandos ficam registrados no
   Discord, não precisa rodar de novo a cada deploy a menos que mude os
   comandos).

**Fly.io / Render**: mesma ideia — variáveis de ambiente iguais,
`npm install && npm start` como comando de start, sem porta exposta
necessária (Fly.io pode pedir pra desligar o healthcheck HTTP nas
configs do app, já que o bot não serve HTTP).

## Por que não dá pra "puxar áudio do Discord pro SonorHub"

Esse bot resolve o caminho **SonorHub → Discord** (a lógica de busca de
rádio do app, tocando numa call). O caminho contrário (pegar áudio de
dentro de uma call do Discord e trazer pro app) não é algo que a API do
Discord expõe de forma simples — bots de música tocam áudio **pra dentro**
de uma call, não servem como fonte de stream pra fora. Se um dia fizer
sentido, dá pra pensar em expor esse bot como uma "rádio própria" (ex: ele
mesmo gerar um stream Icecast que o SonorHub escuta como se fosse mais uma
estação), mas é um projeto à parte, bem mais envolvido.
