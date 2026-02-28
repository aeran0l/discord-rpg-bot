// systems/autoRegisterCommands.js
const { REST, Routes, Events } = require('discord.js');
const config = require('../config.json');
const commands = require('../commands/commandsData');

function makeRest() {
  return new REST({ version: '10' }).setToken(config.token);
}

async function registerToGuild(guildId) {
  const rest = makeRest();
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, guildId),
    { body: commands }
  );
  console.log(`[commands] registered to guild: ${guildId}`);
}

module.exports = (client) => {

  client.on(Events.ClientReady, async () => {
    console.log('[commands] registering to all guilds...');
    for (const guild of client.guilds.cache.values()) {
      try {
        await registerToGuild(guild.id);
      } catch (e) {
        console.warn('[commands] register fail:', guild.id, e?.message ?? e);
      }
    }
    console.log('[commands] done');
  });

  client.on('guildCreate', async (guild) => {
    try {
      await registerToGuild(guild.id);
    } catch (e) {
      console.warn('[commands] guildCreate register fail:', guild.id, e?.message ?? e);
    }
  });
};