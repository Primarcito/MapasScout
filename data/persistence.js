const fs = require('fs');
const path = require('path');
const config = require('../config');
const state = require('./state');
const {
  normalizarMapasPorCiudad,
  normalizarRegistros,
  normalizarReferenciasMapas,
  normalizarNombreMapa,
  normalizarAlertasMapas,
} = require('../utils/mapNames');

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
      mapasEnAlerta: state.mapasEnAlerta,
    }, null, 2)
  );
}

function cargarDatos() {
  const filePath = path.join(ROOT, config.DATA_FILE);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    state.mapas = normalizarMapasPorCiudad(data.mapas || state.mapas);
    state.registros = normalizarRegistros(data.registros || {});
    state.ultimaEdicion = data.ultimaEdicion || null;
    state.verificationMode = data.verificationMode || state.verificationMode;
    state.mapasEnAlerta = normalizarAlertasMapas(data.mapasEnAlerta || {});
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
      historialDia: state.historialDia,
      verificaciones: state.verificacionesScout,
    }, null, 2)
  );
}

function cargarScouts() {
  const filePath = path.join(ROOT, config.SCOUT_FILE);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    state.scoutsActivos = Object.fromEntries(
      Object.entries(data.activos || {}).map(([userId, entradas]) => [userId, normalizarReferenciasMapas(entradas)])
    );
    state.historialScouts = (data.historial || []).map(e => ({ ...e, mapa: normalizarNombreMapa(e.mapa) }));
    state.ultimosMapas = Object.fromEntries(
      Object.entries(data.ultimosMapas || {}).map(([userId, entradas]) => [userId, normalizarReferenciasMapas(entradas)])
    );
    state.historialDia = (data.historialDia || []).map(e => ({ ...e, mapa: normalizarNombreMapa(e.mapa) }));
    state.verificacionesScout = data.verificaciones || {};
  }
}

function guardarPanel() {
  ensureRoot();
  fs.writeFileSync(
    path.join(ROOT, config.PANEL_FILE),
    JSON.stringify({
      channelId: state.panelChannelId,
      messageId: state.panelMessageId,
      alertChannelId: state.alertChannelId,
      alertMessageId: state.alertMessageId,
    }, null, 2)
  );
}

function cargarPanel() {
  const filePath = path.join(ROOT, config.PANEL_FILE);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    state.panelChannelId = data.channelId;
    state.panelMessageId = data.messageId;
    state.alertChannelId = data.alertChannelId || data.channelId || null;
    state.alertMessageId = data.alertMessageId || null;
  }
}

function guardarRevisionPanel() {
  ensureRoot();
  fs.writeFileSync(
    path.join(ROOT, config.REVISION_PANEL_FILE),
    JSON.stringify({
      messageId: state.revisionMessageId,
      mobileMessageId: state.revisionMobileMessageId,
      mobileChannelId: state.revisionMobileChannelId,
      estado: state.revisionEstado,
      round: state.revisionRound,
      scores: state.revisionScores,
      history: state.revisionRoundHistory,
    }, null, 2)
  );
}

function cargarRevisionPanel() {
  const filePath = path.join(ROOT, config.REVISION_PANEL_FILE);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    state.revisionMessageId = data.messageId || null;
    state.revisionMobileMessageId = data.mobileMessageId || null;
    state.revisionMobileChannelId = data.mobileChannelId || null;
    state.revisionEstado = data.estado || {};
    state.revisionRound = data.round || null;
    state.revisionScores = data.scores || {};
    state.revisionRoundHistory = data.history || [];
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
