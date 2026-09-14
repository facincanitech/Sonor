// Servidores Discord de confiança do dono do bot — só neles o /youtube
// (e o botão 🎵 YouTube / ⭐ Favoritos YT do painel) fica disponível. Ideia:
// em vez do bot expor a extração de YouTube (conta+cookies, zona cinzenta
// de ToS) em QUALQUER servidor que o convidar, ela fica restrita a uma
// lista controlada pelo próprio dono. Servidores convidados por terceiros
// que não estão nessa lista continuam com rádio de verdade normal
// (radio-browser.info, sem extração nenhuma, sem depender de conta
// nenhuma) — reduz bastante a exposição sem tirar a função de ninguém que
// só queira rádio.
const GUILDS_YOUTUBE_LIBERADO = (
  process.env.YOUTUBE_GUILD_IDS || '170887646363648000,840941809059364904,1548131076130742304,1415370456516657223'
)
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

function youtubeLiberado(guildId) {
  return GUILDS_YOUTUBE_LIBERADO.includes(guildId);
}

module.exports = { GUILDS_YOUTUBE_LIBERADO, youtubeLiberado };
