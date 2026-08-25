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
  });
  connection.subscribe(player);
  const session = { connection, player, current: null, sourceProcess: null };
  connection.on('stateChange', (oldState, newState) => {
    console.log(`[player] conexão de voz mudou: ${oldState.status} -> ${newState.status}`);
  });
  // "Disconnected" não é sempre definitivo — soluço de rede/protocolo com o
  // Discord costuma se recuperar sozinho em poucos segundos (a conexão
  // volta pra "signalling"/"connecting"). Destruir na hora (como era antes)
  // matava a sessão à toa nesses casos, deixando o bot mudo até alguém
  // rodar /radio tocar de novo manualmente — bug real visto em produção
  // (log mostrava "ready -> disconnected -> destroyed" do nada, sem cair
  // conexão de internet nem nada do lado do usuário). Só destrói de vez se
  // não voltar a sinalizar em 5s (padrão recomendado pela doc do
  // @discordjs/voice).
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // Voltou a sinalizar sozinho — deixa quieto, não é uma queda de verdade.
    } catch {
      try { connection.destroy(); } catch {}
      sessions.delete(voiceChannel.guild.id);
    }
  });
  return session;
}

async function tocarComResource(voiceChannel, item, resource, sourceProcess) {
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
  await entersState(session.player, AudioPlayerStatus.Playing, 15_000);
  return session;
}

async function play(voiceChannel, estacao) {
  const url = estacao.url_resolved || estacao.url;
  return tocarComResource(voiceChannel, estacao, resourceFromUrl(url), null);
}

async function playFromProcess(voiceChannel, item, sourceProcess) {
  return tocarComResource(voiceChannel, item, resourceFromProcess(sourceProcess), sourceProcess);
}

function stop(guildId) {
  const session = sessions.get(guildId);
  if (!session) return false;
  if (session.sourceProcess) {
    try { session.sourceProcess.kill(); } catch {}
  }
  session.player.stop();
  session.connection.destroy();
  sessions.delete(guildId);
  return true;
}

function current(guildId) {
  return sessions.get(guildId)?.current || null;
}

// ID do canal de voz onde o bot já tá conectado nesse servidor, ou null se
// não tiver sessão ativa. Usado pra recusar tocar em outro canal do mesmo
// servidor em vez de simplesmente pular pra lá — só uma pessoa por vez usa
// o bot em cada Discord (limitação da própria API de voz do Discord, não
// dá pra estar em 2 canais do mesmo servidor ao mesmo tempo).
function activeChannelId(guildId) {
  return sessions.get(guildId)?.connection?.joinConfig?.channelId || null;
}

module.exports = { play, playFromProcess, stop, current, activeChannelId };
