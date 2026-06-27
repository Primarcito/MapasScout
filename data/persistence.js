const fs = require('fs');
const path = require('path');
const config = require('../config');
const state = require('./state');

const ROOT = config.DATA_DIR || path.join(__dirname, '..');

function ensureRoot() {
  if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });
}

function guardarDatos() {
  ensureRoot();
  fs.writeFileSync(
    path.join(ROOT, config.DATA_FILE),
    JSON.stringify({
      mapas: state.mapas,
      registros: state.registros,
      ultimaEdicion: state.ultimaEdicion,
      verificationMode: state.verificationMode,
    }, null, 2)
  );
}

function cargarDatos() {
  const filePath = path.join(ROOT, config.DATA_FILE);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    state.mapas = data.mapas || state.mapas;
    state.registros = data.registros || {};
    state.ultimaEdicion = data.ultimaEdicion || null;
    state.verificationMode = data.verificationMode || state.verificationMode;
  }
}

function guardarScouts() {
  ensureRoot();
  fs.writeFileSync(
    path.join(ROOT, config.SCOUT_FILE),
    JSON.stringify({
      activos: state.scoutsActivos,
      historial: state.historialScouts,
      ultimosMapas: state.ultimosMapas,
      historialDia: state.historialDia
    }, null, 2)
  );
}

function cargarScouts() {
  const filePath = path.join(ROOT, config.SCOUT_FILE);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    state.scoutsActivos = data.activos || {};
    state.historialScouts = data.historial || [];
    state.ultimosMapas = data.ultimosMapas || {};
    state.historialDia = data.historialDia || [];
  }
}

function guardarPanel() {
  ensureRoot();
  fs.writeFileSync(
    path.join(ROOT, config.PANEL_FILE),
    JSON.stringify({ channelId: state.panelChannelId, messageId: state.panelMessageId }, null, 2)
  );
}

function cargarPanel() {
  const filePath = path.join(ROOT, config.PANEL_FILE);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    state.panelChannelId = data.channelId;
    state.panelMessageId = data.messageId;
  }
}

function guardarRevisionPanel() {
  ensureRoot();
  fs.writeFileSync(
    path.join(ROOT, config.REVISION_PANEL_FILE),
    JSON.stringify({ messageId: state.revisionMessageId }, null, 2)
  );
}

function cargarRevisionPanel() {
  const filePath = path.join(ROOT, config.REVISION_PANEL_FILE);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    state.revisionMessageId = data.messageId || null;
  }
}

module.exports = {
  guardarDatos,
  cargarDatos,
  guardarScouts,
  cargarScouts,
  guardarPanel,
  cargarPanel,
  guardarRevisionPanel,
  cargarRevisionPanel
};
