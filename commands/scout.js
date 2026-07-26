const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const state = require('../data/state');
const { calcularTiempoReal } = require('../utils/timeCalc');
const { getRevisionMultiplier } = require('../utils/revisionRounds');
const { projectDailyMapCredits } = require('../utils/mapCredits');

const EMBED_SAFE_DESCRIPTION_LIMIT = 3900;

function crearEmbedHistorial(desc, page = 1, totalPages = 1) {
  const title = totalPages > 1
    ? `📊 Resumen del Día ${page}/${totalPages}`
    : "📊 Resumen del Día";

  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0x2b2d31)
    .setDescription(desc);
}

function dividirEnEmbedsHistorial(header, lines, footer) {
  const paginas = [];
  let paginaActual = [];

  const crearDescripcion = (pageLines) => `${header}\n\n${pageLines.join("")}\n${footer}`;

  if (lines.length === 0) {
    return [crearEmbedHistorial(crearDescripcion(["No hay actividad registrada hoy.\n"]))];
  }

  for (const line of lines) {
    const propuesta = [...paginaActual, line];
    if (paginaActual.length > 0 && crearDescripcion(propuesta).length > EMBED_SAFE_DESCRIPTION_LIMIT) {
      paginas.push(paginaActual);
      paginaActual = [line];
    } else {
      paginaActual = propuesta;
    }
  }

  if (paginaActual.length > 0) paginas.push(paginaActual);

  const totalPages = paginas.length;
  return paginas.map((pageLines, index) => (
    crearEmbedHistorial(crearDescripcion(pageLines), index + 1, totalPages)
  ));
}

function generarEmbedHistorial(now = Date.now()) {
  return generarEmbedsHistorial(now)[0];
}

function formatMinutes(minutes) {
  const safeMinutes = Math.max(0, Math.floor(Number(minutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function crearEmbedActividadPersonal(userId, now = Date.now()) {
  const id = String(userId);
  const sessions = [];
  let manualMinutes = 0;
  for (const entry of state.historialDia || []) {
    if (!entry || entry.provisional || String(entry.userId) !== id) continue;
    if (entry.manualTimeAdjustment) manualMinutes += Number(entry.duracionMin) || 0;
    else sessions.push({ inicio: entry.inicio, fin: entry.fin || now });
  }
  for (const entry of state.scoutsActivos?.[id] || []) {
    if (!entry?.provisional) sessions.push({ inicio: entry.inicio, fin: now });
  }
  const todayMinutes = Math.max(0, calcularTiempoReal(sessions) + manualMinutes);
  const savedMinutes = Math.max(0, Number(state.timeMinuteBalances?.[id]) || 0);
  const accumulatedMinutes = todayMinutes + savedMinutes;
  return new EmbedBuilder()
    .setTitle('Tu actividad hasta ahora')
    .setColor(0x5865f2)
    .addFields(
      { name: 'Tiempo de hoy', value: `**${formatMinutes(todayMinutes)}**`, inline: true },
      { name: 'Saldo acumulado', value: `Guardado: **${formatMinutes(savedMinutes)}**\nTotal: **${formatMinutes(accumulatedMinutes)} / 4h**`, inline: true },
    );
}

function generarEmbedsHistorial(summaryNow = Date.now()) {
  // minutos de otro período en mapas extra dentro del resumen de hoy.
  // Los saldos pendientes se conservan internamente, pero no convierten
  const mapCredits = projectDailyMapCredits(summaryNow, { includeBalances: false });
  // Combinar historialDia con sesiones activas
  const todasSesiones = state.historialDia.filter(entry => !entry.provisional);

  for (const userId in state.scoutsActivos) {
    const entradas = state.scoutsActivos[userId];
    entradas.filter(entry => !entry.provisional).forEach(entry => {
      todasSesiones.push({
        userId,
        username: entry.username || userId,
        ciudad: entry.ciudad,
        mapa: entry.mapa,
        inicio: entry.inicio,
        fin: summaryNow // Treat active as ending now for calculation
      });
    });
  }

  // Agrupar por usuario
  const porUsuario = {};
  todasSesiones.forEach(s => {
    const key = s.userId;
    if (!porUsuario[key]) {
      porUsuario[key] = {
        userId: key,
        username: s.username || s.userId,
        mapasUnicos: new Set(),
        sesiones: [],
        minutosManuales: 0,
        activo: false
      };
    }
    if (s.manualTimeAdjustment) {
      porUsuario[key].minutosManuales += Number(s.duracionMin) || 0;
    } else {
      porUsuario[key].mapasUnicos.add(`${s.ciudad}__${s.mapa}`);
      porUsuario[key].sesiones.push({ inicio: s.inicio, fin: s.fin });
    }
  });

  // Calculate real time for each user
  let totalMinutosGlobal = 0;
  for (const key in porUsuario) {
    const u = porUsuario[key];
    u.totalMin = Math.max(0, calcularTiempoReal(u.sesiones) + u.minutosManuales);
    totalMinutosGlobal += u.totalMin;
    // Check if active now
    if (state.scoutsActivos[key] && state.scoutsActivos[key].length > 0) {
      u.activo = true;
    }
    u.multiplier = getRevisionMultiplier(key);
    const score = state.revisionScores[key] || {
      misses: 0,
      eligibleRounds: 0,
      compliantRounds: 0,
      multiplier: 1,
    };
    score.username = u.username;
    state.revisionScores[key] = score;
  }

  // Mapas solo reporta actividad. RankingBot calcula y escala los puntos al aprobar.
  const sorted = Object.values(porUsuario).sort((a, b) => b.totalMin - a.totalMin);

  const medallas = ["🥇", "🥈", "🥉"];
  const lineasRanking = [];
  
  sorted.forEach((u, index) => {
    const horas = Math.floor(u.totalMin / 60);
    const mins = u.totalMin % 60;
    const tiempo = horas > 0 ? `${horas}h ${mins}m` : `${mins}m`;
    const numMapas = mapCredits[u.userId]?.validMaps || 0;
    const estado = u.activo ? "🟢" : "⚪";
    const medalla = index < 3 ? medallas[index] : `${index + 1}.`;

    lineasRanking.push(
      `${medalla} **${u.username}** — ${tiempo} · x${u.multiplier.toFixed(2)} · ` +
      `${numMapas} mapa${numMapas > 1 ? 's' : ''} · ${estado}\n`
    );
  });

  // Calculate coverage for summary
  let totalMapas = 0;
  let mapasCubiertos = 0;
  for (const c in state.mapas) {
    if (state.mapas[c]) {
      state.mapas[c].forEach(m => {
        totalMapas++;
        const users = state.registros[c]?.[m] || [];
        const key = `${c}__${m}`;
        const minActivo = state.coberturaDia[key]?.minutos || 0;
        let alguienActivo = false;
        for (const userId in state.scoutsActivos) {
          if (state.scoutsActivos[userId].some(e => e.ciudad === c && e.mapa === m)) {
            alguienActivo = true;
            break;
          }
        }
        if (users.length > 0 || minActivo > 0 || alguienActivo) mapasCubiertos++;
      });
    }
  }
  const pct = totalMapas > 0 ? Math.round((mapasCubiertos / totalMapas) * 100) : 0;

  const horasGlobal = Math.floor(totalMinutosGlobal / 60);
  const minsGlobal = totalMinutosGlobal % 60;
  const tiempoGlobal = horasGlobal > 0 ? `${horasGlobal}h ${minsGlobal}min` : `${minsGlobal}min`;
  
  const opcionesFecha = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' };
  const fechaHoy = new Date().toLocaleDateString('es-ES', opcionesFecha);

  const header = `**${fechaHoy}**\n\n👥 ${sorted.length} scouts  •  ⏱️ ${tiempoGlobal}  •  🗺️ ${mapasCubiertos}/${totalMapas}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  const footer = `📊 **${pct}% cobertura** • Se reinicia a las 10 UTC`;

  return dividirEnEmbedsHistorial(header, lineasRanking, footer);
}

async function enviarEmbedsPaginados(interaction, embeds, { ephemeral = false } = {}) {
  const visibility = ephemeral ? { flags: MessageFlags.Ephemeral } : {};
  await interaction.reply({ embeds: [embeds[0]], ...visibility });

  for (const embed of embeds.slice(1)) {
    await interaction.followUp({ embeds: [embed], ...visibility });
  }
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sesionesExportables(now = Date.now()) {
  const rows = [...state.historialDia];
  for (const [userId, entries] of Object.entries(state.scoutsActivos || {})) {
    for (const entry of entries || []) {
      rows.push({
        userId,
        username: entry.username || userId,
        ciudad: entry.ciudad,
        mapa: entry.mapa,
        inicio: entry.inicio,
        fin: null,
        duracionMin: Math.max(0, Math.floor((now - entry.inicio) / 60000)),
      });
    }
  }
  return rows;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mapas-historial')
    .setDescription('Ver el resumen y ranking de scouts del día'),

  generarEmbedHistorial,
  generarEmbedsHistorial,
  crearEmbedActividadPersonal,
  csvCell,
  sesionesExportables,

  async execute(interaction) {
    const now = Date.now();
    return enviarEmbedsPaginados(interaction, [crearEmbedActividadPersonal(interaction.user.id, now), ...generarEmbedsHistorial(now)], { ephemeral: true });
  }
};
