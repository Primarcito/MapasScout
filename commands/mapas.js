const { SlashCommandBuilder } = require('discord.js');
const state = require('../data/state');
const { guardarPanel } = require('../data/persistence');
const { generarEmbeds } = require('../embeds/panelEmbed');
const { componentesPanel } = require('../components/panelComponents');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mapas')
    .setDescription('Publicar nuevamente el panel principal de mapas'),

  async execute(interaction) {
    const response = await interaction.reply({
      embeds: generarEmbeds(),
      components: componentesPanel(),
      withResponse: true,
    });
    state.panelMessage = response.resource.message;
    state.panelChannelId = state.panelMessage.channel.id;
    state.panelMessageId = state.panelMessage.id;
    guardarPanel();
  },
};
