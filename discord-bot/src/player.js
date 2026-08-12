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
const ffmpegPath = require('ffmpeg-static');

// Um "player" (conexão de voz + audio player) por servidor — trocar de rádio
// no mesmo servidor reaproveita a mesma conexão em vez de entrar de novo.
const sessions = new Map(); // guildId -> { connection, player, current }

function resourceFromUrl(url) {
  // Stream de rádio (icecast/shoutcast, mp3 ou aac) -> PCM -> Opus, direto
  // pelo ffmpeg, sem precisar baixar nada em disco.
  const transcoder = new prism.FFmpeg({
    command: ffmpegPath,
    args: [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '4',
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-i', url,
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
    ],
  });
  const opusEncoder = new prism.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 });
  const stream = transcoder.pipe(opusEncoder);
  stream.on('error', () => {});
  transcoder.on('error', () => {});
  return createAudioResource(stream, { inputType: StreamType.Opus });
}

async function play(voiceChannel, estacao) {
  const guildId = voiceChannel.guild.id;
  let session = sessions.get(guildId);

  if (!session) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    const player = createAudioPlayer();
    connection.subscribe(player);
    session = { connection, player, current: null };
    sessions.set(guildId, session);

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      try { connection.destroy(); } catch {}
      sessions.delete(guildId);
    });
  }

  const url = estacao.url_resolved || estacao.url;
  const resource = resourceFromUrl(url);
  session.player.play(resource);
  session.current = estacao;
  await entersState(session.player, AudioPlayerStatus.Playing, 15_000);
  return session;
}

function stop(guildId) {
  const session = sessions.get(guildId);
  if (!session) return false;
  session.player.stop();
  session.connection.destroy();
  sessions.delete(guildId);
  return true;
}

function current(guildId) {
  return sessions.get(guildId)?.current || null;
}

module.exports = { play, stop, current };
