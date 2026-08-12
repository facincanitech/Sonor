require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

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

async function main() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !clientId) {
    console.error('Faltam DISCORD_TOKEN / DISCORD_CLIENT_ID no .env');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  await rest.put(route, { body: commands });
  console.log(
    guildId
      ? `Comandos registrados no servidor ${guildId} (aparecem na hora).`
      : 'Comandos registrados globalmente (pode levar até 1h pra aparecer).'
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
