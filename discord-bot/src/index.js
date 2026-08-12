require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const radio = require('./radio');
const player = require('./player');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const COR = 0x45b8a8; // mesmo teal do SonorHub

function embedEstacao(titulo, est) {
  return new EmbedBuilder()
    .setColor(COR)
    .setTitle(titulo)
    .setDescription(`**${est.name}**${est.country ? ` — ${est.country}` : ''}`);
}

client.once('ready', () => {
  console.log(`Bot online como ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'radio') return;
  const sub = interaction.options.getSubcommand();

  try {
    if (sub === 'tocar') {
      await interaction.deferReply();
      const nome = interaction.options.getString('nome', true);
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) {
        await interaction.editReply('Entra numa call primeiro, aí eu toco a rádio lá.');
        return;
      }
      const estacoes = await radio.buscarRadios(nome);
      if (!estacoes.length) {
        await interaction.editReply(`Não achei nenhuma rádio com "${nome}". Tenta outro nome.`);
        return;
      }
      const est = estacoes[0];
      await player.play(voiceChannel, est);
      await interaction.editReply({ embeds: [embedEstacao('📻 Tocando agora', est)] });
      return;
    }

    if (sub === 'salvar') {
      await interaction.deferReply();
      const atual = player.current(interaction.guildId);
      if (!atual) {
        await interaction.editReply('Não tem nenhuma rádio tocando aqui pra salvar.');
        return;
      }
      await radio.salvarFavorita(interaction.user.id, atual);
      await interaction.editReply({ embeds: [embedEstacao('⭐ Salva nos favoritos', atual)] });
      return;
    }

    if (sub === 'favoritos') {
      await interaction.deferReply({ ephemeral: true });
      const favs = await radio.listarFavoritas(interaction.user.id);
      if (!favs.length) {
        await interaction.editReply('Você ainda não salvou nenhuma rádio. Usa `/radio tocar` e depois `/radio salvar`.');
        return;
      }
      const lista = favs.map((f, i) => `${i + 1}. **${f.station_name}**${f.country ? ` — ${f.country}` : ''}`).join('\n');
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(COR).setTitle('⭐ Suas rádios salvas').setDescription(lista)],
      });
      return;
    }

    if (sub === 'aleatoria') {
      await interaction.deferReply();
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) {
        await interaction.editReply('Entra numa call primeiro, aí eu toco a rádio lá.');
        return;
      }
      let est = await radio.estacaoAleatoriaFavorita(interaction.user.id).catch(() => null);
      let origem = 'dos seus favoritos';
      if (!est) {
        est = await radio.estacaoAleatoriaGlobal();
        origem = 'descoberta';
      }
      if (!est) {
        await interaction.editReply('Não consegui sortear nenhuma rádio agora, tenta de novo em instantes.');
        return;
      }
      await player.play(voiceChannel, est);
      await interaction.editReply({ embeds: [embedEstacao(`🎲 Aleatória (${origem})`, est)] });
      return;
    }

    if (sub === 'parar') {
      await interaction.deferReply();
      const parou = player.stop(interaction.guildId);
      await interaction.editReply(parou ? '⏹ Parei e saí da call.' : 'Não tinha nenhuma rádio tocando aqui.');
      return;
    }
  } catch (err) {
    console.error(err);
    const msg = `Deu ruim: ${err.message}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
