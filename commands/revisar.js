const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { canReview } = require('../permissions');
const { crearPanelRevisionMovil } = require('../utils/panel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('revisar')
    .setDescription('Mover el panel secundario de revisión a este canal'),

  async execute(interaction) {
    if (!canReview(interaction.member)) {
      return interaction.reply({
        content: 'Necesitas el rol Scout para usar este comando.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await crearPanelRevisionMovil(interaction.channel);
    return interaction.editReply('Panel móvil de revisión actualizado en este canal.');
  },
};
