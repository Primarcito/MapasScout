const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const state = require('../data/state');
const settings = require('../settings');
const config = require('../config');
const { guardarDatos, guardarScouts } = require('../data/persistence');
const { guardarUltimosMapas, cerrarScoutsActivos, descartarScoutsActivos, borrarRegistrosUsuario, getRegisteredActiveEntries, reconcileRegisteredActiveScouts } = require('./scouts');
const { actualizarPanel } = require('./panel');
const { verificarMapaVacio } = require('./alerts');
const { sendScoutLog, formatMaps, formatUser } = require('./scoutLogs');
const { canScout, canDecideVerification } = require('../permissions');
const { isCreatorUser, sendCreatorDm } = require('./creatorMessages');

let intervalId = null;
const expirationTimers = new Map();
const PHOTO_FREE_MINUTES = 1;
const MAX_DELAY_PENALTY_MINUTES = 180;

function calculateDelayPenaltyMinutes(startedAt, completedAt, graceMinutes, freeMinutes = PHOTO_FREE_MINUTES) {
  const freeUntil = startedAt + freeMinutes * 60000;
  if (completedAt <= freeUntil) return 0;
  const deadline = startedAt + graceMinutes * 60000;
  const penalizedWindow = Math.max(1, deadline - freeUntil);
  const ratio = Math.min(1, Math.max(0, (completedAt - freeUntil) / penalizedWindow));

  // Curva progresiva para una ventana normal de 10 minutos:
  // 1m: 0, 2m: -10m, 3m: -20m, 4m: -30m, 6m: -60m y 10m: -180m.
  let penaltyMinutes;
  if (ratio <= 1 / 3) {
    penaltyMinutes = ratio * 90;
  } else if (ratio <= 5 / 9) {
    penaltyMinutes = 30 + ((ratio - 1 / 3) / (2 / 9)) * 30;
  } else {
    penaltyMinutes = 60 + ((ratio - 5 / 9) / (4 / 9)) * 120;
  }
  return penaltyMinutes;
}

function calculatePhotoPenaltyMs(pending, submittedAt = Date.now(), cfg = getVerificationConfig()) {
  const createdAt = Number(pending?.createdAt) || submittedAt;
  const responseAt = Number(pending?.screenshotRequestedAt);
  const totalPenalty = calculateDelayPenaltyMinutes(createdAt, submittedAt, cfg.graceMinutes);

  // Compatibilidad con verificaciones antiguas que no guardaban el momento del clic.
  if (!Number.isFinite(responseAt) || responseAt < createdAt || responseAt > submittedAt) {
    return Math.round(totalPenalty) * 60000;
  }

  const responsePenalty = calculateDelayPenaltyMinutes(createdAt, responseAt, cfg.graceMinutes);
  const photoPenalty = calculateDelayPenaltyMinutes(responseAt, submittedAt, cfg.graceMinutes);
  const fastestSignalPenalty = Math.min(responsePenalty, photoPenalty);

  // El tiempo total siempre representa al menos 25% del descuento. La señal
  // más rápida (clic o foto) puede reducirlo, pero nunca borrarlo por completo.
  const finalPenalty = totalPenalty * 0.25 + fastestSignalPenalty * 0.75;
  return Math.round(finalPenalty) * 60000;
}

function numberOrDefault(value, fallback, min = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

function normalizeVerificationMode(value) {
  return value === 'normal' ? 'normal' : 'foto';
}

function getVerificationMode() {
  return normalizeVerificationMode(state.verificationMode || settings.verification?.mode || 'foto');
}

function getVerificationConfig() {
  const raw = settings.verification || {};
  return {
    enabled: raw.enabled !== false,
    mode: getVerificationMode(),
    maxActiveMinutes: numberOrDefault(raw.maxActiveMinutes, 240, 15),
    graceMinutes: numberOrDefault(raw.graceMinutes, 10, 1),
    checkIntervalMinutes: numberOrDefault(raw.checkIntervalMinutes, 5, 1),
    scoutReviewVotes: numberOrDefault(raw.scoutReviewVotes, 3, 1),
    reviewReminderMinutes: numberOrDefault(raw.reviewReminderMinutes, 30, 1),
  };
}

function getVerificationEvidenceChannelId() {
  return settings.channels?.verificationEvidence || process.env.SCOUT_VERIFICATION_EVIDENCE_CHANNEL_ID || null;
}

function formatMinutes(totalMin) {
  const horas = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (horas <= 0) return `${mins}m`;
  return `${horas}h ${mins}m`;
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function retainedCreditMinutes(pending, creditUntil, penaltyMs) {
  const cycleStart = Number(pending?.cycleStart) || Number(creditUntil);
  const available = Math.max(0, Math.floor((Number(creditUntil) - cycleStart) / 60000));
  return Math.max(0, available - Math.round((Number(penaltyMs) || 0) / 60000));
}

function noPhotoExpirationContent(userId, pending) {
  const retained = retainedCreditMinutes(
    pending,
    getCreditUntilOnClose(pending),
    MAX_DELAY_PENALTY_MINUTES * 60000
  );
  const reason = normalizeVerificationMode(pending?.mode || getVerificationMode()) === 'foto'
    ? 'no enviaste la captura a tiempo'
    : 'no confirmaste a tiempo';
  return `<@${userId}> ${reason}: fuiste retirado de mapas y conservarás **${formatMinutes(retained)}** de este bloque.`;
}

function getActiveEntries(userId) {
  return getRegisteredActiveEntries(userId);
}

function getOldestStart(entries) {
  return entries.reduce((oldest, entry) => Math.min(oldest, entry.inicio), Date.now());
}

function getCreditUntilOnClose(pending) {
  return pending?.creditUntilOnClose || pending?.creditFromOnExpire || Date.now();
}

function scheduleVerificationExpiration(userId, expiresAt) {
  const id = String(userId);
  const previous = expirationTimers.get(id);
  if (previous) clearTimeout(previous);

  const delay = Math.max(0, Number(expiresAt) - Date.now());
  const timer = setTimeout(() => {
    expirationTimers.delete(id);
    expireVerificationAtDeadline(id).catch(err => {
      console.error(`Error anulando la verificacion vencida de ${id}:`, err);
    });
  }, delay);
  expirationTimers.set(id, timer);
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

function shortMapsSummary(entries, limit = 3) {
  if (!entries || entries.length === 0) return 'sin mapas';
  const visibles = entries
    .slice(0, limit)
    .map(entry => `${entry.ciudad} - ${entry.mapa}`);
  const extra = entries.length - visibles.length;
  return extra > 0 ? `${visibles.join(', ')} +${extra} mas` : visibles.join(', ');
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

function creatorVerificationButtons(userId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`verificacion_creador_confirmar_${userId}`)
        .setLabel('Confirmar activo')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`verificacion_creador_salir_${userId}`)
        .setLabel('Retirar')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    )
  ];
}

function evidenceReviewButtons(userId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`verificacion_evidencia_ok_${userId}`)
        .setLabel('Bien')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`verificacion_evidencia_mal_${userId}`)
        .setLabel('Mal')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    )
  ];
}

async function sendCreatorVerificationRequest(userId, entries, activeMinutes, cfg, options = {}) {
  if (!config.CREATOR_NOTIFY_VERIFICATION) return [];

  const origin = options.requestedBy ? `manual por <@${options.requestedBy}>` : 'automatica';
  return sendCreatorDm({
    content:
      `**Verificacion enviada**\n` +
      `Scout: ${formatUser(userId, getScoutUsername(userId))}\n` +
      `Mapas: ${formatMaps(entries)}\n` +
      `Tiempo activo: ${formatMinutes(activeMinutes)}\n` +
      `Modo: ${cfg.mode}\n` +
      `Origen: ${origin}\n` +
      `Vence: <t:${Math.floor((Date.now() + cfg.graceMinutes * 60000) / 1000)}:R>`,
    components: creatorVerificationButtons(userId),
  });
}

async function sendCreatorEvidenceCopy(userId, entries, attachments, evidenceMessage, username) {
  if (!config.CREATOR_NOTIFY_VERIFICATION) return [];

  const cfg = getVerificationConfig();
  const files = attachments.map((attachment, index) => ({
    attachment: attachment.url,
    name: attachment.name || `verificacion_${userId}_${index + 1}.png`,
  }));

  return sendCreatorDm({
    content:
      `**Captura de verificacion recibida**\n` +
      buildEvidenceReviewContent(userId, entries, { approve: [], reject: [] }, cfg, null, username) +
      `\nCanal: ${evidenceMessage?.url || 'sin enlace'}`,
    files,
    components: evidenceReviewButtons(userId),
  });
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

function getImageAttachments(message) {
  return Array.from(message.attachments.values()).filter(attachment => {
    const contentType = attachment.contentType || '';
    const name = attachment.name || '';
    return contentType.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(name);
  });
}

async function sendVerificationEvidence(userId, entries, attachments, message) {
  const channelId = getVerificationEvidenceChannelId();
  if (!channelId || !state.client) return null;

  const channel = await state.client.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;
  const cfg = getVerificationConfig();

  const files = attachments.map((attachment, index) => ({
    attachment: attachment.url,
    name: attachment.name || `verificacion_${userId}_${index + 1}.png`,
  }));

  return channel.send({
    content: buildEvidenceReviewContent(userId, entries, {
      approve: [],
      reject: [],
    }, cfg, 'Aceptada temporalmente · pendiente de revisión', message.author.username),
    files,
    components: evidenceReviewButtons(userId),
    allowedMentions: { users: [userId] },
  });
}

function buildEvidenceReviewContent(userId, entries, votes, cfg, status = null, username = null) {
  const approve = votes?.approve?.length || 0;
  const reject = votes?.reject?.length || 0;
  const lines = [
    `**Verificacion de scout**`,
    `Scout: ${formatUser(userId, username || getScoutUsername(userId))}`,
    `Mapas: ${shortMapsSummary(entries)}`,
    `Hora: <t:${Math.floor(Date.now() / 1000)}:t>`,
    `Votos: ✅ ${approve}/${cfg.scoutReviewVotes} | ❌ ${reject}/${cfg.scoutReviewVotes}`,
    `Scouts: ${cfg.scoutReviewVotes} votos. GM/Officer: 1 voto.`,
  ];
  if (status) lines.push(`Estado: **${status}**`);
  return lines.join('\n');
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
  const creditUntilOnClose = Math.min(now, oldestStart + cfg.maxActiveMinutes * 60000);
  const expiresAt = now + cfg.graceMinutes * 60000;

  try {
    const modeText = cfg.mode === 'foto'
      ? 'Pulsa **Sigo activo** y luego envía una captura del scout con la hora visible. ' +
        'Tienes 1 minuto sin penalización; después el crédito baja progresivamente hasta conservar solo 1 hora al vencer.'
      : 'Pulsa **Sigo activo** para confirmar o **Salir de mapas** para retirarte.';
    const deadlineText = cfg.mode === 'foto'
      ? `Tienes **${cfg.graceMinutes}m en total** para pulsar y enviar la captura.`
      : `Tienes **${cfg.graceMinutes}m** para responder.`;
    const msg = await channel.send({
      content:
        `<@${userId}> verificacion de scout: llevas **${formatMinutes(activeMinutes)}** activo en ${mapsSummary(entries)}.\n` +
        `${modeText}\n${deadlineText}`,
      components: verificationButtons(userId),
      allowedMentions: { users: [userId] }
    });

    state.verificacionesScout[userId] = {
      status: 'waiting_response',
      messageId: msg.id,
      channelId: msg.channel.id,
      isDm: true,
      createdAt: now,
      mode: cfg.mode,
      creditUntilOnClose,
      creditPenaltyMs: 0,
      cycleStart: oldestStart,
      expiresAt,
    };
    guardarScouts();
    scheduleVerificationExpiration(userId, expiresAt);

    await sendCreatorVerificationRequest(userId, entries, activeMinutes, cfg, options);

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
  if (options.forfeitCredit) {
    descartarScoutsActivos(userId);
  } else {
    cerrarScoutsActivos(userId, username, motivo, finOverride, {
      creditFrom: options.creditFrom || null,
      creditPenaltyMs: options.creditPenaltyMs ?? pending?.creditPenaltyMs ?? 0,
    });
  }
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

async function expireVerificationAtDeadline(userId, now = Date.now()) {
  const pending = state.verificacionesScout[userId];
  if (!pending || pending.status === 'waiting_review') return false;
  if (
    pending.status === 'processing_screenshot'
    && Number(pending.screenshotReceivedAt) <= Number(pending.expiresAt)
  ) {
    return false;
  }
  if (Number(pending.expiresAt) > now) {
    scheduleVerificationExpiration(userId, pending.expiresAt);
    return false;
  }

  const entries = getActiveEntries(userId);
  if (entries.length === 0) {
    await cancelScoutVerification(userId, 'Verificacion cancelada: ya no tienes mapas activos.');
    return true;
  }

  pending.creditPenaltyMs = MAX_DELAY_PENALTY_MINUTES * 60000;
  await closeScoutByVerification(userId, 'verificacion_expirada', getCreditUntilOnClose(pending), {
    content: noPhotoExpirationContent(userId, pending)
  });
  return true;
}

async function reviewActiveScouts() {
  const cfg = getVerificationConfig();
  if (!cfg.enabled) return;

  const staleEntries = reconcileRegisteredActiveScouts();
  if (staleEntries.length) {
    guardarScouts();
    console.log(`Se descartaron ${staleEntries.length} sesiones residuales que no aparecían en el panel.`);
  }

  const now = Date.now();
  const maxMs = cfg.maxActiveMinutes * 60000;

  for (const userId of Object.keys(state.verificacionesScout)) {
    const entries = getActiveEntries(userId);
    const pending = state.verificacionesScout[userId];

    if (entries.length === 0) {
      if (pending.status === 'waiting_review') continue;
      await cancelScoutVerification(userId, 'Verificacion cancelada: ya no tienes mapas activos.');
      continue;
    }

    if (pending.status === 'waiting_review') {
      const submittedAt = pending.screenshotReceivedAt || pending.createdAt || now;
      const reminderAt = submittedAt + cfg.reviewReminderMinutes * 60000;
      if (!pending.reviewReminderSentAt && now >= reminderAt) {
        const channel = await state.client?.channels.fetch(pending.reviewChannelId).catch(() => null);
        if (channel) {
          const roleIds = settings.roles?.verificationOfficer || [];
          const mentions = roleIds.map(id => `<@&${id}>`).join(' ');
          await channel.send({
            content: `${mentions} evidencia de <@${userId}> pendiente desde <t:${Math.floor(submittedAt / 1000)}:R>. ${pending.evidenceUrl || ''}`.trim(),
            allowedMentions: { roles: roleIds },
          }).catch(err => console.error('No se pudo avisar una evidencia pendiente:', err));
        }
        pending.reviewReminderSentAt = now;
        guardarScouts();
      }
      continue;
    }
    if (pending.status === 'processing_screenshot') continue;

    if (pending.expiresAt <= now) {
      await expireVerificationAtDeadline(userId, now);
    }
  }

  for (const userId of Object.keys(state.scoutsActivos)) {
    const entries = getActiveEntries(userId);
    if (entries.length === 0 || state.verificacionesScout[userId]) continue;

    const oldestStart = getOldestStart(entries);

    if (oldestStart + maxMs <= now) {
      const result = await requestVerification(userId, entries, now, cfg);
      if (!result.ok && ['dm_unavailable', 'send_failed'].includes(result.reason)) {
        await closeScoutByVerification(userId, `verificacion_${result.reason}`, oldestStart + maxMs);
      }
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
  let recoveredInterruptedUpload = false;
  for (const [userId, pending] of Object.entries(state.verificacionesScout)) {
    if (pending?.status === 'processing_screenshot') {
      delete state.verificacionesScout[userId];
      recoveredInterruptedUpload = true;
      editVerificationMessage(
        pending,
        'La carga de tu captura fue interrumpida por un reinicio del bot. No se aplicó penalización; recibirás una verificación nueva.'
      ).catch(() => {});
      continue;
    }
    if (pending?.status !== 'waiting_review' && pending?.expiresAt) {
      scheduleVerificationExpiration(userId, pending.expiresAt);
    }
  }
  if (recoveredInterruptedUpload) guardarScouts();

  setTimeout(() => {
    reviewActiveScouts().catch(err => console.error('Error revisando scouts activos:', err));
  }, 15 * 1000);

  intervalId = setInterval(() => {
    reviewActiveScouts().catch(err => console.error('Error revisando scouts activos:', err));
  }, cfg.checkIntervalMinutes * 60 * 1000);

  console.log(
    `Verificacion de scouts activa: modo ${cfg.mode}, ${cfg.maxActiveMinutes}m + ${cfg.graceMinutes}m, cada ${cfg.checkIntervalMinutes}m`
  );
}

function isVerificationButton(customId) {
  return /^verificacion_(confirmar|salir)_\d+$/.test(customId)
    || /^verificacion_evidencia_(ok|mal)_\d+$/.test(customId)
    || /^verificacion_creador_(confirmar|salir)_\d+$/.test(customId);
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
    pending.creditPenaltyMs = MAX_DELAY_PENALTY_MINUTES * 60000;
    await interaction.message.edit({
      content: noPhotoExpirationContent(userId, pending),
      components: []
    });
    await closeScoutByVerification(userId, 'verificacion_expirada', getCreditUntilOnClose(pending), {
      skipMessageEdit: true
    });
    return;
  }

  const mode = normalizeVerificationMode(pending.mode || getVerificationMode());
  pending.status = 'waiting_screenshot';
  pending.screenshotRequestedAt = now;
  guardarScouts();
  if (mode === 'normal') {
    const username = interaction.user.username || getScoutUsername(userId);
    await completeScoutVerification(userId, username, entries, {
      resultado: 'confirmado por boton'
    });
    await interaction.message.edit({
      content: `<@${userId}> verificacion confirmada. Sigues activo en tus mapas.`,
      components: []
    });
    return;
  }

  await interaction.message.edit({
    content:
      `<@${userId}> envia aqui una **captura del scout con la hora visible** para confirmar que sigues activo.\n` +
      `Tiempo restante: <t:${Math.floor(pending.expiresAt / 1000)}:R>.`,
    components: []
  });
}

async function completeScoutVerification(userId, username, entries, options = {}) {
  const now = options.completedAt || Date.now();
  const creditUntil = options.creditUntil || now;
  const nextEntries = entries.map(entry => ({
    ...entry,
    inicio: now,
    username,
  }));

  cerrarScoutsActivos(userId, username, 'verificacion_confirmada', creditUntil, {
    creditPenaltyMs: options.creditPenaltyMs || 0,
  });
  state.scoutsActivos[userId] = nextEntries;
  delete state.verificacionesScout[userId];

  guardarScouts();
  await actualizarPanel();

  await sendScoutLog('VERIFICADO', [
    `Scout: ${formatUser(userId, username)}`,
    `Mapas: ${formatMaps(entries)}`,
    `Resultado: ${options.resultado || 'siguio activo'}`,
    options.evidenceUrl ? `Captura: ${options.evidenceUrl}` : null
  ].filter(Boolean));
}

function rollbackProvisionalCredit(verificationId) {
  if (!verificationId) return [];
  const removed = state.historialScouts.filter(entry => entry.verificationId === verificationId);
  const removedToday = state.historialDia.filter(entry => entry.verificationId === verificationId);
  state.historialScouts = state.historialScouts.filter(entry => entry.verificationId !== verificationId);
  state.historialDia = state.historialDia.filter(entry => entry.verificationId !== verificationId);

  for (const entry of removedToday) {
    const key = `${entry.ciudad}__${entry.mapa}`;
    if (state.coberturaDia[key]) {
      state.coberturaDia[key].minutos = Math.max(0, (state.coberturaDia[key].minutos || 0) - (entry.duracionMin || 0));
    }
  }
  return removed;
}

async function acceptScreenshotProvisionally(userId, username, entries, pending) {
  const now = pending.screenshotReceivedAt || Date.now();
  const verificationId = pending.provisionalVerificationId;
  const nextEntries = entries.map(entry => ({
    ...entry,
    inicio: now,
    username,
    provisional: true,
    provisionalVerificationId: verificationId,
  }));

  cerrarScoutsActivos(userId, username, 'verificacion_provisional', now, {
    creditPenaltyMs: pending.creditPenaltyMs || 0,
    verificationId,
    provisional: true,
  });
  state.scoutsActivos[userId] = nextEntries;
  pending.provisionalEntries = entries.map(entry => ({ ...entry }));
  guardarScouts();
  await actualizarPanel();
}

async function approveProvisionalVerification(userId, pending) {
  const verificationId = pending.provisionalVerificationId;
  const approvedRecords = state.historialScouts.filter(entry => entry.verificationId === verificationId);
  const currentRecords = state.historialDia.filter(entry => entry.verificationId === verificationId);

  for (const entry of [...approvedRecords, ...currentRecords]) {
    entry.provisional = false;
    entry.motivo = 'verificacion_confirmada';
  }
  for (const entry of state.scoutsActivos[userId] || []) {
    if (entry.provisionalVerificationId === verificationId) {
      delete entry.provisional;
      delete entry.provisionalVerificationId;
    }
  }

  // Si la revisión terminó después del cierre diario, acreditar los registros
  // aprobados en el período actual para que no se pierdan definitivamente.
  if (currentRecords.length === 0) {
    state.historialDia.push(...approvedRecords.map(entry => ({
      ...entry,
      provisional: false,
      motivo: 'verificacion_confirmada_diferida',
    })));
  }

  delete state.verificacionesScout[userId];
  guardarScouts();
}

async function handleVerificationScreenshotMessage(message) {
  if (message.author.bot || message.guild) return false;

  const userId = message.author.id;
  const pending = state.verificacionesScout[userId];
  if (!pending || pending.status !== 'waiting_screenshot') return false;
  if (pending.channelId && pending.channelId !== message.channel.id) return false;

  const entries = getActiveEntries(userId);
  if (entries.length === 0) {
    delete state.verificacionesScout[userId];
    await message.reply('Esta verificacion ya no esta activa.');
    return true;
  }

  const now = Date.now();
  if (pending.expiresAt <= now) {
    pending.creditPenaltyMs = MAX_DELAY_PENALTY_MINUTES * 60000;
    await closeScoutByVerification(userId, 'verificacion_expirada', getCreditUntilOnClose(pending), {
      content: noPhotoExpirationContent(userId, pending)
    });
    await message.reply(noPhotoExpirationContent(userId, pending));
    return true;
  }

  const attachments = getImageAttachments(message);
  if (attachments.length === 0) {
    await message.reply('Envia una captura de imagen del scout con la hora visible para confirmar.');
    return true;
  }

  pending.status = 'processing_screenshot';
  pending.screenshotReceivedAt = now;
  guardarScouts();

  const restoreScreenshotWait = async () => {
    if (state.verificacionesScout[userId] !== pending) return;
    pending.status = 'waiting_screenshot';
    delete pending.screenshotReceivedAt;
    guardarScouts();
    if (pending.expiresAt <= Date.now()) {
      await expireVerificationAtDeadline(userId);
    } else {
      scheduleVerificationExpiration(userId, pending.expiresAt);
    }
  };

  let evidenceMessage = null;
  try {
    evidenceMessage = await sendVerificationEvidence(userId, entries, attachments, message);
  } catch (err) {
    console.error('Error enviando captura de verificacion:', err);
    await restoreScreenshotWait();
    await message.reply('Recibi la captura, pero no pude archivarla en el canal de verificaciones. Avisa a un GM.');
    return true;
  }
  if (!evidenceMessage) {
    await restoreScreenshotWait();
    await message.reply('Recibi la captura, pero no encontre el canal de verificaciones. Avisa a un GM.');
    return true;
  }
  if (state.verificacionesScout[userId] !== pending) {
    await evidenceMessage.edit({
      content: buildEvidenceReviewContent(
        userId,
        entries,
        { approve: [], reject: [] },
        getVerificationConfig(),
        'Anulada porque el scout dejó de estar activo durante el envío',
        message.author.username
      ),
      components: evidenceReviewButtons(userId, true),
    }).catch(() => {});
    await message.reply('La verificación se anuló porque ya no estabas activo cuando terminó de procesarse.');
    return true;
  }

  pending.status = 'waiting_review';
  pending.reviewChannelId = evidenceMessage.channel.id;
  pending.reviewMessageId = evidenceMessage.id;
  pending.reviewVotes = { approve: [], reject: [] };
  pending.evidenceUrl = evidenceMessage.url;
  pending.username = message.author.username;
  pending.provisionalVerificationId = evidenceMessage.id;
  pending.reviewExpiresAt = null;
  pending.creditPenaltyMs = calculatePhotoPenaltyMs(pending, now);
  const createdAt = Number(pending.createdAt) || now;
  const responseAt = Number(pending.screenshotRequestedAt) || createdAt;
  const responseDelay = formatElapsed(responseAt - createdAt);
  const photoDelay = formatElapsed(now - responseAt);
  const penaltyMinutes = Math.round(pending.creditPenaltyMs / 60000);
  const retainedMinutes = retainedCreditMinutes(pending, now, pending.creditPenaltyMs);
  await acceptScreenshotProvisionally(userId, message.author.username, entries, pending);
  try {
    await evidenceMessage.edit({
      content: buildEvidenceReviewContent(
        userId,
        entries,
        pending.reviewVotes,
        getVerificationConfig(),
        `Aceptada temporalmente · respuesta ${responseDelay} · foto ${photoDelay} · descuento ${formatMinutes(penaltyMinutes)} · crédito ${formatMinutes(retainedMinutes)}`,
        message.author.username
      ),
      components: evidenceReviewButtons(userId),
    });
  } catch (err) {
    console.error('No se pudo actualizar el crédito provisional en la evidencia:', err);
  }
  await sendCreatorEvidenceCopy(userId, entries, attachments, evidenceMessage, message.author.username);

  await editVerificationMessage(
    pending,
    `<@${userId}> captura aceptada temporalmente. Sigues activo mientras se revisa. ` +
    `Respuesta: **${responseDelay}** · foto: **${photoDelay}** · descuento: **${formatMinutes(penaltyMinutes)}** · ` +
    `crédito provisional: **${formatMinutes(retainedMinutes)}**. Si la captura es rechazada, perderás el bloque completo.`
  );
  await sendScoutLog('VERIFICACION_CAPTURA', [
    `Scout: ${formatUser(userId, message.author.username)}`,
    `Mapas: ${formatMaps(entries)}`,
    `Captura: ${evidenceMessage.url}`,
    `Estado: pendiente de revision`
  ]);
  guardarScouts();
  await message.reply('Captura aceptada temporalmente y enviada a revisión. Puedes continuar en tus mapas.');
  return true;
}

function ensureReviewVotes(pending) {
  if (!pending.reviewVotes) pending.reviewVotes = { approve: [], reject: [] };
  if (!Array.isArray(pending.reviewVotes.approve)) pending.reviewVotes.approve = [];
  if (!Array.isArray(pending.reviewVotes.reject)) pending.reviewVotes.reject = [];
  return pending.reviewVotes;
}

async function editEvidenceReviewMessages(interaction, pending, payload) {
  const editedMessageIds = new Set();

  try {
    await interaction.message.edit(payload);
    editedMessageIds.add(interaction.message.id);
  } catch (err) {
    console.error('Error actualizando mensaje de verificacion actual:', err.message);
  }

  if (!pending?.reviewChannelId || !pending?.reviewMessageId || editedMessageIds.has(pending.reviewMessageId)) {
    return;
  }

  try {
    const channel = await state.client?.channels.fetch(pending.reviewChannelId);
    const reviewMessage = await channel?.messages.fetch(pending.reviewMessageId);
    await reviewMessage?.edit(payload);
  } catch (err) {
    console.error('Error actualizando mensaje de verificacion en canal:', err.message);
  }
}

async function finalizeEvidenceReview(interaction, userId, approved, entries, pending, decidedBy) {
  const username = pending.username || getScoutUsername(userId);
  const cfg = getVerificationConfig();
  const status = approved ? `Aprobada por ${decidedBy}` : `Rechazada por ${decidedBy}`;

  if (approved) {
    await approveProvisionalVerification(userId, pending);
    await editVerificationMessage(
      pending,
      `<@${userId}> verificacion aprobada. Sigues activo en tus mapas.`
    );
  } else {
    rollbackProvisionalCredit(pending.provisionalVerificationId);
    await closeScoutByVerification(userId, 'verificacion_rechazada_fraude', getCreditUntilOnClose(pending), {
      forfeitCredit: true,
      content: `<@${userId}> tu captura fue rechazada, se anuló todo el bloque provisional y fuiste retirado de mapas.`
    });
  }

  await editEvidenceReviewMessages(interaction, pending, {
    content: buildEvidenceReviewContent(
      userId,
      entries,
      ensureReviewVotes(pending),
      cfg,
      status,
      username
    ),
    components: evidenceReviewButtons(userId, true),
  });

  await sendScoutLog(approved ? 'VERIFICACION_APROBADA' : 'VERIFICACION_RECHAZADA', [
    `Scout: ${formatUser(userId, username)}`,
    `Mapas: ${formatMaps(entries)}`,
    `Decision: ${status}`,
    pending.evidenceUrl ? `Captura: ${pending.evidenceUrl}` : null
  ].filter(Boolean));
}

async function handleEvidenceReviewButton(interaction, action, userId) {
  const pending = state.verificacionesScout[userId];
  const activeEntries = getActiveEntries(userId);
  const entries = pending?.provisionalEntries?.length > 0 ? pending.provisionalEntries : activeEntries;

  if (!pending || pending.status !== 'waiting_review') {
    await interaction.reply({
      content: 'Esta verificacion ya no esta pendiente.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (entries.length === 0) {
    delete state.verificacionesScout[userId];
    await interaction.update({
      content: 'Esta verificacion ya no esta activa porque el scout no esta en mapas.',
      components: evidenceReviewButtons(userId, true)
    });
    return true;
  }

  const isCreator = isCreatorUser(interaction.user.id);
  const isOfficer = isCreator || canDecideVerification(interaction.member);
  const isScout = canScout(interaction.member);
  if (interaction.user.id === userId && !isOfficer) {
    await interaction.reply({
      content: 'No puedes validar tu propia captura.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (!isOfficer && !isScout) {
    await interaction.reply({
      content: 'Necesitas rol Scout o GM/Officer para revisar esta captura.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const approved = action === 'ok';
  const decidedBy = isCreator ? `creador ${interaction.user}` : (isOfficer ? `GM/Officer ${interaction.user}` : `${interaction.user}`);
  const votes = ensureReviewVotes(pending);

  if (isOfficer) {
    await interaction.deferUpdate();
    await finalizeEvidenceReview(interaction, userId, approved, entries, pending, decidedBy);
    return true;
  }

  const voterId = interaction.user.id;
  votes.approve = votes.approve.filter(id => id !== voterId);
  votes.reject = votes.reject.filter(id => id !== voterId);
  if (approved) votes.approve.push(voterId);
  else votes.reject.push(voterId);
  guardarScouts();

  const cfg = getVerificationConfig();
  if (votes.approve.length >= cfg.scoutReviewVotes || votes.reject.length >= cfg.scoutReviewVotes) {
    await interaction.deferUpdate();
    await finalizeEvidenceReview(
      interaction,
      userId,
      votes.approve.length >= cfg.scoutReviewVotes,
      entries,
      pending,
      `${cfg.scoutReviewVotes} scouts`
    );
    return true;
  }

  await interaction.update({
    content: buildEvidenceReviewContent(userId, entries, votes, cfg, null, getScoutUsername(userId)),
    components: evidenceReviewButtons(userId),
  });
  return true;
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

async function handleCreatorVerificationButton(interaction, action, userId) {
  if (!isCreatorUser(interaction.user.id)) {
    await interaction.reply({
      content: 'Solo el creador puede usar este boton.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const pending = state.verificacionesScout[userId];
  const entries = getActiveEntries(userId);
  await interaction.deferUpdate();

  if (!pending || entries.length === 0) {
    delete state.verificacionesScout[userId];
    await interaction.message.edit({
      content: `La verificacion de <@${userId}> ya no esta activa.`,
      components: creatorVerificationButtons(userId, true)
    });
    return true;
  }

  if (action === 'confirmar') {
    const username = getScoutUsername(userId);
    await completeScoutVerification(userId, username, entries, {
      resultado: `confirmado por creador ${interaction.user.username || interaction.user.id}`,
    });
    await editVerificationMessage(pending, `<@${userId}> verificacion confirmada por el creador. Sigues activo en tus mapas.`);
    await interaction.message.edit({
      content: `<@${userId}> confirmado por el creador. Sigue activo en sus mapas.`,
      components: creatorVerificationButtons(userId, true)
    });
    return true;
  }

  await closeScoutByVerification(userId, 'verificacion_retirada_por_creador', getCreditUntilOnClose(pending), {
    content: `<@${userId}> fuiste retirado de mapas por decision del creador.`
  });
  await interaction.message.edit({
    content: `<@${userId}> retirado de mapas por el creador.`,
    components: creatorVerificationButtons(userId, true)
  });
  return true;
}

async function handleVerificationButton(interaction) {
  const creatorMatch = interaction.customId.match(/^verificacion_creador_(confirmar|salir)_(\d+)$/);
  if (creatorMatch) {
    const [, action, userId] = creatorMatch;
    return handleCreatorVerificationButton(interaction, action, userId);
  }

  const reviewMatch = interaction.customId.match(/^verificacion_evidencia_(ok|mal)_(\d+)$/);
  if (reviewMatch) {
    const [, action, userId] = reviewMatch;
    return handleEvidenceReviewButton(interaction, action, userId);
  }

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

  if (pending.status === 'waiting_review') {
    pending.scoutLeftWhilePending = true;
    guardarScouts();
    await editVerificationMessage(
      pending,
      `${content}\nLa captura permanece pendiente de revisión y su crédito provisional todavía puede aprobarse o anularse.`
    );
    return;
  }

  delete state.verificacionesScout[userId];
  guardarScouts();
  await editVerificationMessage(pending, content);
}

module.exports = {
  startScoutVerification,
  reviewActiveScouts,
  forceScoutVerification,
  isVerificationButton,
  handleVerificationButton,
  handleVerificationScreenshotMessage,
  cancelScoutVerification,
  getVerificationMode,
  normalizeVerificationMode,
  calculatePhotoPenaltyMs,
  retainedCreditMinutes,
  rollbackProvisionalCredit,
  acceptScreenshotProvisionally,
  approveProvisionalVerification,
  expireVerificationAtDeadline,
};
