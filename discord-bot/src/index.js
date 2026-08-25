require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, MessageFlags } = require('discord.js');
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

// Alguém saiu (ou entrou) de um canal de voz — se o canal onde o bot tá
// tocando ficou vazio (só o bot), sai também em vez de continuar tocando
// pra ninguém ouvir. Só interessa quando a mudança envolve o canal ativo.
client.on('voiceStateUpdate', (oldState, newState) => {
  const guildId = (oldState.guild || newState.guild).id;
  const canalAtivoId = player.activeChannelId(guildId);
  if (!canalAtivoId) return;
  if (oldState.channelId !== canalAtivoId && newState.channelId !== canalAtivoId) return;
  const canal = oldState.guild.channels.cache.get(canalAtivoId);
  player.saiSeCanalVazio(guildId, canal);
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
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand() || !['radio', 'youtube'].includes(interaction.commandName)) return;
  const sub = interaction.options.getSubcommand();

  // Todas as respostas de comando são efêmeras (só quem digitou vê) e
  // somem sozinhas depois de um tempo — evita lotar o canal de tralha. O
  // painel fixo (/radio painel) é a exceção, ele fica.
  if (interaction.commandName === 'youtube') {
    try {
      if (sub === 'tocar') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const busca = interaction.options.getString('busca', true);
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
          await interaction.editReply('Entra numa call primeiro, aí eu toco lá.');
          panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
          return;
        }
        const ocupadoMsg = panel.mensagemCanalOcupado(interaction.guildId, voiceChannel.id);
        if (ocupadoMsg) {
          await interaction.editReply(ocupadoMsg);
          panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
          return;
        }
        const item = await youtube.buscar(busca);
        await player.playFromProcess(voiceChannel, item, () => youtube.spawnAudioStream(item.url));
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(COR).setTitle('▶️ Tocando agora (YouTube)').setDescription(`**${item.name}**${item.uploader ? ` — ${item.uploader}` : ''}`)],
        });
        panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
        return;
      }

      if (sub === 'parar') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const parou = player.stop(interaction.guildId);
        await interaction.editReply(parou ? '⏹ Parei e saí da call.' : 'Não tinha nada tocando aqui.');
        panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
        return;
      }
    } catch (err) {
      console.error(err);
      const msg = `Deu ruim: ${err.message}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg).catch(() => {});
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
    return;
  }

  try {
    if (sub === 'painel') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const canal = await panel.canalDoPainel(interaction.guild);
      await canal.send({ embeds: [panel.painelEmbed()], components: panel.painelRows() });
      await interaction.editReply(`📻 Painel pronto em ${canal}.`);
      panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
      return;
    }

    if (sub === 'tocar') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const nome = interaction.options.getString('nome', true);
      const estacoes = await radio.buscarRadios(nome);
      if (!estacoes.length) {
        await interaction.editReply(`Não achei nenhuma rádio com "${nome}". Tenta outro nome.`);
        panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
        return;
      }
      await interaction.editReply({ embeds: [panel.resultadosEmbed(estacoes, nome)], components: panel.resultadosComponents(estacoes) });
      panel.agendarSumico(interaction, panel.SOME_LISTA_MS);
      return;
    }

    if (sub === 'salvar') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const atual = player.current(interaction.guildId);
      if (!atual) {
        await interaction.editReply('Não tem nenhuma rádio tocando aqui pra salvar.');
        panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
        return;
      }
      await radio.salvarFavorita(interaction.user.id, atual);
      await interaction.editReply({ embeds: [embedEstacao('⭐ Salva nos favoritos', atual)] });
      panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
      return;
    }

    if (sub === 'favoritos') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const favs = await radio.listarFavoritas(interaction.user.id);
      if (!favs.length) {
        await interaction.editReply('Você ainda não salvou nenhuma rádio. Usa `/radio tocar` e depois `/radio salvar`.');
        panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
        return;
      }
      const lista = favs.map((f, i) => `${i + 1}. **${f.station_name}**${f.country ? ` — ${f.country}` : ''}`).join('\n');
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(COR).setTitle('⭐ Suas rádios salvas').setDescription(lista)],
      });
      panel.agendarSumico(interaction, panel.SOME_LISTA_MS);
      return;
    }

    if (sub === 'aleatoria') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) {
        await interaction.editReply('Entra numa call primeiro, aí eu toco a rádio lá.');
        panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
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
        panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
        return;
      }
      const ocupadoMsg = panel.mensagemCanalOcupado(interaction.guildId, voiceChannel.id);
      if (ocupadoMsg) {
        await interaction.editReply(ocupadoMsg);
        panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
        return;
      }
      await player.play(voiceChannel, est);
      radio.registrarHistorico(interaction.user.id, est).catch(() => {});
      await interaction.editReply({ embeds: [embedEstacao(`🎲 Aleatória (${origem})`, est)] });
      panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
      return;
    }

    if (sub === 'historico') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const hist = await radio.listarHistorico(interaction.user.id);
      if (!hist.length) {
        await interaction.editReply('Você ainda não tocou nenhuma rádio.');
        panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
        return;
      }
      const lista = hist.map((f, i) => `${i + 1}. **${f.station_name}**${f.country ? ` — ${f.country}` : ''}`).join('\n');
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(COR).setTitle('📜 Tocadas recentemente').setDescription(lista)],
      });
      panel.agendarSumico(interaction, panel.SOME_LISTA_MS);
      return;
    }

    if (sub === 'parar') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const parou = player.stop(interaction.guildId);
      await interaction.editReply(parou ? '⏹ Parei e saí da call.' : 'Não tinha nenhuma rádio tocando aqui.');
      panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
      return;
    }
  } catch (err) {
    console.error(err);
    const msg = `Deu ruim: ${err.message}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
