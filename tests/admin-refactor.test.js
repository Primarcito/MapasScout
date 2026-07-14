const test = require('node:test');
const assert = require('node:assert/strict');

const state = require('../data/state');
const permissions = require('../permissions');
const mapasCommand = require('../commands/mapas');
const configurarCommand = require('../commands/mapasConfigurar');
const scoutCommand = require('../commands/scout');
const exportarCommand = require('../commands/mapasExportar');
const adminCommand = require('../commands/admin');
const { parseBulkMapInput, mapChangesDiff } = require('../utils/mapManagement');
const { cerrarScoutsActivosFiltrados } = require('../utils/scouts');
const { adminPanel, adminScoutsPanel, adminVerificationsPanel, adminRevisionsPanel } = require('../components/adminComponents');

function memberWith(...roles) {
  return { roles: { cache: { has: id => roles.includes(id) } } };
}

test('la jerarquia separa prio operativo de GM u Officer', () => {
  const prio = memberWith('1506387790265581588');
  const senior = memberWith('1435778823743340652');
  assert.equal(permissions.canUseAdmin(prio), true);
  assert.equal(permissions.canManageMaps(prio), true);
  assert.equal(permissions.canManageSensitiveScoutData(prio), false);
  assert.equal(permissions.canUseAdmin(senior), true);
  assert.equal(permissions.canManageSensitiveScoutData(senior), true);
});

test('los comandos usan palabras individuales con el prefijo mapas', () => {
  const names = [mapasCommand, configurarCommand, scoutCommand, exportarCommand, adminCommand]
    .map(command => command.data.toJSON().name);
  assert.deepEqual(names, ['mapas', 'mapas-configurar', 'mapas-historial', 'mapas-exportar', 'mapas-gestionar']);
  for (const command of [mapasCommand, configurarCommand, scoutCommand, exportarCommand, adminCommand]) {
    assert.equal(command.data.toJSON().options?.length || 0, 0);
  }
});

test('el panel operativo no muestra acciones sensibles', () => {
  const ids = payload => payload.components.flatMap(row => row.components.map(button => button.data.custom_id));
  const mainIds = ids(adminPanel({ sensitive: true }));
  const operatorIds = [adminScoutsPanel({ sensitive: false }), adminVerificationsPanel({ sensitive: false }), adminRevisionsPanel({ sensitive: false })].flatMap(ids);
  const seniorIds = [adminScoutsPanel({ sensitive: true }), adminVerificationsPanel({ sensitive: true }), adminRevisionsPanel({ sensitive: true })].flatMap(ids);
  assert.deepEqual(mainIds, ['admin_section_scouts', 'admin_section_verifications', 'admin_section_revisions', 'admin_audit']);
  assert.equal(operatorIds.includes('admin_assign_hours'), false);
  assert.equal(operatorIds.includes('admin_multipliers'), false);
  assert.equal(seniorIds.includes('admin_assign_hours'), true);
  assert.equal(seniorIds.includes('admin_multipliers'), true);
});

test('la importacion reconoce ciudades y genera un diferencial', () => {
  const previous = state.mapas;
  state.mapas = {
    Lymhurst: ['Old Map'],
    Bridgewatch: [],
    'Fort Sterling': [],
    Thetford: [],
    Martlock: [],
    'Zona Roja': [],
  };
  try {
    const changes = parseBulkMapInput('Lymhurst:\nOld Map\nNew Map\n\nThetford:\n0 mapas');
    const diff = mapChangesDiff(changes);
    assert.deepEqual(changes.Lymhurst, ['Old Map', 'New Map']);
    assert.deepEqual(changes.Thetford, []);
    assert.deepEqual(diff.find(item => item.city === 'Lymhurst').added, ['New Map']);
    assert.deepEqual(diff.find(item => item.city === 'Lymhurst').kept, ['Old Map']);
  } finally {
    state.mapas = previous;
  }
});

test('cerrar un mapa eliminado conserva las demás sesiones activas', () => {
  const previousActive = state.scoutsActivos;
  const previousHistory = state.historialScouts;
  const previousDay = state.historialDia;
  const previousCoverage = state.coberturaDia;
  const now = Date.now();
  state.scoutsActivos = {
    user1: [
      { ciudad: 'Lymhurst', mapa: 'Removed', inicio: now - 600000, username: 'Scout' },
      { ciudad: 'Lymhurst', mapa: 'Kept', inicio: now - 600000, username: 'Scout' },
    ],
  };
  state.historialScouts = [];
  state.historialDia = [];
  state.coberturaDia = {};
  try {
    const closed = cerrarScoutsActivosFiltrados('user1', entry => entry.mapa === 'Removed', 'Scout', 'map_removed', now);
    assert.equal(closed.length, 1);
    assert.deepEqual(state.scoutsActivos.user1.map(entry => entry.mapa), ['Kept']);
    assert.equal(state.historialDia.length, 1);
    assert.equal(state.historialDia[0].mapa, 'Removed');
  } finally {
    state.scoutsActivos = previousActive;
    state.historialScouts = previousHistory;
    state.historialDia = previousDay;
    state.coberturaDia = previousCoverage;
  }
});
