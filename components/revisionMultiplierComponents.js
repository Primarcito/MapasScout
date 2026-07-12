const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const state = require('../data/state');
const { getRevisionMultiplier } = require('../utils/revisionRounds');

function modoMultiplier(userId) {
  return Number.isFinite(Number(state.revisionScores[userId]?.manualMultiplier)) ? 'manual' : 'automático';
}

function payloadAjusteMultiplier(userId) {
  const score = state.revisionScores[userId] || {};
  const multiplier = getRevisionMultiplier(userId);
  const embed = new EmbedBuilder()
    .setTitle('Ajustar multiplicador')
    .setColor(multiplier < 1 ? 0xf1c40f : 0x57f287)
    .setDescription(
      `Scout: <@${userId}>\n` +
      `Multiplicador actual: **x${multiplier.toFixed(2)}**\n` +
      `Modo: **${modoMultiplier(userId)}**\n` +
      `Fallos registrados: **${score.misses || 0}**`
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`revision_mult_down_${userId}`)
      .setLabel('−0.05')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`revision_mult_up_${userId}`)
      .setLabel('+0.05')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`revision_mult_exact_${userId}`)
      .setLabel('Valor exacto')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`revision_mult_auto_${userId}`)
      .setLabel('Automático')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`revision_mult_full_${userId}`)
      .setLabel('Restaurar x1.00')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [buttons] };
}

module.exports = { payloadAjusteMultiplier, modoMultiplier };
