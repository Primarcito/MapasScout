const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapasbot-revision-'));
process.env.DATA_DIR = tempDir;

const state = require('../data/state');
const {
  applyRoundScores,
  getRevisionMultiplier,
  finishRevisionRound,
  beginRevisionRound,
  discardResidualRevisionState,
} = require('../utils/revisionRounds');
const { calculatePhotoPenaltyMs, rollbackProvisionalCredit } = require('../utils/verification');
const {
  crearPanelRevisionMovil,
  actualizarRevision,
  republicarPanelPrincipal,
} = require('../utils/panel');
const { componentesRevision } = require('../components/revisionComponents');
const { repairSummaryDescription, regenerateSummaryMessage } = require('../utils/dailySummary');
const { generarEmbedsHistorial } = require('../commands/scout');
const { cerrarScoutsActivos, descartarScoutsActivos, asignarTiempoManual } = require('../utils/scouts');
const { guardarScouts, cargarScouts } = require('../data/persistence');

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

test('una ronda penaliza una sola vez por scout aunque falle varios mapas', () => {
  state.revisionScores = {};
  const round = {
    assignments: {
      uno: { userIds: ['1', '2'] },
      dos: { userIds: ['1'] },
    },
  };
  applyRoundScores(round, [
    { userIds: ['1', '2'] },
    { userIds: ['1'] },
  ]);

  assert.equal(getRevisionMultiplier('1'), 0.95);
  assert.equal(getRevisionMultiplier('2'), 0.95);
  assert.equal(state.revisionScores['1'].misses, 1);
});

test('cerrar una ronda publica síntesis, penaliza y queda detenida', async () => {
  const sent = [];
  state.mapas = { Lymhurst: ['Revisado', 'Pendiente'] };
  state.registros = { Lymhurst: { Revisado: ['1'], Pendiente: ['2'] } };
  state.revisionScores = {};
  state.revisionRoundHistory = [];
  state.revisionRound = {
    id: 'ronda-1',
    startedAt: 1000,
    endsAt: 2000,
    assignments: {
      Lymhurst__Revisado: { ciudad: 'Lymhurst', mapa: 'Revisado', userIds: ['1'] },
      Lymhurst__Pendiente: { ciudad: 'Lymhurst', mapa: 'Pendiente', userIds: ['2'] },
    },
  };
  state.revisionEstado = {
    Lymhurst__Revisado: { revisadoEn: 1500, revisores: ['1'] },
  };
  state.revisionMessage = { async edit() {} };
  state.revisionMobileMessage = null;
  state.client = {
    channels: { async fetch() { return { async send(payload) { sent.push(payload); } }; } },
  };

  await finishRevisionRound(2000);
  assert.equal(sent.length, 2);
  assert.match(sent[0].content, /Revisados: \*\*1\/2\*\*/);
  assert.equal(getRevisionMultiplier('1'), 1);
  assert.equal(getRevisionMultiplier('2'), 0.95);
  assert.equal(state.revisionRound, null);
});

test('iniciar revisión manual etiqueta al rol una sola vez durante la ronda', async () => {
  const sent = [];
  state.mapas = { Lymhurst: ['Mapa'] };
  state.registros = { Lymhurst: { Mapa: ['1'] } };
  state.revisionRound = null;
  state.revisionEstado = {};
  state.client = {
    channels: { async fetch() { return { async send(payload) { sent.push(payload); } }; } },
  };

  const first = await beginRevisionRound(10_000);
  const second = await beginRevisionRound(11_000);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /<@&1435778823743340651>/);
});

test('el arranque descarta una ronda residual sin borrar puntuaciones ni historial', () => {
  state.revisionRound = { id: 'residuo', startedAt: 1, endsAt: Date.now() + 600_000 };
  state.revisionEstado = { mapa: { revisadoEn: 2, revisores: ['1'] } };
  state.revisionScores = { 1: { multiplier: 0.95, misses: 1 } };
  state.revisionRoundHistory = [{ id: 'anterior' }];

  assert.equal(discardResidualRevisionState(), true);
  assert.equal(state.revisionRound, null);
  assert.deepEqual(state.revisionEstado, {});
  assert.equal(state.revisionScores['1'].multiplier, 0.95);
  assert.deepEqual(state.revisionRoundHistory, [{ id: 'anterior' }]);
  assert.equal(discardResidualRevisionState(), false);
});

test('los botones de revisión se agrupan por ciudad y respetan el orden cargado', () => {
  state.mapas = { Lymhurst: ['Zulu Map', 'Alpha Map'], Thetford: ['Beta Map'] };
  state.revisionEstado = {};
  state.revisionRound = null;
  const buttons = componentesRevision().flatMap(row => row.components);
  assert.deepEqual(buttons.map(button => button.data.label), ['Zulu Map', 'Alpha Map', 'Beta Map']);
  assert.equal(buttons[0].data.custom_id, 'revision_idx_Lymhurst__0');
  assert.equal(buttons[0].data.disabled, true);
});

test('un multiplicador manual prevalece sin perder el cálculo automático', () => {
  state.revisionScores = {
    1: { misses: 1, eligibleRounds: 1, compliantRounds: 0, multiplier: 0.95, manualMultiplier: 0.88 },
  };
  applyRoundScores({ assignments: { uno: { userIds: ['1'] } } }, [{ userIds: ['1'] }]);
  assert.equal(getRevisionMultiplier('1'), 0.88);
  assert.equal(state.revisionScores['1'].multiplier, 0.90);
  delete state.revisionScores['1'].manualMultiplier;
  assert.equal(getRevisionMultiplier('1'), 0.90);
});

test('el multiplicador de revisión nunca aumenta la puntuación', () => {
  state.revisionScores = {
    alto: { multiplier: 1, manualMultiplier: 1.25 },
    bajo: { multiplier: 0.50 },
  };
  assert.equal(getRevisionMultiplier('alto'), 1);
  assert.equal(getRevisionMultiplier('bajo'), 0.70);
});

test('repara un resumen antiguo sin puntos y conserva el multiplicador descendente', () => {
  state.revisionScores = {
    1: { username: 'sozapysch', multiplier: 1, manualMultiplier: 0.95 },
  };
  const original = '🥇 **sozapysch** — **766 pts** · 12h 46m · x1.00 · 13 mapas · 🟢';
  const repaired = repairSummaryDescription(original);
  assert.equal(repaired.changed, true);
  assert.equal(repaired.description, '🥇 **sozapysch** — 12h 46m · x0.95 · 13 mapas · 🟢');
});

test('regenerar reconoce el nombre histórico aunque el panel guarde el nombre visible', () => {
  state.revisionScores = {
    1: { username: 'Soza', multiplier: 1, manualMultiplier: 0.85 },
  };
  state.historialScouts = [{ userId: '1', username: 'sozapysch' }];
  state.historialDia = [];
  const original = '🥇 **sozapysch** — 12h 46m · x1.00 · 13 mapas · 🟢';
  const repaired = repairSummaryDescription(original);
  assert.equal(repaired.description, '🥇 **sozapysch** — 12h 46m · x0.85 · 13 mapas · 🟢');
});

test('el resumen de Mapas no publica puntos ni aplica la escala de RankingBot', () => {
  const now = Date.now();
  state.historialDia = [{
    userId: '1', username: 'Scout', ciudad: 'Lymhurst', mapa: 'Mapa Uno', inicio: now - 60 * 60_000, fin: now,
  }];
  state.scoutsActivos = {};
  state.mapas = { Lymhurst: ['Mapa Uno'] };
  state.registros = { Lymhurst: { 'Mapa Uno': ['1'] } };
  state.coberturaDia = {};
  state.revisionScores = { 1: { multiplier: 0.95, username: 'Scout' } };
  const description = generarEmbedsHistorial()[0].data.description;
  assert.doesNotMatch(description, /\bpts\b/i);
  assert.match(description, /1h 0m · x0\.95 · 1 mapa/);
});

test('la asignación manual suma horas sin inventar mapas ni cobertura', () => {
  state.historialScouts = [];
  state.historialDia = [];
  state.scoutsActivos = {};
  state.mapas = { Lymhurst: ['Mapa Uno'] };
  state.registros = { Lymhurst: { 'Mapa Uno': [] } };
  state.coberturaDia = {};
  state.revisionScores = {};

  asignarTiempoManual('1', 'Scout', 180, 'admin', 'captura válida');
  const description = generarEmbedsHistorial()[0].data.description;

  assert.match(description, /Scout.*3h 0m.*0 mapa/s);
  assert.match(description, /0\/1/);
  assert.equal(state.historialDia[0].manualTimeAdjustment, true);
  assert.equal(state.coberturaDia['Ajuste admin__Ajuste de tiempo'], undefined);
});

test('una asignación negativa resta horas sin permitir un total menor que cero', () => {
  state.historialScouts = [];
  state.historialDia = [];
  state.scoutsActivos = {};
  state.mapas = {};
  state.registros = {};
  state.coberturaDia = {};
  state.revisionScores = {};

  asignarTiempoManual('1', 'Scout', 180, 'admin');
  const subtraction = asignarTiempoManual('1', 'Scout', -60, 'admin');
  assert.equal(subtraction.previousMinutes, 180);
  assert.equal(subtraction.appliedMinutes, -60);
  assert.equal(subtraction.totalMinutes, 120);
  assert.match(generarEmbedsHistorial()[0].data.description, /Scout.*2h 0m.*0 mapa/s);

  const clamped = asignarTiempoManual('1', 'Scout', -300, 'admin');
  assert.equal(clamped.appliedMinutes, -120);
  assert.equal(clamped.totalMinutes, 0);
  assert.doesNotMatch(generarEmbedsHistorial()[0].data.description, /-\d+h/);
});

test('regenerar resumen publica el reemplazo antes de borrar el mensaje anterior', async () => {
  const events = [];
  const channel = {
    id: 'archivo',
    messages: {
      async fetch() {
        return {
          embeds: [{
            title: '📊 Resumen del Día',
            description: '🥇 **Scout** — **60 pts** · 1h 0m · x1.00 · 3 mapas · ⚪',
            toJSON() { return { title: this.title, description: this.description }; },
          }],
          async delete() { events.push('delete'); },
        };
      },
    },
    async send(payload) {
      events.push('send');
      assert.doesNotMatch(payload.embeds[0].data.description, /\bpts\b/i);
      return { id: 'nuevo', channel };
    },
  };
  state.revisionScores = {};
  state.completedSummaryRegenerations = [];
  state.client = { channels: { async fetch() { return channel; } } };
  const result = await regenerateSummaryMessage('1525803909573116065');
  assert.deepEqual(events, ['send', 'delete']);
  assert.equal(result.replacement.id, 'nuevo');
  assert.equal(result.deleted, true);
  assert.deepEqual(state.completedSummaryRegenerations, ['1525803909573116065']);
  await assert.rejects(
    regenerateSummaryMessage('1525803909573116065'),
    /ya fue regenerado/
  );
});

test('la demora de foto escala linealmente de cero a tres horas', () => {
  const createdAt = 1_000_000;
  const pending = { createdAt };
  const cfg = { graceMinutes: 10 };
  assert.equal(calculatePhotoPenaltyMs(pending, createdAt + 60_000, cfg), 0);
  assert.equal(calculatePhotoPenaltyMs(pending, createdAt + 5 * 60_000, cfg), 80 * 60_000);
  assert.equal(calculatePhotoPenaltyMs(pending, createdAt + 10 * 60_000, cfg), 180 * 60_000);
});

test('la penalización máxima conserva una hora y el fraude descarta el bloque', () => {
  const inicio = 2_000_000;
  state.historialScouts = [];
  state.historialDia = [];
  state.coberturaDia = {};
  state.scoutsActivos = {
    1: [{ ciudad: 'Lymhurst', mapa: 'Mapa Uno', inicio, username: 'Scout' }],
  };
  cerrarScoutsActivos('1', 'Scout', 'verificacion_confirmada', inicio + 240 * 60_000, {
    creditPenaltyMs: 180 * 60_000,
  });
  assert.equal(state.historialDia[0].duracionMin, 60);

  state.scoutsActivos = {
    2: [{ ciudad: 'Lymhurst', mapa: 'Mapa Dos', inicio, username: 'Fraude' }],
  };
  descartarScoutsActivos('2');
  assert.equal(state.scoutsActivos['2'], undefined);
  assert.equal(state.historialDia.length, 1);
});

test('rechazar una captura elimina únicamente su crédito provisional', () => {
  state.historialScouts = [
    { verificationId: 'foto-1', ciudad: 'Lymhurst', mapa: 'Uno', duracionMin: 120 },
    { verificationId: 'foto-2', ciudad: 'Lymhurst', mapa: 'Dos', duracionMin: 60 },
  ];
  state.historialDia = [...state.historialScouts];
  state.coberturaDia = {
    Lymhurst__Uno: { minutos: 120 },
    Lymhurst__Dos: { minutos: 60 },
  };

  rollbackProvisionalCredit('foto-1');
  assert.deepEqual(state.historialScouts.map(entry => entry.verificationId), ['foto-2']);
  assert.deepEqual(state.historialDia.map(entry => entry.verificationId), ['foto-2']);
  assert.equal(state.coberturaDia.Lymhurst__Uno.minutos, 0);
  assert.equal(state.coberturaDia.Lymhurst__Dos.minutos, 60);
});

test('el panel móvil reemplaza al anterior y conserva uno solo', async () => {
  let deleted = 0;
  let sentPayload = null;
  const oldMessage = { async delete() { deleted++; } };
  const newMessage = { id: 'nuevo', channel: { id: 'canal-b' } };
  const channel = {
    id: 'canal-b',
    async send(payload) {
      sentPayload = payload;
      return newMessage;
    },
  };
  Object.assign(state, {
    client: {},
    mapas: {},
    registros: {},
    revisionEstado: {},
    revisionRound: { startedAt: Date.now(), endsAt: Date.now() + 10 * 60_000 },
    revisionMobileMessage: oldMessage,
    revisionMobileMessageId: 'viejo',
    revisionMobileChannelId: 'canal-a',
  });

  await crearPanelRevisionMovil(channel, { mentionRole: true, created: false });
  assert.equal(deleted, 1);
  assert.equal(state.revisionMobileMessageId, 'nuevo');
  assert.equal(state.revisionMobileChannelId, 'canal-b');
  assert.match(sentPayload.content, /<@&1435778823743340651>/);
  assert.deepEqual(sentPayload.allowedMentions.roles, ['1435778823743340651']);
});

test('revisar en el canal fijo reemplaza el panel y vuelve a etiquetar a Scouts', async () => {
  let deleted = 0;
  let sentPayload = null;
  const channel = {
    id: '1505951463460044913',
    async send(payload) {
      sentPayload = payload;
      return { id: 'revision-nueva', channel };
    },
  };
  Object.assign(state, {
    mapas: {},
    registros: {},
    revisionEstado: {},
    revisionRound: { startedAt: Date.now(), endsAt: Date.now() + 20 * 60_000 },
    revisionMessage: { async delete() { deleted++; } },
    revisionMessageId: 'revision-vieja',
    client: { channels: { async fetch() { return channel; } } },
  });

  await crearPanelRevisionMovil(channel, { mentionRole: true, created: true });
  assert.equal(deleted, 1);
  assert.equal(state.revisionMessageId, 'revision-nueva');
  assert.match(sentPayload.content, /Nueva ronda/);
  assert.match(sentPayload.content, /<@&1435778823743340651>/);
});

test('el comando puede integrar el ping en el panel sin enviar un aviso separado', async () => {
  let sends = 0;
  state.mapas = { Lymhurst: ['Mapa'] };
  state.registros = { Lymhurst: { Mapa: ['1'] } };
  state.revisionRound = null;
  state.revisionEstado = {};
  state.revisionMessage = null;
  state.revisionMobileMessage = null;
  state.client = {
    channels: { async fetch() { return { async send() { sends++; } }; } },
  };

  const result = await beginRevisionRound(Date.now(), { announce: false });
  assert.equal(result.created, true);
  assert.equal(sends, 0);
});

test('el panel principal se reemplaza y solo conserva el mensaje nuevo', async () => {
  let deleted = 0;
  let sends = 0;
  const channel = {
    id: '1435778824775274578',
    async send() {
      sends++;
      return { id: 'panel-nuevo', channel };
    },
  };
  Object.assign(state, {
    mapas: {},
    registros: {},
    panelMessage: { async delete() { deleted++; } },
    panelMessageId: 'panel-viejo',
    panelChannelId: channel.id,
  });

  const result = await republicarPanelPrincipal(channel);
  assert.equal(deleted, 1);
  assert.equal(sends, 1);
  assert.equal(result.id, 'panel-nuevo');
  assert.equal(state.panelMessageId, 'panel-nuevo');
  assert.equal(state.panelChannelId, channel.id);
});

test('actualizar revisión no publica paneles nuevos automáticamente', async () => {
  let sends = 0;
  state.mapas = {};
  state.revisionMessage = null;
  state.revisionMessageId = null;
  state.revisionMobileMessage = null;
  state.client = {
    channels: { async fetch() { return { async send() { sends++; } }; } },
  };
  await actualizarRevision();
  assert.equal(sends, 0);
});

test('la cola provisional de verificaciones sobrevive un reinicio', () => {
  state.scoutsActivos = {};
  state.historialScouts = [];
  state.historialDia = [];
  state.ultimosMapas = {};
  state.verificacionesScout = {
    42: { status: 'waiting_review', provisionalVerificationId: 'foto-42' },
  };
  guardarScouts();
  state.verificacionesScout = {};
  cargarScouts();
  assert.equal(state.verificacionesScout['42'].status, 'waiting_review');
});
