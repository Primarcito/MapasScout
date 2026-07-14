const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { canUseAdmin, canManageSensitiveScoutData } = require('../permissions');
const { adminPanel } = require('../components/adminComponents');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mapas-gestionar')
    .setDescription('Abrir la administración de MapasBot según tu jerarquía'),

  async execute(interaction) {
    if (!canUseAdmin(interaction.member)) {
      return interaction.reply({ content: 'No tienes permiso para operar MapasBot.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      ...adminPanel({ sensitive: canManageSensitiveScoutData(interaction.member) }),
      flags: MessageFlags.Ephemeral,
    });
  },
};
