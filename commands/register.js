const { SlashCommandBuilder, REST, Routes } = require('discord.js');
const config = require('../config');

const commandFiles = [
  require('./mapas'),
  require('./scout'),
  require('./admin'),
  require('./revisar')
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(config.TOKEN);
  const commands = commandFiles.map(cmd => cmd.data.toJSON());

  await rest.put(
    Routes.applicationGuildCommands(config.CLIENT_ID, config.GUILD_ID),
    { body: commands }
  );

  console.log("Slash commands registrados.");
}

function getCommandsMap() {
  const map = new Map();
  commandFiles.forEach(cmd => {
    map.set(cmd.data.name, cmd);
  });
  return map;
}

module.exports = { registerCommands, getCommandsMap };
