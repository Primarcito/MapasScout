const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const state = require('../data/state');
const settings = require('../settings');
const { guardarDatos, guardarScouts } = require('../data/persistence');
const { guardarUltimosMapas, cerrarScoutsActivos, borrarRegistrosUsuario } = require('./scouts');
const { actualizarPanel } = require('./panel');
const { verificarMapaVacio } = require('./alerts');
const { sendScoutLog, formatMaps, formatUser } = require('./scoutLogs');

let intervalId = null;

function numberOrDefault(value, fallback, min = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

function getVerificationConfig() {
  const raw = settings.verification || {};
  return {
    enabled: raw.enabled !== false,
    maxActiveMinutes: numberOrDefault(raw.maxActiveMinutes, 240, 15),
    graceMinutes: numberOrDefault(raw.graceMinutes, 10, 1),
    checkIntervalMinutes: numberOrDefault(raw.checkIntervalMinutes, 5, 1),
  };
}

function formatMinutes(totalMin) {
  const horas = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (horas <= 0) return `${mins}m`;
  return `${horas}h ${mins}m`;
}

function getActiveEntries(userId) {
  return (state.scoutsActivos[userId] || []).filter(entry => entry && entry.inicio);
}

function getOldestStart(entries) {
  return entries.reduce((oldest, entry) => Math.min(oldest, entry.inicio), Date.now());
}

function getRegisteredMaps(userId) {
  const maps = [];
  for (const ciudad in state.registros) {
    for (const mapa in state.registros[ciudad]) {
      if (state.registros[ciudad][mapa].includes(userId)) {
        maps.push({ ciudad, mapa });
      }
    }
  }
  return maps;
}

function getAffectedMaps(userId) {
  const seen = new Set();
  const maps = [];
  const add = ({ ciudad, mapa }) => {
    const key = `${ciudad}__${mapa}`;
    if (seen.has(key)) return;
    seen.add(key);
    maps.push({ ciudad, mapa });
  };

  getRegisteredMaps(userId).forEach(add);
  getActiveEntries(userId).forEach(add);
  return maps;
}

function mapsSummary(entries) {
  return formatMaps(entries);
}

function getScoutUsername(userId, fallback = null) {
  const entries = getActiveEntries(userId);
  return fallback || entries[0]?.username || userId;
}

function verificationButtons(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`verificacion_confirmar_${userId}`)
        .setLabel('Sigo activo')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`verificacion_salir_${userId}`)
        .setLabel('Salir de mapas')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

async function getUserDmChannel(userId) {
  if (!state.client || !userId) return null;

  try {
    const user = await state.client.users.fetch(userId);
    return await user.createDM();
  } catch (err) {
    return null;
  }
}

async function editVerificationMessage(pending, content, components = []) {
  if (!pending || !state.client) return;

  try {
    const channel = await state.client.channels.fetch(pending.channelId);
    const message = await channel?.messages.fetch(pending.messageId);
    await message?.edit({ content, components });
  } catch (err) {
    // El MD o mensaje pudo haber sido borrado.
  }
}

async function requestVerification(userId, entries, now, cfg, options = {}) {
  if (state.verificacionesScout[userId]) {
    return { ok: false, reason: 'pending' };
  }

  const channel = await getUserDmChannel(userId);
  if (!channel) {
    console.warn(`No se pudo solicitar verificacion para ${userId}: MD no disponible.`);
    return { ok: false, reason: 'dm_unavailable' };
  }

  const oldestStart = getOldestStart(entries);
  const activeMinutes = Math.floor((now - oldestStart) / 60000);
  const expiresAt = now + cfg.graceMinutes * 60000;

  try {
    const msg = await channel.send({
      content:
        `<@${userId}> verificacion de scout: llevas **${formatMinutes(activeMinutes)}** activo en ${mapsSummary(entries)}.\n` +
        `Pulsa **Sigo activo** en **${cfg.graceMinutes}m** para seguir o **Salir de mapas** para retirarte.`,
      components: verificationButtons(userId),
      allowedMentions: { users: [userId] }
    });

    state.verificacionesScout[userId] = {
      status: 'waiting_response',
      messageId: msg.id,
      channelId: msg.channel.id,
      isDm: true,
      createdAt: now,
      expiresAt,
    };

    await sendScoutLog('VERIFICACION_ENVIADA', [
      `Scout: ${formatUser(userId, getScoutUsername(userId))}`,
      `Mapas: ${formatMaps(entries)}`,
      `Tiempo activo: ${formatMinutes(activeMinutes)}`,
      `Origen: ${options.requestedBy ? `manual por <@${options.requestedBy}>` : 'automatico'}`
    ]);

    return { ok: true, message: msg };
  } catch (err) {
    console.error('Error enviando verificacion de scout:', err);
    return { ok: false, reason: 'send_failed' };
  }
}

async function forceScoutVerification(userId, requestedBy = null) {
  const entries = getActiveEntries(userId);
  if (entries.length === 0) {
    return { ok: false, reason: 'inactive' };
  }

  const cfg = getVerificationConfig();
  return requestVerification(userId, entries, Date.now(), cfg, { requestedBy });
}

async function closeScoutByVerification(userId, motivo, finOverride, options = {}) {
  const entries = getActiveEntries(userId);
  const pending = state.verificacionesScout[userId];
  const affectedMaps = getAffectedMaps(userId);
  const username = getScoutUsername(userId);

  guardarUltimosMapas(userId);
  cerrarScoutsActivos(userId, username, motivo, finOverride);
  borrarRegistrosUsuario(userId);
  delete state.verificacionesScout[userId];

  guardarDatos();
  guardarScouts();
  await actualizarPanel();

  for (const { ciudad, mapa } of affectedMaps) {
    await verificarMapaVacio(ciudad, mapa);
  }

  await sendScoutLog('RETIRADO', [
    `Scout: ${formatUser(userId, username)}`,
    `Mapas: ${formatMaps(affectedMaps)}`,
    `Motivo: ${motivo}`
  ]);

  if (!options.skipMessageEdit && pending) {
    const content = options.content || `<@${userId}> fuiste retirado de mapas por no completar la verificacion.`;
    await editVerificationMessage(pending, content);
  }
}

async function reviewActiveScouts() {
  const cfg = getVerificationConfig();
  if (!cfg.enabled) return;

  const now = Date.now();
  const maxMs = cfg.maxActiveMinutes * 60000;

  for (const userId of Object.keys(state.verificacionesScout)) {
    const entries = getActiveEntries(userId);
    const pending = state.verificacionesScout[userId];

    if (entries.length === 0) {
      await cancelScoutVerification(userId, 'Verificacion cancelada: ya no tienes mapas activos.');
      continue;
    }

    if (pending.expiresAt <= now) {
      await closeScoutByVerification(userId, 'verificacion_expirada', pending.expiresAt, {
        content: `<@${userId}> fuiste retirado de mapas por no responder la verificacion a tiempo.`
      });
    }
  }

  for (const userId of Object.keys(state.scoutsActivos)) {
    const entries = getActiveEntries(userId);
    if (entries.length === 0 || state.verificacionesScout[userId]) continue;

    const oldestStart = getOldestStart(entries);

    if (oldestStart + maxMs <= now) {
      await requestVerification(userId, entries, now, cfg);
    }
  }
}

function startScoutVerification() {
  const cfg = getVerificationConfig();
  if (!cfg.enabled) {
    console.log('Verificacion de scouts desactivada.');
    return;
  }

  if (intervalId) clearInterval(intervalId);

  setTimeout(() => {
    reviewActiveScouts().catch(err => console.error('Error revisando scouts activos:', err));
  }, 15 * 1000);

  intervalId = setInterval(() => {
    reviewActiveScouts().catch(err => console.error('Error revisando scouts activos:', err));
  }, cfg.checkIntervalMinutes * 60 * 1000);

  console.log(
    `Verificacion de scouts activa: ${cfg.maxActiveMinutes}m + ${cfg.graceMinutes}m, cada ${cfg.checkIntervalMinutes}m`
  );
}

function isVerificationButton(customId) {
  return /^verificacion_(confirmar|salir)_\d+$/.test(customId);
}

async function confirmScoutVerification(interaction, userId) {
  const entries = getActiveEntries(userId);
  const pending = state.verificacionesScout[userId];

  await interaction.deferUpdate();

  if (!pending || entries.length === 0) {
    delete state.verificacionesScout[userId];
    await interaction.message.edit({
      content: 'Esta verificacion ya no esta activa.',
      components: []
    });
    return;
  }

  const now = Date.now();
  if (pending.expiresAt <= now) {
    await interaction.message.edit({
      content: `<@${userId}> la verificacion expiro y fuiste retirado de mapas.`,
      components: []
    });
    await closeScoutByVerification(userId, 'verificacion_expirada', pending.expiresAt, {
      skipMessageEdit: true
    });
    return;
  }

  const username = interaction.user.username || getScoutUsername(userId);
  const nextEntries = entries.map(entry => ({
    ...entry,
    inicio: now,
    username,
  }));

  cerrarScoutsActivos(userId, username, 'verificacion_confirmada', now);
  state.scoutsActivos[userId] = nextEntries;
  delete state.verificacionesScout[userId];

  guardarScouts();
  await actualizarPanel();

  await sendScoutLog('VERIFICADO', [
    `Scout: ${formatUser(userId, username)}`,
    `Mapas: ${formatMaps(entries)}`,
    `Resultado: siguio activo`
  ]);

  await interaction.message.edit({
    content: `<@${userId}> verificacion confirmada. Sigues activo en tus mapas.`,
    components: []
  });
}

async function leaveFromVerification(interaction, userId) {
  await interaction.deferUpdate();
  await interaction.message.edit({
    content: `<@${userId}> saliste de tus mapas desde la verificacion.`,
    components: []
  });

  await closeScoutByVerification(userId, 'verificacion_manual', Date.now(), {
    skipMessageEdit: true
  });
}

async function handleVerificationButton(interaction) {
  const match = interaction.customId.match(/^verificacion_(confirmar|salir)_(\d+)$/);
  if (!match) return false;

  const [, action, userId] = match;

  if (interaction.user.id !== userId) {
    await interaction.reply({
      content: `Esta verificacion es para <@${userId}>.`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (action === 'confirmar') {
    await confirmScoutVerification(interaction, userId);
    return true;
  }

  await leaveFromVerification(interaction, userId);
  return true;
}

async function cancelScoutVerification(userId, content = 'Verificacion cancelada.') {
  const pending = state.verificacionesScout[userId];
  if (!pending) return;

  delete state.verificacionesScout[userId];
  await editVerificationMessage(pending, content);
}

module.exports = {
  startScoutVerification,
  reviewActiveScouts,
  forceScoutVerification,
  isVerificationButton,
  handleVerificationButton,
  cancelScoutVerification,
};
