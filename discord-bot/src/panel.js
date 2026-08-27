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
const youtube = require('./youtube');

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
// do bot dentro dela em vez de espalhados na raiz do servidor. Permissão
// pra @everyone: só ver + ver histórico, sem escrever — o canal é só
// painel de botão, não precisa ninguém digitando ali. Comando de slash e
// clique em botão continuam funcionando (não dependem de SendMessages).
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
  await categoria.permissionOverwrites
    .edit(guild.roles.everyone, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false })
    .catch(() => {});
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
      new ButtonBuilder().setCustomId('radio_youtube').setLabel('🎵 YouTube').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('radio_parar').setLabel('⏹ Parar').setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('radio_salvar').setLabel('⭐ Salvar atual').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('radio_favoritos').setLabel('⭐ Favoritos').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('radio_historico').setLabel('📜 Histórico').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('youtube_favoritos').setLabel('⭐ Favoritos YT').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function painelEmbed() {
  return new EmbedBuilder()
    .setColor(COR)
    .setTitle('📻 Painel de Rádio')
    .setDescription('Toca rádio de verdade na sua call. Entra numa call e usa os botões abaixo.');
}

// Referência da mensagem fixa do painel por servidor (canal+id) — pra dar
// editReply nela sempre que a rádio/vídeo tocando mudar, sem precisar que
// ninguém clique em nada. Vive só em memória: some se o bot reiniciar, mas
// aí é só rodar /radio painel de novo (ele já limpa a mensagem antiga).
const painelMsgRef = new Map(); // guildId -> { channelId, messageId, client }
function registrarPainel(guildId, message) {
  painelMsgRef.set(guildId, { channelId: message.channelId, messageId: message.id, client: message.client });
}

// Nome da música tocando agora (ICY StreamTitle) — mesma fonte que o app
// SonorHub usa. guildId -> último título conhecido, pra só re-editar o
// painel quando o nome realmente mudar (evita ficar redesenhando à toa).
const icyTituloPorGuild = new Map();
// Chamado por quem faz o bot começar a tocar uma estação nova, pra não
// ficar mostrando a música da rádio anterior até o próximo ciclo de 20s.
function limparIcyCache(guildId) {
  icyTituloPorGuild.delete(guildId);
}
const ICY_CHECK_INTERVAL_MS = 20_000;
setInterval(async () => {
  for (const [guildId, ref] of painelMsgRef) {
    if (player.currentFonte(guildId) !== 'radio') continue;
    const atual = player.current(guildId);
    const streamUrl = atual && (atual.url_resolved || atual.url);
    if (!streamUrl) continue;
    const novoTitulo = await radio.buscarMusicaAtualIcy(streamUrl);
    if (novoTitulo !== (icyTituloPorGuild.get(guildId) || null)) {
      icyTituloPorGuild.set(guildId, novoTitulo);
      atualizarPainelAoVivo(guildId, ref.client).catch(() => {});
    }
  }
}, ICY_CHECK_INTERVAL_MS);

// Embed "tocando agora" — mesma ideia da tela do player no app (capa +
// nome), só que dentro do próprio painel fixo em vez de tela separada.
function nowPlayingEmbed(guildId) {
  const atual = player.current(guildId);
  if (!atual) {
    icyTituloPorGuild.delete(guildId);
    return painelEmbed();
  }
  const fonte = player.currentFonte(guildId);
  const embed = new EmbedBuilder().setColor(COR);
  if (fonte === 'youtube') {
    embed.setTitle('▶️ Tocando agora (YouTube)').setDescription(`**${atual.name}**${atual.uploader ? ` — ${atual.uploader}` : ''}`);
  } else {
    const icyTitulo = icyTituloPorGuild.get(guildId);
    embed.setTitle('▶️ Tocando agora').setDescription(
      `**${atual.name}**${atual.country ? ` — ${atual.country}` : ''}` + (icyTitulo ? `\n🎵 ${icyTitulo}` : '')
    );
    if (atual.favicon) embed.setThumbnail(atual.favicon);
  }
  return embed;
}

// Chamado depois de qualquer play/stop pra refletir no painel fixo, se
// existir um postado nesse servidor. Silencioso de propósito (falha aqui
// não deve quebrar o fluxo de tocar/parar em si — o painel é um bônus).
async function atualizarPainelAoVivo(guildId, client) {
  const ref = painelMsgRef.get(guildId);
  if (!ref) return;
  try {
    const canal = await client.channels.fetch(ref.channelId);
    const msg = await canal.messages.fetch(ref.messageId);
    await msg.edit({ embeds: [nowPlayingEmbed(guildId)], components: painelRows() });
  } catch {
    painelMsgRef.delete(guildId); // mensagem/canal sumiu, para de tentar
  }
}

function embedEstacao(titulo, est) {
  return new EmbedBuilder()
    .setColor(COR)
    .setTitle(titulo)
    .setDescription(`**${est.name}**${est.country ? ` — ${est.country}` : ''}`);
}

// Se o bot já tá noutro canal de voz DESSE servidor, recusa em vez de pular
// pra lá — só uma sessão de voz por servidor (limitação do Discord), então
// trocar de canal no meio interromperia quem já tava ouvindo.
function mensagemCanalOcupado(guildId, voiceChannelId) {
  const ocupado = player.activeChannelId(guildId);
  if (!ocupado || ocupado === voiceChannelId) return null;
  return `🔒 Já tô tocando no canal <#${ocupado}> agora. Espera terminar ou peça pra alguém lá rodar \`/radio parar\`.`;
}

async function tocarEComRegistro(guildId, voiceChannel, userId, est) {
  const ocupadoMsg = mensagemCanalOcupado(guildId, voiceChannel.id);
  if (ocupadoMsg) return ocupadoMsg;
  await player.play(voiceChannel, est);
  radio.registrarHistorico(userId, est).catch(() => {});
  // Troca de estação — limpa o título ICY da rádio anterior na hora, senão
  // ficava mostrando a música da rádio de antes até o próximo ciclo de
  // checagem (até 20s depois), mesmo já tocando outra estação.
  limparIcyCache(guildId);
  atualizarPainelAoVivo(guildId, voiceChannel.client).catch(() => {});
  return null;
}

// Resultado de busca (/radio tocar): pode vir bem mais que 5 agora (nome +
// país juntos, até 200) — pagina de 10 em 10 com menu suspenso + botões de
// anterior/próxima, em vez do formato antigo (1 botão de tocar+salvar por
// linha, que só cabia 5 por causa do teto de 5 linhas de componente do
// Discord). O cache guarda a lista inteira e o termo buscado; cada página
// só recorta o pedaço que mostra.
const RESULTADOS_POR_PAGINA = 10;
const pesquisaCache = new Map(); // token -> { lista, termo }
function cachePesquisa(lista, termo) {
  const token = crypto.randomBytes(4).toString('hex');
  pesquisaCache.set(token, { lista, termo });
  setTimeout(() => pesquisaCache.delete(token), 10 * 60 * 1000);
  return token;
}

function resultadosEmbed(lista, termo, pagina = 0) {
  const totalPaginas = Math.max(1, Math.ceil(lista.length / RESULTADOS_POR_PAGINA));
  return new EmbedBuilder()
    .setColor(COR)
    .setTitle(`🔎 Resultados pra "${termo}"`)
    .setDescription(`${lista.length} rádio${lista.length === 1 ? '' : 's'} encontrada${lista.length === 1 ? '' : 's'} — página ${pagina + 1} de ${totalPaginas}`);
}

function resultadosComponents(token, lista, pagina = 0) {
  const totalPaginas = Math.max(1, Math.ceil(lista.length / RESULTADOS_POR_PAGINA));
  const inicio = pagina * RESULTADOS_POR_PAGINA;
  const pageItems = lista.slice(inicio, inicio + RESULTADOS_POR_PAGINA);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`radio_res_sel:${token}:${pagina}`)
    .setPlaceholder('Escolhe uma pra tocar')
    .addOptions(pageItems.map((est, i) => ({
      label: est.name.slice(0, 100),
      description: est.country || undefined,
      value: String(inicio + i),
    })));
  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`radio_res_page:${token}:${pagina - 1}`).setLabel('◀ Anterior').setStyle(ButtonStyle.Secondary).setDisabled(pagina <= 0),
    new ButtonBuilder().setCustomId(`radio_res_page:${token}:${pagina + 1}`).setLabel('Próxima ▶').setStyle(ButtonStyle.Secondary).setDisabled(pagina >= totalPaginas - 1)
  );
  return [new ActionRowBuilder().addComponents(menu), nav];
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

    if (id === 'radio_youtube') {
      const modal = new ModalBuilder().setCustomId('radio_youtube_modal').setTitle('Tocar do YouTube');
      const input = new TextInputBuilder()
        .setCustomId('busca')
        .setLabel('Nome da música/vídeo ou link')
        .setPlaceholder('Ex: nome da música, ou um link do YouTube...')
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
      const est = await radio.estacaoAleatoriaGlobal();
      const origem = 'descoberta';
      if (!est) { await interaction.editReply('Não consegui sortear nenhuma rádio agora.'); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
      const erroOcupado1 = await tocarEComRegistro(interaction.guildId, voiceChannel, interaction.user.id, est);
      if (erroOcupado1) { await interaction.editReply(erroOcupado1); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
      await interaction.editReply({ embeds: [embedEstacao(`🎲 Aleatória (${origem})`, est)] });
      agendarSumico(interaction, SOME_RAPIDO_MS);
      return true;
    }

    if (id === 'radio_salvar') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const atual = player.current(interaction.guildId);
      if (!atual) { await interaction.editReply('Não tem nada tocando aqui pra salvar.'); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
      if (player.currentFonte(interaction.guildId) === 'youtube') {
        await youtube.salvarFavorita(interaction.user.id, atual);
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(COR).setTitle('⭐ Salvo nos favoritos do YouTube').setDescription(`**${atual.name}**${atual.uploader ? ` — ${atual.uploader}` : ''}`)],
        });
      } else {
        await radio.salvarFavorita(interaction.user.id, atual);
        await interaction.editReply({ embeds: [embedEstacao('⭐ Salva nos favoritos', atual)] });
      }
      agendarSumico(interaction, SOME_RAPIDO_MS);
      return true;
    }

    if (id === 'youtube_favoritos') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const favs = await youtube.listarFavoritas(interaction.user.id);
      if (!favs.length) { await interaction.editReply('Você ainda não salvou nenhum vídeo do YouTube.'); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
      const token = cacheLista(favs);
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`youtube_sel_favorito:${token}`)
        .setPlaceholder('Seus vídeos salvos')
        .addOptions(favs.slice(0, 25).map((f, i) => ({ label: f.name.slice(0, 100), description: f.uploader || undefined, value: String(i) })));
      await interaction.editReply({ content: 'Escolhe um pra tocar:', components: [new ActionRowBuilder().addComponents(menu)] });
      agendarSumico(interaction, SOME_LISTA_MS);
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
      if (parou) atualizarPainelAoVivo(interaction.guildId, interaction.client).catch(() => {});
      await interaction.editReply(parou ? '⏹ Parei e saí da call.' : 'Não tinha nenhuma rádio tocando aqui.');
      agendarSumico(interaction, SOME_RAPIDO_MS);
      return true;
    }

    if (id.startsWith('radio_res_page:')) {
      const [, token, paginaStr] = id.split(':');
      const cache = pesquisaCache.get(token);
      if (!cache) { await interaction.reply({ content: 'Essa busca expirou, tenta de novo com `/radio tocar` ou o painel.', flags: MessageFlags.Ephemeral }); return true; }
      const pagina = Number(paginaStr);
      await interaction.update({
        embeds: [resultadosEmbed(cache.lista, cache.termo, pagina)],
        components: resultadosComponents(token, cache.lista, pagina),
      });
      return true;
    }

    return false;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'radio_tocar_modal') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const nome = interaction.fields.getTextInputValue('nome');
    const estacoes = await radio.buscarRadios(nome);
    if (!estacoes.length) { await interaction.editReply(`Não achei nenhuma rádio com "${nome}".`); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
    const token = cachePesquisa(estacoes, nome);
    await interaction.editReply({ embeds: [resultadosEmbed(estacoes, nome, 0)], components: resultadosComponents(token, estacoes, 0) });
    agendarSumico(interaction, SOME_LISTA_MS);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'radio_youtube_modal') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) { await interaction.editReply('Entra numa call primeiro, aí eu toco lá.'); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
    const ocupadoMsg = mensagemCanalOcupado(interaction.guildId, voiceChannel.id);
    if (ocupadoMsg) { await interaction.editReply(ocupadoMsg); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
    const busca = interaction.fields.getTextInputValue('busca');
    try {
      const item = await youtube.buscar(busca);
      await player.playFromProcess(voiceChannel, item, () => youtube.spawnAudioStream(item.url));
      atualizarPainelAoVivo(interaction.guildId, interaction.client).catch(() => {});
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(COR).setTitle('▶️ Tocando agora (YouTube)').setDescription(`**${item.name}**${item.uploader ? ` — ${item.uploader}` : ''}`)],
      });
    } catch (err) {
      await interaction.editReply(`Deu ruim: ${err.message}`);
    }
    agendarSumico(interaction, SOME_RAPIDO_MS);
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('radio_res_sel:')) {
    await interaction.deferUpdate();
    const token = interaction.customId.split(':')[1];
    const cache = pesquisaCache.get(token);
    const est = cache && cache.lista[Number(interaction.values[0])];
    if (!est) { await interaction.editReply({ content: 'Essa busca expirou, tenta de novo com `/radio tocar` ou o painel.', embeds: [], components: [] }); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) { await interaction.editReply({ content: 'Entra numa call primeiro, aí eu toco a rádio lá.', embeds: [], components: [] }); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
    const erroOcupado4 = await tocarEComRegistro(interaction.guildId, voiceChannel, interaction.user.id, est);
    if (erroOcupado4) { await interaction.editReply({ content: erroOcupado4, embeds: [], components: [] }); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
    await interaction.editReply({ content: null, embeds: [embedEstacao('📻 Tocando agora', est)], components: [] });
    agendarSumico(interaction, SOME_RAPIDO_MS);
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
    const erroOcupado3 = await tocarEComRegistro(interaction.guildId, voiceChannel, interaction.user.id, est);
    if (erroOcupado3) { await interaction.editReply({ content: erroOcupado3, components: [] }); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
    await interaction.editReply({ content: null, embeds: [embedEstacao('📻 Tocando agora', est)], components: [] });
    agendarSumico(interaction, SOME_RAPIDO_MS);
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('youtube_sel_favorito:')) {
    await interaction.deferUpdate();
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) { await interaction.editReply({ content: 'Entra numa call primeiro, aí eu toco lá.', components: [] }); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
    const token = interaction.customId.split(':')[1];
    const lista = listCache.get(token);
    const item = lista && lista[Number(interaction.values[0])];
    if (!item) { await interaction.editReply({ content: 'Essa lista expirou, tenta abrir o painel de novo.', components: [] }); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
    const ocupadoMsg = mensagemCanalOcupado(interaction.guildId, voiceChannel.id);
    if (ocupadoMsg) { await interaction.editReply({ content: ocupadoMsg, components: [] }); agendarSumico(interaction, SOME_RAPIDO_MS); return true; }
    try {
      await player.playFromProcess(voiceChannel, item, () => youtube.spawnAudioStream(item.url));
      atualizarPainelAoVivo(interaction.guildId, interaction.client).catch(() => {});
      await interaction.editReply({
        content: null,
        embeds: [new EmbedBuilder().setColor(COR).setTitle('▶️ Tocando agora (YouTube)').setDescription(`**${item.name}**${item.uploader ? ` — ${item.uploader}` : ''}`)],
        components: [],
      });
    } catch (err) {
      await interaction.editReply({ content: `Deu ruim: ${err.message}`, components: [] });
    }
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
  cachePesquisa,
  canalDoPainel,
  agendarSumico,
  mensagemCanalOcupado,
  registrarPainel,
  atualizarPainelAoVivo,
  nowPlayingEmbed,
  limparIcyCache,
  SOME_RAPIDO_MS,
  SOME_LISTA_MS,
};
