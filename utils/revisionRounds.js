const state = require('../data/state');
const settings = require('../settings');
const config = require('../config');
const { guardarRevisionPanel } = require('../data/persistence');
const { actualizarRevision } = require('./panel');
const { textEmoji } = require('../emojis');

let intervalId = null;
let processingRound = false;

function revisionConfig() {
  const raw = settings.revision || {};
  return {
    roundMinutes: Math.max(1, Number(raw.roundMinutes) || 20),
    warningMinutesBeforeEnd: Math.max(1, Number(raw.warningMinutesBeforeEnd) || 5),
    penaltyPerMiss: Math.max(0, Number(raw.penaltyPerMiss) || 0.05),
    minimumMultiplier: Math.max(0, Math.min(1, Number(raw.minimumMultiplier) || 0.70)),
  };
}

function mapKey(ciudad, mapa) {
  return `${ciudad}__${mapa}`;
}

function snapshotAssignments() {
  const assignments = {};
  for (const [ciudad, mapas] of Object.entries(state.mapas || {})) {
    for (const mapa of mapas || []) {
      const key = mapKey(ciudad, mapa);
      assignments[key] = {
        ciudad,
        mapa,
        userIds: [...new Set(state.registros[ciudad]?.[mapa] || [])],
      };
    }
  }
  return assignments;
}

function startRevisionRound(now = Date.now()) {
  const cfg = revisionConfig();
  state.revisionEstado = {};
  state.revisionRound = {
    id: `${now}`,
    startedAt: now,
    endsAt: now + cfg.roundMinutes * 60000,
    warned: false,
    assignments: snapshotAssignments(),
  };
  guardarRevisionPanel();
  return state.revisionRound;
}

async function beginRevisionRound(now = Date.now()) {
  if (state.revisionRound && state.revisionRound.endsAt > now) {
    return { round: state.revisionRound, created: false };
  }

  const round = startRevisionRound(now);
  try {
    const channel = await getRevisionChannel();
    await channel?.send({
      content: `${config.SCOUT_ROLE_MENTIONS} ${textEmoji('REVIEW')} **Nueva ronda de revisión**\nTienen **${revisionConfig().roundMinutes} minutos** para revisar los mapas.`,
      allowedMentions: { roles: config.SCOUT_ROLE_IDS },
    });
  } catch (err) {
    console.error('No se pudo avisar al rol Scout sobre la ronda:', err);
  }
  await actualizarRevision();
  return { round, created: true };
}

function isReviewed(key, round = state.revisionRound) {
  const estado = state.revisionEstado[key];
  return Boolean(
    estado?.revisores?.length > 0
    && estado.revisadoEn >= (round?.startedAt || 0)
    && estado.revisadoEn <= (round?.endsAt || Infinity)
  );
}

function getRevisionMultiplier(userId) {
  const score = state.revisionScores[userId] || {};
  const manual = Number(score.manualMultiplier);
  const value = Number.isFinite(manual) && manual > 0
    ? manual
    : (Number(score.multiplier) || 1);
  return Math.max(revisionConfig().minimumMultiplier, Math.min(1, value));
}

async function getRevisionChannel() {
  if (!state.client || !config.REVISION_CHANNEL_ID) return null;
  return state.client.channels.fetch(config.REVISION_CHANNEL_ID);
}

function pendingAssignments(round = state.revisionRound) {
  return Object.entries(round?.assignments || {})
    .filter(([key, assignment]) => assignment.userIds.length > 0 && !isReviewed(key, round))
    .map(([key, assignment]) => ({ key, ...assignment }));
}

async function sendRevisionWarning(round) {
  const pending = pendingAssignments(round);
  if (pending.length === 0) return;
  const userIds = [...new Set(pending.flatMap(item => item.userIds))];
  const lines = pending.slice(0, 15).map(item => `• **${item.mapa}** · ${item.userIds.map(id => `<@${id}>`).join(' ')}`);
  const channel = await getRevisionChannel();
  const remainingMinutes = Math.max(1, Math.ceil((round.endsAt - Date.now()) / 60000));
  await channel?.send({
    content: [
      `${textEmoji('ALERT')} **Quedan ${remainingMinutes} minutos para cerrar la ronda**`,
      ...lines,
      '',
      'Uno de los scouts asignados debe marcar cada mapa antes del cierre.',
    ].join('\n'),
    allowedMentions: { users: userIds },
  });
}

function applyRoundScores(round, pending) {
  const missedUsers = new Set(pending.flatMap(item => item.userIds));
  const eligibleUsers = new Set(
    Object.values(round.assignments || {}).flatMap(item => item.userIds || [])
  );
  const cfg = revisionConfig();

  for (const userId of eligibleUsers) {
    const score = state.revisionScores[userId] || {
      misses: 0,
      eligibleRounds: 0,
      compliantRounds: 0,
      multiplier: 1,
    };
    score.eligibleRounds++;
    if (missedUsers.has(userId)) score.misses++;
    else score.compliantRounds++;
    score.multiplier = Math.max(cfg.minimumMultiplier, 1 - score.misses * cfg.penaltyPerMiss);
    state.revisionScores[userId] = score;
  }

  return { missedUsers, eligibleUsers };
}

async function finishRevisionRound(now = Date.now()) {
  const round = state.revisionRound;
  if (!round) return null;

  const assignments = Object.entries(round.assignments || {})
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => a.mapa.localeCompare(b.mapa, 'es', { sensitivity: 'base' }));
  const reviewed = assignments.filter(item => isReviewed(item.key, round));
  const pending = assignments.filter(item => item.userIds.length > 0 && !isReviewed(item.key, round));
  const uncovered = assignments.filter(item => item.userIds.length === 0 && !isReviewed(item.key, round));
  const { missedUsers } = applyRoundScores(round, pending);

  const lines = [
    `${textEmoji('REVIEW')} **Ronda de revisión finalizada**`,
    `✅ Revisados: **${reviewed.length}/${assignments.length}**`,
  ];
  if (pending.length > 0) {
    lines.push('', `${textEmoji('ALERT')} **Con scouts pero sin revisión:**`);
    for (const item of pending.slice(0, 15)) {
      lines.push(`• **${item.mapa}** · ${item.userIds.map(id => `<@${id}>`).join(' ')}`);
    }
  }
  if (uncovered.length > 0) {
    lines.push('', `${textEmoji('ZONA_ROJA')} **Sin scouts:**`, uncovered.slice(0, 15).map(item => `• ${item.mapa}`).join('\n'));
  }

  state.revisionRoundHistory.push({
    id: round.id,
    startedAt: round.startedAt,
    endedAt: now,
    reviewed: reviewed.length,
    total: assignments.length,
    pending: pending.map(item => ({ ciudad: item.ciudad, mapa: item.mapa, userIds: item.userIds })),
  });
  state.revisionRoundHistory = state.revisionRoundHistory.slice(-50);

  const channel = await getRevisionChannel();
  await channel?.send({
    content: lines.join('\n'),
    allowedMentions: { users: [...missedUsers] },
  });
  if (missedUsers.size > 0) {
    const visibles = [...missedUsers].slice(0, 40);
    const scoreLines = visibles.map(
      userId => `• <@${userId}> → **x${getRevisionMultiplier(userId).toFixed(2)}**`
    );
    if (missedUsers.size > visibles.length) scoreLines.push(`• y ${missedUsers.size - visibles.length} scouts más`);
    await channel?.send({
      content: ['📉 **Multiplicadores actualizados:**', ...scoreLines].join('\n'),
      allowedMentions: { users: visibles },
    });
  }

  state.revisionRound = null;
  state.revisionEstado = {};
  guardarRevisionPanel();
  await actualizarRevision();
}

async function tickRevisionRound(now = Date.now()) {
  if (processingRound) return;
  processingRound = true;
  try {
    const cfg = revisionConfig();
    const round = state.revisionRound;
    if (!round) return;
    if (now >= round.endsAt) return await finishRevisionRound(now);

    const warningAt = round.endsAt - cfg.warningMinutesBeforeEnd * 60000;
    if (!round.warned && now >= warningAt) {
      round.warned = true;
      guardarRevisionPanel();
      await sendRevisionWarning(round);
    }
  } finally {
    processingRound = false;
  }
}

function discardResidualRevisionState() {
  const hadResidualState = Boolean(
    state.revisionRound
    || Object.keys(state.revisionEstado || {}).length > 0
  );
  state.revisionRound = null;
  state.revisionEstado = {};
  if (hadResidualState) guardarRevisionPanel();
  return hadResidualState;
}

function startRevisionRounds() {
  if (intervalId) clearInterval(intervalId);
  // Un redeploy nunca debe reactivar rondas, avisos ni marcas anteriores.
  const discarded = discardResidualRevisionState();
  intervalId = setInterval(() => {
    tickRevisionRound().catch(err => console.error('Error procesando ronda de revisión:', err));
  }, 30 * 1000);
  return discarded;
}

function resetRevisionRounds(now = Date.now()) {
  state.revisionScores = {};
  state.revisionRoundHistory = [];
  state.revisionRound = null;
  state.revisionEstado = {};
  guardarRevisionPanel();
}

module.exports = {
  revisionConfig,
  startRevisionRound,
  beginRevisionRound,
  discardResidualRevisionState,
  startRevisionRounds,
  tickRevisionRound,
  finishRevisionRound,
  resetRevisionRounds,
  getRevisionMultiplier,
  isReviewed,
  pendingAssignments,
  applyRoundScores,
};
