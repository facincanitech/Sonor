const { SlashCommandBuilder } = require('discord.js');

// Lista de comandos, compartilhada entre o registro manual (register-commands.js)
// e o auto-registro por servidor (index.js, em ready/guildCreate).
const commands = [
  new SlashCommandBuilder()
    .setName('radio')
    .setDescription('Toca rádio de verdade na call')
    .addSubcommand((sub) =>
      sub
        .setName('tocar')
        .setDescription('Busca uma rádio pelo nome e toca na sua call')
        .addStringOption((opt) => opt.setName('nome').setDescription('Nome da rádio (ex: Jovem Pan, BBC)').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('salvar').setDescription('Salva a rádio que está tocando agora nos seus favoritos'))
    .addSubcommand((sub) => sub.setName('favoritos').setDescription('Lista suas rádios salvas'))
    .addSubcommand((sub) => sub.setName('aleatoria').setDescription('Toca uma rádio aleatória (dos seus favoritos, ou descoberta se não tiver nenhum salvo)'))
    .addSubcommand((sub) => sub.setName('parar').setDescription('Para a rádio e sai da call'))
    .toJSON(),
];

module.exports = { commands };
