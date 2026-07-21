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
  assert.equal(projection['1'].validMaps, 0);
  assert.equal(Object.keys(state.mapMinuteBalances['1']).length, 9);
});

test('un mapa pendiente completa su hora en otro día', () => {
  state.historialDia = sessions('1', 1, 30);
  commitDailyMapCredits(31 * 60_000);

  state.historialDia = sessions('1', 1, 30, 100_000);
  const projection = projectDailyMapCredits(2_000_000);
  assert.equal(projection['1'].validMaps, 1);
  assert.deepEqual(projection['1'].pending, {});
});

test('el resumen diario no convierte un saldo anterior en un mapa extra', () => {
  state.historialDia = sessions('1', 1, 30);
  commitDailyMapCredits(31 * 60_000);

  state.historialDia = sessions('1', 1, 30, 100_000);
  const summaryProjection = projectDailyMapCredits(2_000_000, { includeBalances: false });
  assert.equal(summaryProjection['1'].validMaps, 0);
});

test('una hora en tres mapas y tres horas en seis mapas acreditan nueve mapas', () => {
  state.historialDia = sessions('1', 3, 60, 1_000, 'Dia 1');
  const first = commitDailyMapCredits(61 * 60_000);
  assert.equal(first['1'].validMaps, 3);

  state.historialDia = sessions('1', 6, 180, 100_000, 'Dia 2');
  const second = projectDailyMapCredits(20_000_000);
  assert.equal(second['1'].validMaps, 6);
});

test('los saldos o sesiones de un mapa retirado no aparecen en el resumen vigente', () => {
  state.mapas = { Lymhurst: ['Vigente'] };
  state.mapMinuteBalances = { '1': { 'Lymhurst__Retirado': 45 } };
  state.historialDia = [{
    userId: '1', username: 'Scout', ciudad: 'Lymhurst', mapa: 'Retirado',
    inicio: 1_000, fin: 46 * 60_000,
  }];

  const projection = projectDailyMapCredits(47 * 60_000);
  assert.equal(projection['1'].validMaps, 0);
  assert.deepEqual(projection['1'].pending, {});
});
