const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapasbot-revision-'));
process.env.DATA_DIR = tempDir;

const state = require('../data/state');
const { applyRoundScores, getRevisionMultiplier, finishRevisionRound, beginRevisionRound } = require('../utils/revisionRounds');
const { calculatePhotoPenaltyMs, rollbackProvisionalCredit } = require('../utils/verification');
const { crearPanelRevisionMovil, actualizarRevision } = require('../utils/panel');
const { componentesRevision } = require('../components/revisionComponents');
const { cerrarScoutsActivos, descartarScoutsActivos } = require('../utils/scouts');
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

test('los botones de revisión se muestran alfabéticamente sin perder su índice real', () => {
  state.mapas = { Lymhurst: ['Zulu Map', 'Alpha Map'], Thetford: ['Beta Map'] };
  state.revisionEstado = {};
  state.revisionRound = null;
  const buttons = componentesRevision().flatMap(row => row.components);
  assert.deepEqual(buttons.map(button => button.data.label), ['Alpha Map', 'Beta Map', 'Zulu Map']);
  assert.equal(buttons[0].data.custom_id, 'revision_idx_Lymhurst__1');
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
  const oldMessage = { async delete() { deleted++; } };
  const newMessage = { id: 'nuevo', channel: { id: 'canal-b' } };
  const channel = {
    id: 'canal-b',
    async send() { return newMessage; },
  };
  Object.assign(state, {
    client: {},
    mapas: {},
    registros: {},
    revisionEstado: {},
    revisionRound: null,
    revisionMobileMessage: oldMessage,
    revisionMobileMessageId: 'viejo',
    revisionMobileChannelId: 'canal-a',
  });

  await crearPanelRevisionMovil(channel);
  assert.equal(deleted, 1);
  assert.equal(state.revisionMobileMessageId, 'nuevo');
  assert.equal(state.revisionMobileChannelId, 'canal-b');
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
