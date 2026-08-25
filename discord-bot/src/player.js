const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const prism = require('prism-media');

// Usa o ffmpeg do sistema (apt install ffmpeg), não o pacote ffmpeg-static:
// o binário empacotado do ffmpeg-static crashava (segfault) decodificando
// qualquer stream real nessa VPS — provável bug de dispatch SIMD específico
// daquele build. O ffmpeg do apt funciona normal. Ver README, seção de deploy.

// Um "player" (conexão de voz + audio player) por servidor — trocar de rádio
// ou YouTube no mesmo servidor reaproveita a mesma conexão em vez de entrar
// de novo.
const sessions = new Map(); // guildId -> { connection, player, current, sourceProcess }

// Log verboso de propósito — a 1ª versão disso ficava muda/parava sem
// deixar rastro nenhum (handlers de erro vazios, stream "end" normal
// nunca logado). Até identificar o padrão real de queda, loga tudo:
// fim de stream, fechamento do processo ffmpeg, motivo do estado do
// player mudar.
function opusStreamFromTranscoder(transcoder, label) {
  const opusEncoder = new prism.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 });
  const stream = transcoder.pipe(opusEncoder);
  stream.on('error', (err) => console.error(`[player:${label}] erro no stream de áudio:`, err.message));
  stream.on('close', () => console.log(`[player:${label}] stream de áudio fechou`));
  transcoder.on('error', (err) => console.error(`[player:${label}] erro no ffmpeg:`, err.message));
  transcoder.on('close', () => console.log(`[player:${label}] processo ffmpeg encerrou`));
  return createAudioResource(stream, { inputType: StreamType.Opus });
}

// Rádio: URL de stream direto (icecast/shoutcast/hls), o ffmpeg busca ele
// mesmo, sem baixar nada em disco.
function resourceFromUrl(url) {
  const transcoder = new prism.FFmpeg({
    args: [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '4',
      '-reconnect_at_eof', '1',
      '-analyzeduration', '0',
      '-loglevel', 'warning',
      '-i', url,
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
    ],
  });
  return opusStreamFromTranscoder(transcoder, 'radio');
}

// YouTube: o "sourceProcess" é um yt-dlp já rodando (ver youtube.js),
// escrevendo o áudio bruto no próprio stdout — o ffmpeg lê isso pela
// entrada padrão dele (sem "-i", o prism-media já assume stdin).
function resourceFromProcess(sourceProcess) {
  const transcoder = new prism.FFmpeg({
    args: ['-analyzeduration', '0', '-loglevel', 'warning', '-f', 's16le', '-ar', '48000', '-ac', '2'],
  });
  sourceProcess.stdout.pipe(transcoder);
  sourceProcess.on('error', (err) => console.error('[player:youtube] erro no processo de origem (yt-dlp):', err.message));
  sourceProcess.on('close', (code) => console.log(`[player:youtube] yt-dlp encerrou, código ${code}`));
  return opusStreamFromTranscoder(transcoder, 'youtube');
}

// Tempo parado sem tocar nada (idle de verdade, não os idles rápidos de
// meio-segundo entre uma reconexão de stream e outra) até o bot sair sozinho
// da call — evita ficar pendurado num canal indefinidamente depois de um
// /radio parar que falhou ou de alguém esquecer de mandar parar.
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function limparTimerIdle(session) {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
}

// Vigia de "travou tocando silêncio": alguns streams (icecast antigo,
// principalmente) somem sem fechar a conexão TCP nem soltar erro nenhum —
// não é um "stream fechou" (isso o ffmpeg já reconecta sozinho, ver
// -reconnect_* nos args), é a conexão continuar "aberta" só que sem mandar
// mais nenhum byte. Nesse caso o AudioPlayer nem percebe: ele fica no
// estado "playing" pra sempre, porque do ponto de vista dele nada deu
// errado, só não tem áudio novo chegando. Detecta isso comparando
// resource.playbackDuration (só avança quando tem áudio de verdade tocando)
// entre duas checagens; se não andou nada com o player em "playing" pelo
// intervalo inteiro, considera travado e força uma reconexão do zero.
const VIGIA_INTERVALO_MS = 12_000;

function limparVigia(session) {
  if (session.vigiaInterval) {
    clearInterval(session.vigiaInterval);
    session.vigiaInterval = null;
  }
}

function iniciarVigia(session, guildId) {
  limparVigia(session);
  let ultimaDuracao = -1;
  session.vigiaInterval = setInterval(() => {
    const atual = sessions.get(guildId);
    if (atual !== session) { clearInterval(session.vigiaInterval); return; }
    if (session.player.state.status !== AudioPlayerStatus.Playing) { ultimaDuracao = -1; return; }
    const duracaoAgora = session.player.state.resource?.playbackDuration ?? 0;
    if (ultimaDuracao !== -1 && duracaoAgora === ultimaDuracao && session.regenerar) {
      console.log('[player] tocando mas sem avançar áudio nenhum — travado (silêncio mudo), forçando reconexão do zero.');
      session.regenerar();
    }
    ultimaDuracao = duracaoAgora;
  }, VIGIA_INTERVALO_MS);
}

function novaSessao(voiceChannel) {
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });
  const player = createAudioPlayer();
  player.on('error', (err) => console.error('[player] erro no AudioPlayer:', err.message));
  player.on('stateChange', (oldState, newState) => {
    console.log(`[player] estado mudou: ${oldState.status} -> ${newState.status}`);
    const session = sessions.get(voiceChannel.guild.id);
    if (!session) return;
    if (newState.status === AudioPlayerStatus.Idle) {
      limparTimerIdle(session);
      session.idleTimer = setTimeout(() => {
        console.log('[player] parado há muito tempo sem tocar nada, saindo da call sozinho.');
        stop(voiceChannel.guild.id);
      }, IDLE_TIMEOUT_MS);
    } else {
      limparTimerIdle(session);
    }
  });
  connection.subscribe(player);
  const session = {
    connection, player, current: null, sourceProcess: null, idleTimer: null,
    vigiaInterval: null, regenerar: null, fonte: null, saindoDeProposito: false,
  };
  connection.on('stateChange', (oldState, newState) => {
    console.log(`[player] conexão de voz mudou: ${oldState.status} -> ${newState.status}`);
  });
  // "Disconnected" não é sempre definitivo — soluço de rede/protocolo com o
  // Discord costuma se recuperar sozinho em poucos segundos (a conexão
  // volta pra "signalling"/"connecting"). Destruir na hora (como era antes)
  // matava a sessão à toa nesses casos, deixando o bot mudo até alguém
  // rodar /radio tocar de novo manualmente. Só destrói de vez se não voltar
  // a sinalizar em 5s (padrão recomendado pela doc do @discordjs/voice).
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // Voltou a sinalizar sozinho — deixa quieto, não é uma queda de verdade.
    } catch {
      try { connection.destroy(); } catch {}
    }
  });
  // Rede visto em produção também derruba a conexão pulando direto de
  // "ready" pra "destroyed", sem passar por "disconnected" — nesse caso o
  // handler acima nunca dispara, e a sessão ficava morta pra sempre (bot
  // continuava "na call" pro Discord mas sem tocar nada, porque
  // internamente a conexão já tinha sumido). Esse listener aqui cobre
  // QUALQUER destroy inesperado (venha de onde vier) reconstruindo a
  // sessão do zero sozinho, exceto quando fomos nós que pedimos pra sair
  // de propósito (/radio parar, seta saindoDeProposito antes de destruir).
  connection.on(VoiceConnectionStatus.Destroyed, () => {
    if (sessions.get(voiceChannel.guild.id) !== session) return; // já foi trocada/limpa por outro fluxo
    sessions.delete(voiceChannel.guild.id);
    limparTimerIdle(session);
    limparVigia(session);
    if (!session.saindoDeProposito && session.regenerar) {
      console.log('[player] conexão de voz destruída inesperadamente, reconstruindo sessão do zero.');
      session.regenerar();
    }
  });
  return session;
}

async function tocarComResource(voiceChannel, item, resource, sourceProcess, regenerar, fonte) {
  const guildId = voiceChannel.guild.id;
  let session = sessions.get(guildId);
  if (!session) {
    session = novaSessao(voiceChannel);
    await entersState(session.connection, VoiceConnectionStatus.Ready, 15_000);
    sessions.set(guildId, session);
  }
  if (session.sourceProcess) {
    try { session.sourceProcess.kill(); } catch {}
  }
  session.player.play(resource);
  session.current = item;
  session.sourceProcess = sourceProcess || null;
  session.regenerar = regenerar || null;
  session.fonte = fonte || null;
  await entersState(session.player, AudioPlayerStatus.Playing, 15_000);
  iniciarVigia(session, guildId);
  return session;
}

// A 1ª tentativa (chamada pelo comando do usuário) deixa o erro subir
// normalmente pra quem chamou mostrar "deu ruim" na hora. Já a função
// "regenerar" guardada na sessão é chamada sozinha pela vigia lá em cima,
// sem ninguém esperando — erro ali só vai pro log, não tem quem avisar.
async function play(voiceChannel, estacao) {
  const url = estacao.url_resolved || estacao.url;
  const regenerar = async () => {
    try {
      await tocarComResource(voiceChannel, estacao, resourceFromUrl(url), null, regenerar, 'radio');
    } catch (err) {
      console.error('[player] falha ao reconectar rádio travada:', err.message);
    }
  };
  return tocarComResource(voiceChannel, estacao, resourceFromUrl(url), null, regenerar, 'radio');
}

async function playFromProcess(voiceChannel, item, spawnSourceProcess) {
  const regenerar = async () => {
    try {
      const sourceProcess = spawnSourceProcess();
      await tocarComResource(voiceChannel, item, resourceFromProcess(sourceProcess), sourceProcess, regenerar, 'youtube');
    } catch (err) {
      console.error('[player] falha ao reconectar YouTube travado:', err.message);
    }
  };
  const sourceProcess = spawnSourceProcess();
  return tocarComResource(voiceChannel, item, resourceFromProcess(sourceProcess), sourceProcess, regenerar, 'youtube');
}

function stop(guildId) {
  const session = sessions.get(guildId);
  if (!session) return false;
  session.saindoDeProposito = true;
  limparTimerIdle(session);
  limparVigia(session);
  session.regenerar = null;
  if (session.sourceProcess) {
    try { session.sourceProcess.kill(); } catch {}
  }
  session.player.stop();
  session.connection.destroy();
  sessions.delete(guildId);
  return true;
}

// Chamado pelo index.js a cada voiceStateUpdate — se o canal onde o bot tá
// tocando ficou só com o bot (todo mundo real saiu), sai também em vez de
// continuar tocando sozinho pra ninguém ouvir.
function saiSeCanalVazio(guildId, canal) {
  if (!canal || canal.id !== activeChannelId(guildId)) return;
  const temGenteReal = canal.members.some((m) => !m.user.bot);
  if (!temGenteReal) stop(guildId);
}

function current(guildId) {
  return sessions.get(guildId)?.current || null;
}

// 'radio' ou 'youtube' — pra saber em qual tabela salvar/listar favoritos
// do que tá tocando agora nesse servidor.
function currentFonte(guildId) {
  return sessions.get(guildId)?.fonte || null;
}

// ID do canal de voz onde o bot já tá conectado nesse servidor, ou null se
// não tiver sessão ativa. Usado pra recusar tocar em outro canal do mesmo
// servidor em vez de simplesmente pular pra lá — só uma pessoa por vez usa
// o bot em cada Discord (limitação da própria API de voz do Discord, não
// dá pra estar em 2 canais do mesmo servidor ao mesmo tempo).
function activeChannelId(guildId) {
  return sessions.get(guildId)?.connection?.joinConfig?.channelId || null;
}

module.exports = { play, playFromProcess, stop, current, currentFonte, activeChannelId, saiSeCanalVazio };
