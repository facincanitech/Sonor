// Painel dentro do Discord (botões/menus na própria mensagem), no mesmo
// estilo do outro bot que já roda nessa VPS (dayz-bot): nada de site
// separado, tudo por component do discord.js.
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const crypto = require('crypto');
const radio = require('./radio');
const player = require('./player');

const COR = 0x45b8a8;
const NOME_CANAL_PAINEL = '📻-painel';
const NOME_CATEGORIA = '🎧 SONOR';

// Toda resposta de botão/modal/select é efêmera (só quem clicou vê) e some
// sozinha depois de um tempo — evita lotar o #radio-painel de tralha. O
// painel em si (mensagem fixa postada por /radio painel) nunca é tocado
// por esse timeout, só as respostas avulsas dos cliques.
const SOME_RAPIDO_MS = 8000; // confirmações simples (tocando, salvo, erro)
const SOME_LISTA_MS = 20000; // listas com botão/menu pra escolher

function agendarSumico(interaction, ms) {
  setTimeout(() => interaction.deleteReply().catch(() => {}), ms);
}

// Nomes usados antes de ganhar emoji — se existirem, renomeia em vez de
// criar duplicado.
const NOME_CATEGORIA_ANTIGO = 'Sonor';
const NOME_CANAL_PAINEL_ANTIGO = 'radio-painel';

// Cria (1ª vez) ou reaproveita a categoria "SONOR" pra organizar os canais
// do bot dentro dela em vez de espalhados na raiz do servidor.
async function categoriaSonor(guild) {
  let categoria = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === NOME_CATEGORIA);
  if (!categoria) {
    const antiga = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === NOME_CATEGORIA_ANTIGO);
    if (antiga) {
      categoria = await antiga.setName(NOME_CATEGORIA).catch(() => antiga);
    } else {
      categoria = await guild.channels.create({ name: NOME_CATEGORIA, type: ChannelType.GuildCategory });
    }
  }
  return categoria;
}

// Cria (1ª vez) ou reaproveita um canal de texto só pro painel, dentro da
// categoria Sonor — assim ele não fica se perdendo no meio da conversa
// geral do servidor. Limpa mensagens antigas do próprio bot ali antes de
// postar o painel de novo, pra não acumular repetido a cada /radio painel.
async function canalDoPainel(guild) {
  const categoria = await categoriaSonor(guild);
  let canal = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === NOME_CANAL_PAINEL);
  if (!canal) {
    const antigo = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === NOME_CANAL_PAINEL_ANTIGO);
    canal = antigo ? await antigo.setName(NOME_CANAL_PAINEL).catch(() => antigo) : null;
  }
  if (!canal) {
    canal = await guild.channels.create({
      name: NOME_CANAL_PAINEL,
      type: ChannelType.GuildText,
      parent: categoria.id,
      topic: '📻 Painel de rádio do Sonor — clique nos botões pra tocar, salvar, ver favoritos/histórico.',
    });
  } else if (canal.parentId !== categoria.id) {
    await canal.setParent(categoria.id, { lockPermissions: false }).catch(() => {});
  }
  try {
    const mensagens = await canal.messages.fetch({ limit: 20 });
    const doProprioBot = mensagens.filter((m) => m.author.id === guild.client.user.id);
    if (doProprioBot.size) await canal.bulkDelete(doProprioBot, true).catch(() => {});
  } catch {
    // canal novo/vazio ou mensagens velhas demais pro bulkDelete (>14 dias)
    // — sem problema, só não limpa, o painel novo vai embaixo mesmo assim.
  }
  return canal;
}

// Cache curto pra ligar as opções de um select menu (favoritos/histórico) à
// lista real de estações — o value de uma option tem limite de 100
// caracteres, curto demais pra guardar a URL do stream inteira.
const listCache = new Map(); // token -> [{name,url_resolved,country}]
function cacheLista(lista) {
  const token = crypto.randomBytes(4).toString('hex');
  listCache.set(token, lista);
  setTimeout(() => listCache.delete(token), 10 * 60 * 1000); // expira em 10min
  return token;
}

function painelRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('radio_tocar').setLabel('🔍 Tocar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('radio_aleatoria').setLabel('🎲 Aleatória').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('radio_parar').setLabel('⏹ Parar').setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('radio_salvar').setLabel('⭐ Salvar atual').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('radio_favoritos').setLabel('⭐ Favoritos').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('radio_historico').setLabel('📜 Histórico').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function painelEmbed() {
  return new EmbedBuilder()
    .setColor(COR)
    .setTitle('📻 Painel de Rádio')
    .setDescription('Toca rádio de verdade na sua call. Entra numa call e usa os botões abaixo.');
}

function embedEstacao(titulo, est) {
  return new EmbedBuilder()
    .setColor(COR)
    .setTitle(titulo)
    .setDescription(`**${est.name}**${est.country ? ` — ${est.country}` : ''}`);
}

async function tocarEComRegistro(voiceChannel, userId, est) {
  await player.play(voiceChannel, est);
  radio.registrarHistorico(userId, est).catch(() => {});
}

// Resultado de busca (/radio tocar): lista até 5, cada uma com botão de
// tocar e de salvar direto, sem precisar escolher e confirmar em 2 passos.
function resultadosEmbed(lista, termo) {
  const desc = lista
    .slice(0, 5)
    .map((e, i) => `${i + 1}. **${e.name}**${e.country ? ` — ${e.country}` : ''}`)
    .join('\n');
  return new EmbedBuilder().setColor(COR).setTitle(`🔎 Resultados pra "${termo}"`).setDescription(desc);
}

function resultadosComponents(lista) {
  const token = cacheLista(lista);
  return lista.slice(0, 5).map((est, i) =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`radio_res_play:${token}:${i}`)
        .setLabel(`▶️ ${est.name}`.slice(0, 80))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`radio_res_save:${token}:${i}`).setEmoji('⭐').setStyle(ButtonStyle.Secondary)
    )
  );
}

function selectMenuDeLista(customIdPrefix, lista, placeholder) {
  const token = cacheLista(lista);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${customIdPrefix}:${token}`)
    .setPlaceholder(placeholder)
    .addOptions(
      lista.slice(0, 25).map((est, i) => ({
        label: est.name.slice(0, 100),
        description: est.country || undefined,
        value: String(i),
      }))
    );
  return new ActionRowBuilder().addComponents(menu);
}

// Roteador central chamado pelo index.js pra qualquer interação de
// botão/modal/select que comece com "radio_" (evita index.js virar um
// arquivo gigante com toda a lógica do painel misturada).
async function handleInteraction(interaction) {
  if (interaction.isButton()) {
    const id = interaction.customId;

    if (id === 'radio_tocar') {
      const modal = new ModalBuilder().setCustomId('radio_tocar_modal').setTitle('Tocar rádio');
      const input = new TextInputBuilder()
        .setCustomId('nome')
        .setLabel('Nome da rádio')
        .setPlaceholder('Ex: Jovem Pan, BBC Radio 1...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    if (id === 'radio_aleatoria') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) { await interaction.editReply('Entra numa call primeiro, aí eu toco a rádio lá.'); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
      let est = await radio.estacaoAleatoriaFavorita(interaction.user.id).catch(() => null);
      const origem = est ? 'dos seus favoritos' : 'descoberta';
      if (!est) est = await radio.estacaoAleatoriaGlobal();
      if (!est) { await interaction.editReply('Não consegui sortear nenhuma rádio agora.'); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
      await tocarEComRegistro(voiceChannel, interaction.user.id, est);
      await interaction.editReply({ embeds: [embedEstacao(`🎲 Aleatória (${origem})`, est)] });
      agendarSumico(interaction, SOME_RAPIDO_MS);
      return true;
    }

    if (id === 'radio_salvar') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const atual = player.current(interaction.guildId);
      if (!atual) { await interaction.editReply('Não tem nenhuma rádio tocando aqui pra salvar.'); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
      await radio.salvarFavorita(interaction.user.id, atual);
      await interaction.editReply({ embeds: [embedEstacao('⭐ Salva nos favoritos', atual)] });
      agendarSumico(interaction, SOME_RAPIDO_MS);
      return true;
    }

    if (id === 'radio_favoritos') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const favs = await radio.listarFavoritas(interaction.user.id);
      if (!favs.length) { await interaction.editReply('Você ainda não salvou nenhuma rádio.'); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
      const lista = favs.map((f) => ({ name: f.station_name, url_resolved: f.station_url, country: f.country }));
      await interaction.editReply({
        content: 'Escolhe uma pra tocar:',
        components: [selectMenuDeLista('radio_sel_favorito', lista, 'Suas rádios salvas')],
      });
      agendarSumico(interaction, SOME_LISTA_MS);
      return true;
    }

    if (id === 'radio_historico') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const hist = await radio.listarHistorico(interaction.user.id);
      if (!hist.length) { await interaction.editReply('Você ainda não tocou nenhuma rádio.'); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
      const lista = hist.map((f) => ({ name: f.station_name, url_resolved: f.station_url, country: f.country }));
      await interaction.editReply({
        content: 'Escolhe uma pra tocar de novo:',
        components: [selectMenuDeLista('radio_sel_historico', lista, 'Rádios tocadas recentemente')],
      });
      agendarSumico(interaction, SOME_LISTA_MS);
      return true;
    }

    if (id === 'radio_parar') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const parou = player.stop(interaction.guildId);
      await interaction.editReply(parou ? '⏹ Parei e saí da call.' : 'Não tinha nenhuma rádio tocando aqui.');
      agendarSumico(interaction, SOME_RAPIDO_MS);
      return true;
    }

    if (id.startsWith('radio_res_play:') || id.startsWith('radio_res_save:')) {
      const [, token, idxStr] = id.split(':');
      const lista = listCache.get(token);
      const est = lista && lista[Number(idxStr)];
      const salvar = id.startsWith('radio_res_save:');

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (!est) { await interaction.editReply('Essa lista expirou, busca de novo com `/radio tocar` ou o painel.'); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }

      if (salvar) {
        await radio.salvarFavorita(interaction.user.id, est);
        await interaction.editReply({ embeds: [embedEstacao('⭐ Salva nos favoritos', est)] });
        agendarSumico(interaction, SOME_RAPIDO_MS);
        return true;
      }

      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) { await interaction.editReply('Entra numa call primeiro, aí eu toco a rádio lá.'); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
      await tocarEComRegistro(voiceChannel, interaction.user.id, est);
      await interaction.editReply({ embeds: [embedEstacao('📻 Tocando agora', est)] });
      agendarSumico(interaction, SOME_RAPIDO_MS);
      return true;
    }

    return false;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'radio_tocar_modal') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const nome = interaction.fields.getTextInputValue('nome');
    const estacoes = await radio.buscarRadios(nome);
    if (!estacoes.length) { await interaction.editReply(`Não achei nenhuma rádio com "${nome}".`); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
    await interaction.editReply({ embeds: [resultadosEmbed(estacoes, nome)], components: resultadosComponents(estacoes) });
    agendarSumico(interaction, SOME_LISTA_MS);
    return true;
  }

  if (interaction.isStringSelectMenu() && (interaction.customId.startsWith('radio_sel_favorito:') || interaction.customId.startsWith('radio_sel_historico:'))) {
    await interaction.deferUpdate();
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) { await interaction.editReply({ content: 'Entra numa call primeiro, aí eu toco a rádio lá.', components: [] }); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
    const token = interaction.customId.split(':')[1];
    const lista = listCache.get(token);
    const est = lista && lista[Number(interaction.values[0])];
    if (!est) { await interaction.editReply({ content: 'Essa lista expirou, tenta abrir o painel de novo.', components: [] }); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
    await tocarEComRegistro(voiceChannel, interaction.user.id, est);
    await interaction.editReply({ content: null, embeds: [embedEstacao('📻 Tocando agora', est)], components: [] });
    agendarSumico(interaction, SOME_RAPIDO_MS);
    return true;
  }

  return false;
}

module.exports = {
  painelRows,
  painelEmbed,
  handleInteraction,
  resultadosEmbed,
  resultadosComponents,
  canalDoPainel,
  agendarSumico,
  SOME_RAPIDO_MS,
  SOME_LISTA_MS,
};
