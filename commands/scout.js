const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const state = require('../data/state');
const config = require('../config');
const { canReview, canExport } = require('../permissions');
const { componentesRevision } = require('../components/revisionComponents');
const { generarEmbedRevision } = require('../embeds/revisionEmbed');
const { calcularTiempoReal } = require('../utils/timeCalc');

function generarEmbedHistorial() {
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
  }

  // Ordenar por tiempo total
  const sorted = Object.values(porUsuario).sort((a, b) => b.totalMin - a.totalMin);

  const medallas = ["🥇", "🥈", "🥉"];
  let texto = "";
  
  if (sorted.length === 0) {
    texto = "No hay actividad registrada hoy.";
  } else {
    sorted.forEach((u, index) => {
      const horas = Math.floor(u.totalMin / 60);
      const mins = u.totalMin % 60;
      const tiempo = horas > 0 ? `${horas}h ${mins}m` : `${mins}m`;
      const numMapas = u.mapasUnicos.size;
      const estado = u.activo ? "🟢" : "⚪";
      const medalla = index < 3 ? medallas[index] : `${index + 1}.`;
      
      texto += `${medalla} **${u.username}** — ${tiempo} • ${numMapas} mapa${numMapas > 1 ? 's' : ''} • ${estado}\n`;
    });
  }

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

  const desc = `**${fechaHoy}**\n\n👥 ${sorted.length} scouts  •  ⏱️ ${tiempoGlobal}  •  🗺️ ${mapasCubiertos}/${totalMapas}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${texto}\n\n📊 **${pct}% cobertura** • Se reinicia a las 10 UTC`;

  return new EmbedBuilder()
    .setTitle("📊 Resumen del Día")
    .setColor(0x2b2d31)
    .setDescription(desc);
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

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    /* ===== HISTORIAL ===== */
    if (sub === "historial") {
      const embed = generarEmbedHistorial();
      return interaction.reply({ embeds: [embed] });
    }

    /* ===== REVISAR ===== */
    if (sub === "revisar") {
      if (!canReview(interaction.member)) {
        return interaction.reply({
          content: "Necesitas el rol Scout para usar este comando.",
          flags: MessageFlags.Ephemeral
        });
      }

      const comps = componentesRevision();

      if (comps.length === 0) {
        return interaction.reply({
          content: "No hay scouts anotados en ningún mapa.",
          flags: MessageFlags.Ephemeral
        });
      }

      const revisionReply = await interaction.reply({
        embeds: [generarEmbedRevision()],
        components: comps,
        withResponse: true
      });
      state.revisionMessage = revisionReply.resource.message;
      return;
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
