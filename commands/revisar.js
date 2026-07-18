const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { canReview } = require('../permissions');
const { crearPanelRevisionMovil } = require('../utils/panel');
const { beginRevisionRound, revisionConfig } = require('../utils/revisionRounds');

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
    const { created } = await beginRevisionRound(Date.now(), { announce: false });
    await crearPanelRevisionMovil(interaction.channel, { mentionRole: true, created });
    return interaction.editReply(created
      ? `Ronda de ${revisionConfig().roundMinutes} minutos iniciada y panel de revisión publicado en este canal.`
      : 'Panel de revisión publicado nuevamente y la ronda actual continúa.');
  },
};
