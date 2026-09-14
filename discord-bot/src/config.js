// Servidor Discord "principal" (do próprio dono do bot) — só nele o /youtube
// (e o botão 🎵 YouTube / ⭐ Favoritos YT do painel) fica disponível. Ideia:
// em vez do bot expor a extração de YouTube (conta+cookies, zona cinzenta
// de ToS) em QUALQUER servidor que o convidar, ela fica restrita a um único
// lugar controlado pelo próprio dono. Servidores convidados por terceiros
// continuam com rádio de verdade normal (radio-browser.info, sem extração
// nenhuma, sem depender de conta nenhuma) — reduz bastante a exposição sem
// tirar a função de ninguém que só queira rádio.
const GUILD_ID_YOUTUBE_LIBERADO = process.env.YOUTUBE_GUILD_ID || '170887646363648000';

function youtubeLiberado(guildId) {
  return guildId === GUILD_ID_YOUTUBE_LIBERADO;
}

module.exports = { GUILD_ID_YOUTUBE_LIBERADO, youtubeLiberado };
