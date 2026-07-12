const test = require('node:test');
const assert = require('node:assert/strict');

const state = require('../data/state');
const {
  normalizarNombreMapa,
  normalizarListaMapas,
  normalizarRegistros,
} = require('../utils/mapNames');
const { guardarUltimosMapas } = require('../utils/scouts');
const { obtenerAlertasVigentes } = require('../utils/alerts');
const { generarEmbeds } = require('../embeds/panelEmbed');
const { cityTextEmoji, cityButtonEmoji } = require('../emojis');

function resetState() {
  state.mapas = { Lymhurst: [] };
  state.registros = {};
  state.scoutsActivos = {};
  state.ultimosMapas = {};
  state.mapasEnAlerta = {};
  state.coberturaDia = {};
}

test.beforeEach(resetState);

test('normaliza mayúsculas, espacios y emojis de estado', () => {
  assert.equal(normalizarNombreMapa('  🚨  sunkebough   spring '), 'Sunkebough Spring');
  assert.deepEqual(
    normalizarListaMapas(['southgrove copse', '⚠️ Southgrove Copse', 'deepwood copse']),
    ['Southgrove Copse', 'Deepwood Copse']
  );
});

test('migra registros normalizados sin perder ni duplicar usuarios', () => {
  assert.deepEqual(normalizarRegistros({
    Lymhurst: {
      'rivercopse path': ['1', '2'],
      '🚨 Rivercopse Path': ['2', '3'],
    },
  }), {
    Lymhurst: { 'Rivercopse Path': ['1', '2', '3'] },
  });
});

test('Mis mapas une registros y sesiones activas en una foto completa', () => {
  state.registros = {
    Lymhurst: { 'Mapa Uno': ['42'] },
    Thetford: { 'Mapa Dos': ['42'] },
  };
  state.scoutsActivos = {
    42: [
      { ciudad: 'Lymhurst', mapa: 'mapa uno', inicio: 1 },
      { ciudad: 'Martlock', mapa: 'mapa tres', inicio: 2 },
    ],
  };

  assert.deepEqual(guardarUltimosMapas('42'), [
    { ciudad: 'Lymhurst', mapa: 'Mapa Uno' },
    { ciudad: 'Thetford', mapa: 'Mapa Dos' },
    { ciudad: 'Martlock', mapa: 'Mapa Tres' },
  ]);
});

test('la alerta consolidada descarta mapas inexistentes o ya cubiertos', () => {
  state.mapas = { Lymhurst: ['Solo', 'Cubierto'] };
  state.registros = { Lymhurst: { Solo: [], Cubierto: ['42'] } };
  state.mapasEnAlerta = {
    'Lymhurst__Solo': { ciudad: 'Lymhurst', mapa: 'Solo', vacioDesde: 10 },
    'Lymhurst__Cubierto': { ciudad: 'Lymhurst', mapa: 'Cubierto', vacioDesde: 20 },
    'Lymhurst__Viejo': { ciudad: 'Lymhurst', mapa: 'Viejo', vacioDesde: 30 },
  };

  assert.deepEqual(obtenerAlertasVigentes().map(a => a.mapa), ['Solo']);
  assert.deepEqual(Object.keys(state.mapasEnAlerta), ['Lymhurst__Solo']);
});

test('el panel nunca muestra alerta roja si el mapa tiene un scout', () => {
  state.mapas = { Lymhurst: ['Rivercopse Path'] };
  state.registros = { Lymhurst: { 'Rivercopse Path': ['42'] } };
  state.scoutsActivos = {
    42: [{ ciudad: 'Lymhurst', mapa: 'Rivercopse Path', inicio: Date.now() - 60000 }],
  };
  state.mapasEnAlerta = {
    'Lymhurst__Rivercopse Path': {
      ciudad: 'Lymhurst',
      mapa: 'Rivercopse Path',
      vacioDesde: Date.now() - 3600000,
    },
  };

  const description = generarEmbeds()[0].data.description;
  assert.match(description, /Rivercopse Path/);
  assert.doesNotMatch(description, /🚨/u);
});

test('los emotes cargados usan sus IDs y aceptan una sobrescritura', () => {
  assert.equal(cityTextEmoji('Lymhurst'), '<:mapas_lymhurst:1525672651853398106>');
  assert.equal(cityButtonEmoji('Ciudad Desconocida'), '📍');

  process.env.EMOJI_MAPAS_LYMHURST_ID = '123456789';
  assert.equal(cityTextEmoji('Lymhurst'), '<:mapas_lymhurst:123456789>');
  assert.deepEqual(cityButtonEmoji('Lymhurst'), {
    id: '123456789',
    name: 'mapas_lymhurst',
  });
  delete process.env.EMOJI_MAPAS_LYMHURST_ID;
});

test('los 16 emotes tienen IDs de Discord únicos y válidos', () => {
  const { DEFINITIONS } = require('../emojis');
  const expectedIds = {
    MAP: '1525672654739079178',
    JOIN: '1525672650054303776',
    DROP: '1525672642332594251',
    RETURN: '1525672658954489876',
    REVIEW: '1525672660863029402',
    ACTIVE: '1525672626700288130',
    EMPTY: '1525672644245061722',
    FULL: '1525672648309346334',
    ALERT: '1525672637538504815',
    VERIFIED: '1525672664834900148',
    LYMHURST: '1525672651853398106',
    BRIDGEWATCH: '1525672640260341801',
    FORT_STERLING: '1525672646392418524',
    THETFORD: '1525672662968303616',
    MARTLOCK: '1525672657121706114',
    ZONA_ROJA: '1525672666604769381',
  };
  assert.deepEqual(
    Object.fromEntries(Object.entries(DEFINITIONS).map(([key, definition]) => [key, definition.id])),
    expectedIds
  );
  const ids = Object.values(DEFINITIONS).map(definition => definition.id);
  assert.equal(ids.length, 16);
  assert.equal(new Set(ids).size, 16);
  ids.forEach(id => assert.match(id, /^\d{17,20}$/));
});

test('existe el comando directo /revisar', () => {
  const commands = require('../commands/register').getCommandsMap();
  assert.equal(commands.has('revisar'), true);
});
