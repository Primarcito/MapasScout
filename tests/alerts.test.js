const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapasbot-alerts-'));
process.env.DATA_DIR = tempDir;

const state = require('../data/state');
const { verificarMapaVacio } = require('../utils/alerts');

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

test('una sola alerta se crea, edita y elimina según la cobertura', async () => {
  let sendCount = 0;
  let editCount = 0;
  let deleteCount = 0;
  let content = '';

  const message = {
    id: 'alert-1',
    async edit(payload) {
      editCount++;
      content = payload.content;
      return this;
    },
    async delete() {
      deleteCount++;
    },
  };
  const channel = {
    id: 'channel-1',
    messages: {
      async fetch(id) {
        assert.equal(id, 'alert-1');
        return message;
      },
    },
    async send(payload) {
      sendCount++;
      content = payload.content;
      return message;
    },
  };

  Object.assign(state, {
    client: { user: { id: 'bot' } },
    panelMessage: { channel },
    panelChannelId: channel.id,
    panelMessageId: 'panel-1',
    alertChannelId: channel.id,
    alertMessageId: null,
    legacyAlertsCleaned: true,
    mapas: { Lymhurst: ['Mapa Uno', 'Mapa Dos'] },
    registros: { Lymhurst: { 'Mapa Uno': [], 'Mapa Dos': [] } },
    mapasEnAlerta: {},
  });

  await verificarMapaVacio('Lymhurst', 'Mapa Uno');
  await verificarMapaVacio('Lymhurst', 'Mapa Dos');
  assert.equal(sendCount, 1);
  assert.equal(editCount, 1);
  assert.match(content, /Mapa Uno/);
  assert.match(content, /Mapa Dos/);

  state.registros.Lymhurst['Mapa Uno'] = ['42'];
  await verificarMapaVacio('Lymhurst', 'Mapa Uno');
  assert.doesNotMatch(content, /Mapa Uno/);
  assert.match(content, /Mapa Dos/);

  state.registros.Lymhurst['Mapa Dos'] = ['42'];
  await verificarMapaVacio('Lymhurst', 'Mapa Dos');
  assert.equal(deleteCount, 1);
  assert.equal(state.alertMessageId, null);
});
