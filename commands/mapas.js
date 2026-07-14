const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const state = require('../data/state');
const { canManageMaps } = require('../permissions');
const { guardarPanel } = require('../data/persistence');
const { generarEmbeds } = require('../embeds/panelEmbed');
const { componentesPanel } = require('../components/panelComponents');
const { mapConfigPanel } = require('../components/mapConfigComponents');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mapas')
    .setDescription('Panel y configuración de mapas')
    .addSubcommand(subcommand => subcommand
      .setName('panel')
      .setDescription('Publicar nuevamente el panel principal de mapas'))
    .addSubcommand(subcommand => subcommand
      .setName('configurar')
      .setDescription('Abrir el panel de configuración de mapas')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'panel') {
      const response = await interaction.reply({
        embeds: generarEmbeds(),
        components: componentesPanel(),
        withResponse: true,
      });
      state.panelMessage = response.resource.message;
      state.panelChannelId = state.panelMessage.channel.id;
      state.panelMessageId = state.panelMessage.id;
      guardarPanel();
      return;
    }

    if (!canManageMaps(interaction.member)) {
      return interaction.reply({ content: 'No tienes permiso para configurar mapas.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...mapConfigPanel(), flags: MessageFlags.Ephemeral });
  },
};
