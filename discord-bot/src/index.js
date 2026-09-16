require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, MessageFlags } = require('discord.js');
const radio = require('./radio');
const player = require('./player');
const youtube = require('./youtube');
const { commands, commandsSoRadio } = require('./commands');
const panel = require('./panel');
const { youtubeLiberado, GUILDS_YOUTUBE_LIBERADO } = require('./config');

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
    const body = youtubeLiberado(guildId) ? commands : commandsSoRadio;
    await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId), { body });
    console.log(`Comandos registrados no servidor ${guildId} (${youtubeLiberado(guildId) ? 'com YouTube' : 'só rádio'}).`);
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
  console.log(`Servidores liberados pro YouTube: ${GUILDS_YOUTUBE_LIBERADO.join(', ')}`);
  console.log(`Em ${client.guilds.cache.size} servidor(es):`);
  for (const guild of client.guilds.cache.values()) {
    console.log(`  - ${guild.name} (${guild.id})${youtubeLiberado(guild.id) ? '  <-- YouTube liberado aqui' : ''}`);
    await registrarComandosNoServidor(guild.id);
  }
  await panel.carregarPaineisSalvos(client);
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
    if (!youtubeLiberado(interaction.guildId)) {
      await interaction.reply({ content: '🔒 YouTube só tá liberado no servidor principal. Aqui só tem rádio de verdade mesmo.', flags: MessageFlags.Ephemeral });
      return;
    }
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
        const fila = await youtube.resolverFila(busca);
        const { item } = await player.playYoutubeQueue(voiceChannel, fila, {
          aoTrocarFaixa: () => panel.atualizarPainelAoVivo(interaction.guildId, interaction.client).catch(() => {}),
        });
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(COR)
              .setTitle('▶️ Tocando agora (YouTube)')
              .setDescription(`**${item.name}**${item.uploader ? ` — ${item.uploader}` : ''}${fila.length > 1 ? `\n📃 +${fila.length - 1} na fila` : ''}`),
          ],
        });
        panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
        return;
      }

      if (sub === 'salvar') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const atual = player.current(interaction.guildId);
        if (!atual || player.currentFonte(interaction.guildId) !== 'youtube') {
          await interaction.editReply('Não tem nenhum vídeo do YouTube tocando aqui pra salvar.');
          panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
          return;
        }
        await youtube.salvarFavorita(interaction.user.id, atual);
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(COR).setTitle('⭐ Salvo nos favoritos do YouTube').setDescription(`**${atual.name}**${atual.uploader ? ` — ${atual.uploader}` : ''}`)],
        });
        panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
        return;
      }

      if (sub === 'favoritos') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const favs = await youtube.listarFavoritas(interaction.user.id);
        if (!favs.length) {
          await interaction.editReply('Você ainda não salvou nenhum vídeo do YouTube. Usa `/youtube tocar` e depois `/youtube salvar`.');
          panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
          return;
        }
        const lista = favs.map((f, i) => `${i + 1}. **${f.name}**${f.uploader ? ` — ${f.uploader}` : ''}`).join('\n');
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(COR).setTitle('⭐ Seus vídeos salvos').setDescription(lista)],
        });
        panel.agendarSumico(interaction, panel.SOME_LISTA_MS);
        return;
      }

      if (sub === 'parar') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const parou = player.stop(interaction.guildId);
        if (parou) panel.atualizarPainelAoVivo(interaction.guildId, interaction.client).catch(() => {});
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
      const msg = await canal.send({ embeds: [panel.nowPlayingEmbed(interaction.guildId)], components: panel.painelRows(interaction.guildId) });
      panel.registrarPainel(interaction.guildId, msg);
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
      const token = panel.cachePesquisa(estacoes, nome);
      await interaction.editReply({ embeds: [panel.resultadosEmbed(estacoes, nome, 0)], components: panel.resultadosComponents(token, estacoes, 0) });
      panel.agendarSumico(interaction, panel.SOME_LISTA_MS);
      return;
    }

    if (sub === 'salvar') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const atual = player.current(interaction.guildId);
      if (!atual) {
        await interaction.editReply('Não tem nada tocando aqui pra salvar.');
        panel.agendarSumico(interaction, panel.SOME_RAPIDO_MS);
        return;
      }
      if (player.currentFonte(interaction.guildId) === 'youtube') {
        await youtube.salvarFavorita(interaction.user.id, atual);
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(COR).setTitle('⭐ Salvo nos favoritos do YouTube').setDescription(`**${atual.name}**${atual.uploader ? ` — ${atual.uploader}` : ''}`)],
        });
      } else {
        await radio.salvarFavorita(interaction.user.id, atual);
        await interaction.editReply({ embeds: [embedEstacao('⭐ Salva nos favoritos', atual)] });
      }
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
      const est = await radio.estacaoAleatoriaGlobal();
      const origem = 'descoberta';
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
      panel.limparIcyCache(interaction.guildId);
      panel.atualizarPainelAoVivo(interaction.guildId, interaction.client).catch(() => {});
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
      if (parou) panel.atualizarPainelAoVivo(interaction.guildId, interaction.client).catch(() => {});
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
