require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes } = require('discord.js');
const radio = require('./radio');
const player = require('./player');
const youtube = require('./youtube');
const { commands } = require('./commands');
const panel = require('./panel');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const COR = 0x45b8a8; // mesmo teal do SonorHub

// Auto-registra os comandos como comando DE SERVIDOR (não global) em
// qualquer guild que o bot esteja — aparece na hora (comando global demora
// até 1h) e não duplica, já que cada guild só recebe o registro uma vez
// (a chamada é um PUT, substitui o que já tinha lá, não soma).
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
async function registrarComandosNoServidor(guildId) {
  try {
    await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId), { body: commands });
    console.log(`Comandos registrados no servidor ${guildId}.`);
  } catch (err) {
    console.error(`Falha ao registrar comandos no servidor ${guildId}:`, err.message);
  }
}

function embedEstacao(titulo, est) {
  return new EmbedBuilder()
    .setColor(COR)
    .setTitle(titulo)
    .setDescription(`**${est.name}**${est.country ? ` — ${est.country}` : ''}`);
}

client.once('ready', async () => {
  console.log(`Bot online como ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    await registrarComandosNoServidor(guild.id);
  }
});

client.on('guildCreate', (guild) => {
  console.log(`Entrou num servidor novo: ${guild.name} (${guild.id})`);
  registrarComandosNoServidor(guild.id);
});

client.on('interactionCreate', async (interaction) => {
  // Botões/modal/select do painel (/radio painel) — não são chat input command.
  if (interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) {
    try {
      const tratado = await panel.handleInteraction(interaction);
      if (!tratado) return;
    } catch (err) {
      console.error(err);
      const msg = `Deu ruim: ${err.message}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg).catch(() => {});
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand() || !['radio', 'youtube'].includes(interaction.commandName)) return;
  const sub = interaction.options.getSubcommand();

  if (interaction.commandName === 'youtube') {
    try {
      if (sub === 'tocar') {
        await interaction.deferReply();
        const busca = interaction.options.getString('busca', true);
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
          await interaction.editReply('Entra numa call primeiro, aí eu toco lá.');
          return;
        }
        const item = await youtube.buscar(busca);
        const proc = youtube.spawnAudioStream(item.url);
        await player.playFromProcess(voiceChannel, item, proc);
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(COR).setTitle('▶️ Tocando agora (YouTube)').setDescription(`**${item.name}**${item.uploader ? ` — ${item.uploader}` : ''}`)],
        });
        return;
      }

      if (sub === 'parar') {
        await interaction.deferReply();
        const parou = player.stop(interaction.guildId);
        await interaction.editReply(parou ? '⏹ Parei e saí da call.' : 'Não tinha nada tocando aqui.');
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
    return;
  }

  try {
    if (sub === 'painel') {
      await interaction.reply({ embeds: [panel.painelEmbed()], components: panel.painelRows() });
      return;
    }

    if (sub === 'tocar') {
      await interaction.deferReply();
      const nome = interaction.options.getString('nome', true);
      const estacoes = await radio.buscarRadios(nome);
      if (!estacoes.length) {
        await interaction.editReply(`Não achei nenhuma rádio com "${nome}". Tenta outro nome.`);
        return;
      }
      await interaction.editReply({ embeds: [panel.resultadosEmbed(estacoes, nome)], components: panel.resultadosComponents(estacoes) });
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
      radio.registrarHistorico(interaction.user.id, est).catch(() => {});
      await interaction.editReply({ embeds: [embedEstacao(`🎲 Aleatória (${origem})`, est)] });
      return;
    }

    if (sub === 'historico') {
      await interaction.deferReply({ ephemeral: true });
      const hist = await radio.listarHistorico(interaction.user.id);
      if (!hist.length) {
        await interaction.editReply('Você ainda não tocou nenhuma rádio.');
        return;
      }
      const lista = hist.map((f, i) => `${i + 1}. **${f.station_name}**${f.country ? ` — ${f.country}` : ''}`).join('\n');
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(COR).setTitle('📜 Tocadas recentemente').setDescription(lista)],
      });
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
