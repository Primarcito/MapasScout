const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { canManageMaps } = require('../permissions');
const { mapConfigPanel } = require('../components/mapConfigComponents');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mapas-configurar')
    .setDescription('Cargar, editar o programar la configuración de mapas'),

  async execute(interaction) {
    if (!canManageMaps(interaction.member)) {
      return interaction.reply({ content: 'No tienes permiso para configurar mapas.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...mapConfigPanel(), flags: MessageFlags.Ephemeral });
  },
};
