const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../config');
const { republicarPanelPrincipal } = require('../utils/panel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mapas')
    .setDescription('Publicar nuevamente el panel principal de mapas'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = await interaction.client.channels.fetch(config.MAPS_CHANNEL_ID);
    const message = await republicarPanelPrincipal(channel);
    return interaction.editReply(
      message
        ? `Panel principal publicado nuevamente en <#${config.MAPS_CHANNEL_ID}>.`
        : 'No se pudo publicar el panel principal.'
    );
  },
};
