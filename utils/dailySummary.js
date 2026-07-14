const { EmbedBuilder } = require('discord.js');
const state = require('../data/state');
const config = require('../config');
const { guardarRevisionPanel } = require('../data/persistence');
const { getRevisionMultiplier } = require('./revisionRounds');

function normalizeIdentity(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function multiplierForSummaryName(name, existing = 1) {
  const normalized = normalizeIdentity(name);
  for (const [userId, score] of Object.entries(state.revisionScores || {})) {
    const identities = new Set([score?.username, ...(score?.aliases || [])]);
    for (const entry of [...(state.historialScouts || []), ...(state.historialDia || [])]) {
      if (String(entry?.userId) === String(userId)) identities.add(entry?.username);
    }
    for (const entry of state.scoutsActivos?.[userId] || []) identities.add(entry?.username);
    if ([...identities].some(identity => normalizeIdentity(identity) === normalized)) {
      return getRevisionMultiplier(userId);
    }
  }
  return Math.max(0.70, Math.min(1, Number(existing) || 1));
}

function repairSummaryDescription(description) {
  let changed = false;
  const lines = String(description || '').split('\n').map(line => {
    const timeMatch = /(?:(\d{1,3})\s*h)?\s*(\d{1,2})\s*m\b/i.exec(line);
    const mapsMatch = /(\d{1,3})\s*(mapas?|maps?)\b/i.exec(line);
    if (!timeMatch || !mapsMatch) return line;

    const nameMatch = /\*\*([^*]+)\*\*\s*[—-]/.exec(line.slice(0, timeMatch.index));
    if (!nameMatch) return line;

    const existingMultiplier = /x(0(?:[.,]\d+)?|1(?:[.,]0+)?)\b/i.exec(line);
    const multiplier = multiplierForSummaryName(
      nameMatch[1],
      existingMultiplier ? Number(existingMultiplier[1].replace(',', '.')) : 1
    );
    const prefix = line.slice(0, timeMatch.index)
      .replace(/(?:\*\*)?\d+(?:[.,]\d+)?\s+pts?(?:\*\*)?\s*[·•]?\s*/i, '')
      .replace(/\s*[·•]\s*$/, ' ')
      .trimEnd();
    const tail = line.slice(mapsMatch.index + mapsMatch[0].length)
      .replace(/\s*[·•]\s*x(?:0(?:[.,]\d+)?|1(?:[.,]0+)?)\s*/i, ' ')
      .replace(/^\s*[·•]\s*/, '')
      .trim();
    const timeText = timeMatch[0].trim().replace(/\s+/g, ' ');
    const mapsText = mapsMatch[0].trim().replace(/\s+/g, ' ');
    const repaired = `${prefix}${prefix.endsWith(' ') ? '' : ' '}${timeText} · x${multiplier.toFixed(2)} · ${mapsText}${tail ? ` · ${tail}` : ''}`;
    if (repaired !== line) changed = true;
    return repaired;
  });
  return { description: lines.join('\n'), changed };
}

async function regenerateSummaryMessage(messageId) {
  if ((state.completedSummaryRegenerations || []).includes(String(messageId))) {
    throw new Error('Ese resumen ya fue regenerado anteriormente.');
  }
  if (!state.client || !config.ARCHIVE_CHANNEL_ID) throw new Error('El canal de archivo no está disponible.');
  const channel = await state.client.channels.fetch(config.ARCHIVE_CHANNEL_ID);
  const oldMessage = await channel.messages.fetch(String(messageId));
  const oldEmbed = oldMessage.embeds?.[0];
  if (!oldEmbed?.description || !/Resumen del D/i.test(oldEmbed.title || '')) {
    throw new Error('El mensaje no contiene un Resumen del Día válido.');
  }

  const repaired = repairSummaryDescription(oldEmbed.description);
  const replacement = await channel.send({
    embeds: [EmbedBuilder.from(oldEmbed).setDescription(repaired.description)],
    allowedMentions: { parse: [] },
  });

  let deleted = true;
  try {
    await oldMessage.delete();
  } catch (err) {
    deleted = false;
  }

  state.lastArchivedSummaryMessageId = replacement.id;
  state.lastArchivedSummaryChannelId = channel.id;
  state.completedSummaryRegenerations = [
    ...new Set([...(state.completedSummaryRegenerations || []), String(messageId)]),
  ].slice(-50);
  guardarRevisionPanel();
  return { replacement, deleted, changed: repaired.changed };
}

module.exports = {
  normalizeIdentity,
  multiplierForSummaryName,
  repairSummaryDescription,
  regenerateSummaryMessage,
};
