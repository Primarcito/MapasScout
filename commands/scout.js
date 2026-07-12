const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const state = require('../data/state');
const config = require('../config');
const { canReview, canExport } = require('../permissions');
const { crearPanelRevisionMovil } = require('../utils/panel');
const { calcularTiempoReal } = require('../utils/timeCalc');
const { getRevisionMultiplier, beginRevisionRound } = require('../utils/revisionRounds');

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

function generarEmbedHistorial() {
  return generarEmbedsHistorial()[0];
}

function generarEmbedsHistorial() {
  // Combinar historialDia con sesiones activas
  const todasSesiones = [...state.historialDia];

  for (const userId in state.scoutsActivos) {
    const entradas = state.scoutsActivos[userId];
    entradas.forEach(entry => {
      todasSesiones.push({
        userId,
        username: entry.username || userId,
        ciudad: entry.ciudad,
        mapa: entry.mapa,
        inicio: entry.inicio,
        fin: Date.now() // Treat active as ending now for calculation
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
        activo: false
      };
    }
    porUsuario[key].mapasUnicos.add(`${s.ciudad}__${s.mapa}`);
    porUsuario[key].sesiones.push({ inicio: s.inicio, fin: s.fin });
  });

  // Calculate real time for each user
  let totalMinutosGlobal = 0;
  for (const key in porUsuario) {
    const u = porUsuario[key];
    u.totalMin = calcularTiempoReal(u.sesiones);
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
    const numMapas = u.mapasUnicos.size;
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

async function enviarEmbedsPaginados(interaction, embeds) {
  await interaction.reply({ embeds: [embeds[0]] });

  for (const embed of embeds.slice(1)) {
    await interaction.followUp({ embeds: [embed] });
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("scout")
    .setDescription("Comandos para scouts: historial, revisión y exportación")
    .addSubcommand(subcmd => 
      subcmd.setName("historial")
        .setDescription("Ver el resumen y ranking de scouts del día")
    )
    .addSubcommand(subcmd => 
      subcmd.setName("revisar")
        .setDescription("Crear el panel interactivo de revisión de mapas")
    )
    .addSubcommand(subcmd => 
      subcmd.setName("exportar")
        .setDescription("Exportar el historial del día como CSV (solo líderes)")
    ),

  generarEmbedHistorial,
  generarEmbedsHistorial,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    /* ===== HISTORIAL ===== */
    if (sub === "historial") {
      const embeds = generarEmbedsHistorial();
      return enviarEmbedsPaginados(interaction, embeds);
    }

    /* ===== REVISAR ===== */
    if (sub === "revisar") {
      if (!canReview(interaction.member)) {
        return interaction.reply({
          content: "Necesitas el rol Scout para usar este comando.",
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { created } = await beginRevisionRound();
      await crearPanelRevisionMovil(interaction.channel);
      return interaction.editReply(created
        ? 'Ronda de 20 minutos iniciada y panel de revisión publicado en este canal.'
        : 'Panel de revisión actualizado en este canal; la ronda actual continúa.');
    }

    /* ===== EXPORTAR ===== */
    if (sub === "exportar") {
      if (!canExport(interaction.member)) {
        return interaction.reply({
          content: "Necesitas el rol Líder para usar este comando.",
          flags: MessageFlags.Ephemeral
        });
      }

      if (state.historialDia.length === 0) {
        return interaction.reply({
          content: "No hay actividad registrada hoy.",
          flags: MessageFlags.Ephemeral
        });
      }

      const fecha = new Date().toISOString().split("T")[0];
      let csv = "Usuario,Mapa,Ciudad,Entrada UTC,Salida UTC,Duracion (min)\n";
      state.historialDia.forEach(s => {
        const entrada = new Date(s.inicio).toISOString().replace("T", " ").slice(0, 19);
        const salida = s.fin ? new Date(s.fin).toISOString().replace("T", " ").slice(0, 19) : "activo";
        csv += `${s.username || s.userId},${s.mapa},${s.ciudad},${entrada},${salida},${s.duracionMin}\n`;
      });

      const buffer = Buffer.from(csv, "utf-8");

      return interaction.reply({
        content: `📊 Historial del día ${fecha}`,
        files: [{ attachment: buffer, name: `historial_${fecha}.csv` }],
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
