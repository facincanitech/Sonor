// Uso manual/opcional (ex: registrar global de propósito, ou testar). O bot
// em si (index.js) já se autorregistra por servidor sozinho — não precisa
// rodar isso no dia a dia.
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('./commands');

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
