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

function opusStreamFromTranscoder(transcoder) {
  const opusEncoder = new prism.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 });
  const stream = transcoder.pipe(opusEncoder);
  stream.on('error', (err) => console.error('[player] erro no stream de áudio:', err.message));
  transcoder.on('error', (err) => console.error('[player] erro no ffmpeg:', err.message));
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
      '-analyzeduration', '0',
      '-loglevel', 'error',
      '-i', url,
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
    ],
  });
  return opusStreamFromTranscoder(transcoder);
}

// YouTube: o "sourceProcess" é um yt-dlp já rodando (ver youtube.js),
// escrevendo o áudio bruto no próprio stdout — o ffmpeg lê isso pela
// entrada padrão dele (sem "-i", o prism-media já assume stdin).
function resourceFromProcess(sourceProcess) {
  const transcoder = new prism.FFmpeg({
    args: ['-analyzeduration', '0', '-loglevel', 'error', '-f', 's16le', '-ar', '48000', '-ac', '2'],
  });
  sourceProcess.stdout.pipe(transcoder);
  sourceProcess.on('error', (err) => console.error('[player] erro no processo de origem (yt-dlp):', err.message));
  return opusStreamFromTranscoder(transcoder);
}

function novaSessao(voiceChannel) {
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });
  const player = createAudioPlayer();
  player.on('error', (err) => console.error('[player] erro no AudioPlayer:', err.message));
  connection.subscribe(player);
  const session = { connection, player, current: null, sourceProcess: null };
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    try { connection.destroy(); } catch {}
    sessions.delete(voiceChannel.guild.id);
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

module.exports = { play, playFromProcess, stop, current };
