const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder } = require('discord.js');
const state = require('../data/state');
const { getRevisionMultiplier } = require('./revisionRounds');

function userPicker(customId, placeholder) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
  );
}

async function resolveScoutName(interaction, userId) {
  const cached = interaction.guild?.members?.cache?.get(userId);
  if (cached) return cached.displayName || cached.user.globalName || cached.user.username;
  try {
    const member = await interaction.guild.members.fetch(userId);
    return member.displayName || member.user.globalName || member.user.username;
  } catch (err) {
    try {
      const user = await interaction.client.users.fetch(userId);
      return user.globalName || user.username;
    } catch (fetchErr) {
      return userId;
    }
  }
}

function allKnownScoutIds() {
  const ids = new Set(Object.keys(state.revisionScores || {}));
  for (const maps of Object.values(state.registros || {})) {
    for (const users of Object.values(maps || {})) for (const id of users) ids.add(id);
  }
  for (const id of Object.keys(state.scoutsActivos || {})) ids.add(id);
  for (const entry of state.historialDia || []) if (entry.userId) ids.add(entry.userId);
  return [...ids];
}

async function multipliersPanel(interaction) {
  const all = await Promise.all(allKnownScoutIds().map(async id => {
    const username = await resolveScoutName(interaction, id);
    const score = state.revisionScores[id] || {};
    score.username = username;
    state.revisionScores[id] = score;
    return { id, username, score, multiplier: getRevisionMultiplier(id) };
  }));
  const penalized = all
    .filter(item => item.multiplier < 1)
    .sort((a, b) => a.username.localeCompare(b.username, 'es', { sensitivity: 'base' }));
  const description = penalized.length
    ? penalized.map(item => `• **${item.username}** · **x${item.multiplier.toFixed(2)}** · ${item.score.misses || 0} fallos`).join('\n').slice(0, 3900)
    : 'No hay scouts penalizados. Todos están en **x1.00**.';
  return {
    embeds: [new EmbedBuilder().setTitle('Multiplicadores de scouts').setColor(0x1f9d8a).setDescription(description)],
    components: [
      userPicker('select_revision_multiplier', 'Elige un scout para ajustar'),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('revision_regenerate_summary').setLabel('Regenerar resumen').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('admin_home').setLabel('Volver').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

module.exports = { userPicker, resolveScoutName, allKnownScoutIds, multipliersPanel };
