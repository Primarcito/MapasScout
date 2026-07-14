const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapasbot-test-'));
process.env.DATA_DIR = tempDir;

const state = require('../data/state');
const { applyMapChanges, scheduleMapChanges } = require('../utils/mapManagement');

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

test('aplicar una edición conserva mapas iguales y acredita el mapa eliminado', async () => {
  const now = Date.now();
  state.mapas = {
    Lymhurst: ['Removed', 'Kept'],
    Bridgewatch: [],
    'Fort Sterling': [],
    Thetford: [],
    Martlock: [],
    'Zona Roja': [],
  };
  state.registros = { Lymhurst: { Removed: ['user1'], Kept: ['user1'] } };
  state.scoutsActivos = {
    user1: [
      { ciudad: 'Lymhurst', mapa: 'Removed', inicio: now - 600000, username: 'Scout' },
      { ciudad: 'Lymhurst', mapa: 'Kept', inicio: now - 600000, username: 'Scout' },
    ],
  };
  state.historialScouts = [];
  state.historialDia = [];
  state.coberturaDia = {};
  state.mapasEnAlerta = {};
  state.revisionScores = {};
  state.logAdmin = [];
  state.client = null;
  state.panelMessage = null;
  state.panelChannelId = null;

  const result = await applyMapChanges(
    { Lymhurst: ['Kept', 'Added'] },
    { id: 'admin1', name: 'Admin' },
    { now }
  );

  assert.deepEqual(state.mapas.Lymhurst, ['Kept', 'Added']);
  assert.deepEqual(state.registros.Lymhurst.Kept, ['user1']);
  assert.deepEqual(state.registros.Lymhurst.Added, []);
  assert.deepEqual(state.scoutsActivos.user1.map(entry => entry.mapa), ['Kept']);
  assert.equal(state.historialDia.at(-1).mapa, 'Removed');
  assert.deepEqual(result.affectedUsers, ['user1']);
});

test('programar mapas guarda una configuración completa para el siguiente período', () => {
  scheduleMapChanges({ Thetford: ['Future Map'] }, { id: 'admin1', name: 'Admin' });
  assert.equal(state.scheduledMaps.maps.Thetford[0], 'Future Map');
  assert.deepEqual(state.scheduledMaps.maps.Lymhurst, ['Kept', 'Added']);
  assert.equal(fs.existsSync(path.join(tempDir, 'data.json')), true);
});
