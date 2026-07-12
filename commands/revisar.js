const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { canReview } = require('../permissions');
const { crearPanelRevisionMovil } = require('../utils/panel');
const { beginRevisionRound } = require('../utils/revisionRounds');

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
    const { created } = await beginRevisionRound();
    await crearPanelRevisionMovil(interaction.channel);
    return interaction.editReply(created
      ? 'Ronda de 20 minutos iniciada y panel de revisión publicado en este canal.'
      : 'Panel de revisión actualizado en este canal; la ronda actual continúa.');
  },
};
