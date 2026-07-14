const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { canUseAdmin, canManageSensitiveScoutData } = require('../permissions');
const { adminPanel } = require('../components/adminComponents');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Administración de MapasBot')
    .addSubcommand(subcommand => subcommand
      .setName('panel')
      .setDescription('Abrir el panel administrativo según tu jerarquía')),

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
