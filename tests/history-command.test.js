const test = require('node:test');
const assert = require('node:assert/strict');

const state = require('../data/state');
const scoutCommand = require('../commands/scout');
const { crearEmbedActividadPersonal } = scoutCommand;

test('el historial personal muestra tiempo actual, saldo y responde de forma efimera', async () => {
  const previous = {
    historialDia: state.historialDia,
    scoutsActivos: state.scoutsActivos,
    timeMinuteBalances: state.timeMinuteBalances,
    mapas: state.mapas,
    registros: state.registros,
    coberturaDia: state.coberturaDia,
    revisionScores: state.revisionScores,
  };
  state.historialDia = [{ userId: '1', ciudad: 'Lymhurst', mapa: 'Uno', inicio: 1, fin: 90 * 60_000 + 1 }];
  state.scoutsActivos = {};
  state.timeMinuteBalances = { '1': 30 };
  state.mapas = { Lymhurst: ['Uno'] };
  state.registros = { Lymhurst: { Uno: ['1'] } };
  state.coberturaDia = {};
  state.revisionScores = {};
  try {
    const fields = crearEmbedActividadPersonal('1', 90 * 60_000 + 1).data.fields;
    assert.equal(fields.length, 2);
    assert.deepEqual(fields[0], { name: 'Tiempo de hoy', value: '**1h 30m**', inline: true });
    assert.deepEqual(fields[1], { name: 'Saldo acumulado', value: 'Guardado: **30m**\nTotal: **2h 0m / 4h**', inline: true });
    const replies = [];
    const followUps = [];
    await scoutCommand.execute({
      user: { id: '1' },
      async reply(payload) { replies.push(payload); },
      async followUp(payload) { followUps.push(payload); },
    });
    assert.equal(replies[0].flags, 64);
    assert.equal(replies[0].embeds.length, 2);
    assert.equal(followUps.length, 0);
  } finally {
    Object.assign(state, previous);
  }
});
