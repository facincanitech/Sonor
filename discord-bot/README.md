# Sonor Radio Bot

Bot de Discord que toca rádio de verdade (stream ao vivo, via
[radio-browser.info](https://www.radio-browser.info/), a mesma fonte do
SonorHub) e áudio do YouTube, direto numa call — igual um bot de música.

Roda separado do SonorHub (é um serviço próprio, sempre online), mas
reaproveita o mesmo projeto Supabase pra guardar os favoritos.

## Comandos

- `/radio painel` — posta um painel com botões (tocar, aleatória, salvar,
  favoritos, histórico, parar), pra quem prefere clicar em vez de digitar
  comando. Favoritos/Histórico viram um menu suspenso pra escolher e já
  toca. É o jeito mais fácil de usar no dia a dia.
- `/radio tocar nome:<busca>` — busca e toca a rádio na sua call
- `/radio salvar` — salva a rádio que está tocando nos seus favoritos
- `/radio favoritos` — lista suas rádios salvas
- `/radio historico` — lista as últimas rádios que você tocou
- `/radio aleatoria` — toca uma aleatória (dos seus favoritos, ou de um pool
  de descoberta com as rádios mais ouvidas de ~40 países se você não tiver
  nenhuma salva ainda)
- `/radio parar` — para e sai da call
- `/youtube tocar busca:<nome ou link>` — busca (ou abre direto se for
  link) e toca o áudio na sua call. **Precisa de `YOUTUBE_COOKIES_FILE`
  configurado** (ver seção de deploy) — sem isso o YouTube costuma
  bloquear a extração vinda de IP de VPS/datacenter.
- `/youtube parar` — para e sai da call (mesmo comando de efeito que
  `/radio parar`, só uma sessão de voz por servidor)

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
   Scopes; em Bot Permissions marca `Connect`, `Speak` e `Manage Channels`
   (esse último é pro `/radio painel` criar o canal `#radio-painel`
   sozinho). Copia o link gerado embaixo e abre no navegador pra convidar
   o bot pro seu servidor.

### 2. Criar a tabela no Supabase

Mesmo projeto do SonorHub (`xtdydmfxqxsujrqdtrkn`). No **SQL Editor**, roda
o `supabase-schema.sql` desta pasta. Em **Project Settings > API**, copia a
**service_role key** (não a anon key!) — vira `SUPABASE_SERVICE_ROLE_KEY`.

### 3. Configurar e testar local (opcional, antes de subir pra VPS)

```bash
cd discord-bot
npm install
cp .env.example .env
# edita o .env com os valores dos passos 1 e 2 (DISCORD_GUILD_ID pode ficar
# vazio — é só um atalho opcional pro register-commands.js manual; o bot
# em si já se autorregistra em qualquer servidor sozinho, ao subir)
npm start
```

Se `npm install` falhar no `@discordjs/opus` (módulo nativo, precisa de
toolchain de C++), roda `npm install --build-from-source` ou troca a
dependência por `opusscript` no `package.json` (mais lento, mas 100% JS,
não precisa compilar nada) — bem comum precisar disso em VPS ARM (Oracle
Ampere), ver seção abaixo.

O bot registra os slash commands sozinho, por servidor, assim que conecta
(e de novo automaticamente se entrar num servidor novo) — não precisa
rodar nada manual pra isso.

### 4. Deploy numa VPS que você já tem (Oracle, ou qualquer outra)

Roda como um segundo processo na mesma VPS do seu outro bot — é leve o
bastante pra conviver junto, não precisa de VPS nova.

```bash
# 1. copia só a pasta discord-bot/ pra VPS (ou clona o repo inteiro e usa
#    só essa pasta — o resto do repo, ~75MB, não atrapalha nada)
git clone https://github.com/facincanitech/Sonor.git
cd Sonor/discord-bot

# 2. instala isso ANTES do npm install:
#    - build-essential/python3: se a VPS for ARM (Oracle Ampere A1) ou não
#      tiver toolchain de C++, o @discordjs/opus falha tentando compilar
#      do zero sem isso.
#    - ffmpeg: o bot usa o ffmpeg do sistema (PATH), não vem empacotado.
#      Foi de propósito — o pacote ffmpeg-static (binário pronto) tinha um
#      bug de compatibilidade (crashava/segfault) numa Oracle E2.1.Micro,
#      o do apt funciona liso.
sudo apt-get update && sudo apt-get install -y build-essential python3 ffmpeg

# 2b. yt-dlp (pro /youtube tocar) — o binário standalone oficial, não o do
#     apt (costuma ficar desatualizado e o YouTube muda o esquema de
#     extração toda hora, precisa de versão recente):
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
# manter atualizado de vez em quando (o YouTube quebra o extractor com
# frequência): sudo yt-dlp -U

# 3. instala as dependências
npm install --omit=dev

# 4. cria o .env de verdade (mesmo conteúdo que você já usou pra testar local)
cp .env.example .env
nano .env   # cola DISCORD_TOKEN, DISCORD_CLIENT_ID, SUPABASE_SERVICE_ROLE_KEY,
            # e YOUTUBE_COOKIES_FILE=/home/ubuntu/sonor-radio-bot/cookies.txt
            # se for usar /youtube (manda o cookies.txt exportado do seu
            # YouTube logado — extensão tipo "Get cookies.txt LOCALLY" — pro
            # mesmo caminho que você apontou aí)

# 5. testa rodando na mão primeiro — Ctrl+C depois de ver "Bot online como..."
npm start
```

Não precisa abrir nenhuma porta/firewall — o bot só faz conexões de saída
(pra Discord e pra Radio Browser/Supabase), não recebe nada de fora.

**Deixando ele rodando de verdade com PM2** (se o outro bot já usa PM2,
reaproveita o mesmo; se não tiver instalado: `sudo npm install -g pm2`):

```bash
cd Sonor/discord-bot
pm2 start src/index.js --name sonor-radio-bot
pm2 save                # salva a lista de processos
pm2 startup             # só na 1ª vez: mostra um comando pra rodar (com
                         # sudo) que faz o PM2 voltar sozinho se a VPS reiniciar
```

Comandos úteis depois:
```bash
pm2 logs sonor-radio-bot     # ver o que o bot tá logando
pm2 restart sonor-radio-bot  # reiniciar (ex: depois de git pull com mudanças)
pm2 stop sonor-radio-bot     # parar
```

Pra atualizar o bot depois de uma mudança no código: `git pull`, `npm
install` (só se mudou dependência), `pm2 restart sonor-radio-bot`.

## Por que não dá pra "puxar áudio do Discord pro SonorHub"

Esse bot resolve o caminho **SonorHub → Discord** (a lógica de busca de
rádio do app, tocando numa call). O caminho contrário (pegar áudio de
dentro de uma call do Discord e trazer pro app) não é algo que a API do
Discord expõe de forma simples — bots de música tocam áudio **pra dentro**
de uma call, não servem como fonte de stream pra fora. Se um dia fizer
sentido, dá pra pensar em expor esse bot como uma "rádio própria" (ex: ele
mesmo gerar um stream Icecast que o SonorHub escuta como se fosse mais uma
estação), mas é um projeto à parte, bem mais envolvido.
