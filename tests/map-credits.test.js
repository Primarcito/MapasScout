const test = require('node:test');
const assert = require('node:assert/strict');

const state = require('../data/state');
const { projectDailyMapCredits, commitDailyMapCredits } = require('../utils/mapCredits');

function sessions(userId, count, minutes, start = 1_000, prefix = 'Mapa') {
  return Array.from({ length: count }, (_, index) => ({
    userId,
    username: 'Scout',
    ciudad: 'Lymhurst',
    mapa: `${prefix} ${index + 1}`,
    inicio: start,
    fin: start + minutes * 60_000,
  }));
}

test.beforeEach(() => {
  state.historialDia = [];
  state.scoutsActivos = {};
  state.mapMinuteBalances = {};
  state.timeMinuteBalances = {};
  state.mapas = {
    Lymhurst: [
      ...Array.from({ length: 9 }, (_, index) => `Mapa ${index + 1}`),
      ...Array.from({ length: 3 }, (_, index) => `Dia 1 ${index + 1}`),
      ...Array.from({ length: 6 }, (_, index) => `Dia 2 ${index + 1}`),
    ],
  };
});

test('nueve mapas durante treinta minutos quedan pendientes y no acreditan mapas', () => {
  state.historialDia = sessions('1', 9, 30);
  const projection = commitDailyMapCredits(31 * 60_000);
  assert.equal(projection['1'].validMaps, 9);
  assert.equal(projection['1'].scoutActivityMinutes, 30);
  assert.equal(projection['1'].mapUnits, 0);
  assert.equal(projection['1'].timeUnits, 0);
  assert.equal(projection['1'].pendingMinutes, 30);
  assert.deepEqual(state.timeMinuteBalances, { '1': 30 });
});

test('un mapa pendiente completa su hora en otro día', () => {
  state.historialDia = sessions('1', 1, 30);
  commitDailyMapCredits(31 * 60_000);
  assert.deepEqual(state.timeMinuteBalances, { '1': 30 });

  state.historialDia = sessions('1', 1, 30, 100_000);
  const projection = projectDailyMapCredits(2_000_000);
  assert.equal(projection['1'].todayTime, 30);
  assert.equal(projection['1'].priorMinutes, 30);
  assert.equal(projection['1'].timeUnits, 0);
  assert.equal(projection['1'].mapUnits, 0);
  assert.equal(projection['1'].pendingMinutes, 60);
});

test('el resumen diario no convierte un saldo anterior en un mapa extra', () => {
  state.timeMinuteBalances = { '1': 180 };
  state.historialDia = sessions('1', 3, 30, 100_000);
  const summaryProjection = projectDailyMapCredits(2_000_000, { includeBalances: false });
  assert.equal(summaryProjection['1'].validMaps, 3);
  assert.equal(summaryProjection['1'].scoutActivityMinutes, 30);
  assert.equal(summaryProjection['1'].mapUnits, 0);
});

test('una hora en tres mapas y tres horas en seis mapas acreditan nueve mapas', () => {
  state.historialDia = sessions('1', 6, 90, 1_000, 'Dia 2');
  const first = commitDailyMapCredits(91 * 60_000);
  assert.equal(first['1'].scoutActivityMinutes, 90);
  assert.equal(first['1'].mapUnits, 2);
  assert.equal(first['1'].timeUnits, 0);
  assert.equal(first['1'].totalUnits, 2);
  assert.deepEqual(state.timeMinuteBalances, { '1': 90 });

  state.historialDia = sessions('1', 1, 150, 100_000, 'Dia 1');
  const second = projectDailyMapCredits(20_000_000);
  assert.equal(second['1'].timeUnits, 1);
  assert.equal(second['1'].mapUnits, 0);
  assert.equal(second['1'].totalUnits, 1);
  assert.equal(second['1'].pendingMinutes, 0);
});

test('los saldos o sesiones de un mapa retirado no aparecen en el resumen vigente', () => {
  state.mapas = { Lymhurst: ['Vigente'] };
  state.mapMinuteBalances = { '1': { 'Lymhurst__Retirado': 45 } };
  state.historialDia = [{
    userId: '1', username: 'Scout', ciudad: 'Lymhurst', mapa: 'Retirado',
    inicio: 1_000, fin: 91 * 60_000,
  }];

  const projection = projectDailyMapCredits(92 * 60_000);
  assert.equal(projection['1'].validMaps, 0);
  assert.equal(projection['1'].scoutActivityMinutes, 0);
  assert.equal(projection['1'].mapUnits, 0);
  assert.equal(projection['1'].pendingMinutes, 0);
});

test('cuatro horas acreditan tiempo y mapas de forma independiente', () => {
  state.historialDia = sessions('1', 6, 240, 1_000, 'Dia 2');
  const projection = projectDailyMapCredits(241 * 60_000);
  assert.equal(projection['1'].timeUnits, 1);
  assert.equal(projection['1'].mapUnits, 2);
  assert.equal(projection['1'].totalUnits, 3);
  assert.equal(projection['1'].pendingMinutes, 0);
});

test('los ajustes manuales no desbloquean puntos por mapas', () => {
  state.historialDia = [
    { userId: '1', manualTimeAdjustment: true, duracionMin: 90 },
    ...sessions('1', 3, 30),
  ];
  const projection = projectDailyMapCredits(31 * 60_000);
  assert.equal(projection['1'].scoutActivityMinutes, 30);
  assert.equal(projection['1'].todayTime, 120);
  assert.equal(projection['1'].mapUnits, 0);
  assert.equal(projection['1'].pendingMinutes, 120);
});
