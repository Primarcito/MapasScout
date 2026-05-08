const { EmbedBuilder } = require('discord.js');
const state = require('../data/state');
const config = require('../config');

function calcularColorEmbed() {
  let total = 0, cubiertos = 0;
  for (const ciudad in state.mapas) {
    state.mapas[ciudad].forEach(mapa => {
      total++;
      const users = state.registros[ciudad]?.[mapa] || [];
      if (users.length > 0) cubiertos++;
    });
  }
  if (total === 0) return 0xe91e63;
  const pct = cubiertos / total;
  if (pct >= 0.8) return 0x57f287;
  if (pct >= 0.4) return 0xfee75c;
  return 0xe91e63;
}

function generarEmbed() {
  let totalMapas = 0;
  let mapasCubiertos = 0;
  for (const c in state.mapas) {
    if (state.mapas[c]) {
      state.mapas[c].forEach(m => {
        totalMapas++;
        const users = state.registros[c]?.[m] || [];
        // Consider covered if someone is active now or has been active
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
  const hora = new Date().toISOString().slice(11, 16);

  const embed = new EmbedBuilder()
    .setTitle("🗺️ Mapas del Día")
    .setColor(calcularColorEmbed())
    .setFooter({ text: `📊 ${pct}% cobertura (${mapasCubiertos}/${totalMapas}) • Actualizado ${hora} UTC` });

  const totalScoutsActivos = Object.keys(state.scoutsActivos).length;
  const descBase = "Usa el botón **Anotarse** para registrarte en un mapa.\nMáximo 5 scouts por mapa.";
  const descActivos = totalScoutsActivos > 0 ? `\n👥 **${totalScoutsActivos} scout${totalScoutsActivos > 1 ? "s" : ""} activo${totalScoutsActivos > 1 ? "s" : ""}**` : "";
  embed.setDescription(descBase + descActivos);

  const ahora30 = Date.now();
  let hayMapas = false;

  for (const ciudad in state.mapas) {
    if (!state.mapas[ciudad] || state.mapas[ciudad].length === 0) continue;
    hayMapas = true;
    let texto = "";

    state.mapas[ciudad].forEach(mapa => {
      const users = state.registros[ciudad]?.[mapa] || [];
      const menciones = users.map(id => {
        const entrada = state.scoutsActivos[id]?.find(e => e.ciudad === ciudad && e.mapa === mapa);
        if (entrada) {
          const mins = Math.floor((ahora30 - entrada.inicio) / 60000);
          const horas = Math.floor(mins / 60);
          const m = mins % 60;
          const t = horas > 0 ? `${horas}h${m}m` : `${m}m`;
          return `<@${id}> ⏱️${t}`;
        }
        return `<@${id}>`;
      }).join(" ");
      const lleno = users.length >= 5;

      const sinScouts = users.length === 0;
      const cobKey = `${ciudad}__${mapa}`;
      const ultimaActividad = state.coberturaDia[cobKey]?.ultimaActividad || null;
      const minsVacio = sinScouts && ultimaActividad ? Math.floor((ahora30 - ultimaActividad) / 60000) : 0;
      const alerta = sinScouts && minsVacio > 30;

      const prefijo = lleno ? "🔴 " : alerta ? "🚨 " : "- ";
      texto += `${prefijo}**${mapa}** → ${menciones}\n`;
    });

    embed.addFields({
      name: `${config.ICONOS_CIUDAD[ciudad] || "📍"} ${ciudad}`,
      value: texto,
      inline: false
    });
  }

  if (!hayMapas) {
    embed.addFields({
      name: "Sin mapas configurados",
      value: "Un admin debe usar `/editar_mapas` para agregar mapas.",
      inline: false
    });
  }

  embed.addFields({
    name: "​",
    value: "📋 Usa `!revisar` para revisar los mapas por 15 minutos.",
    inline: false
  });

  return embed;
}

module.exports = { calcularColorEmbed, generarEmbed };
