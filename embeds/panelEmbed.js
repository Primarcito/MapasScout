const { EmbedBuilder } = require('discord.js');
const state = require('../data/state');
const config = require('../config');

const MAX_EMBED_DESCRIPTION_LENGTH = 4096;
const MAX_EMBEDS_PER_MESSAGE = 10;

function dividirTextoPorLineas(texto, maxLength) {
  const partes = [];
  let actual = "";

  for (const linea of texto.split("\n")) {
    if (!linea) continue;

    const candidato = actual ? `${actual}\n${linea}` : linea;
    if (candidato.length <= maxLength) {
      actual = candidato;
      continue;
    }

    if (actual) {
      partes.push(actual);
      actual = "";
    }

    if (linea.length <= maxLength) {
      actual = linea;
      continue;
    }

    for (let i = 0; i < linea.length; i += maxLength) {
      partes.push(linea.slice(i, i + maxLength));
    }
  }

  if (actual) partes.push(actual);
  return partes.length > 0 ? partes : ["\u200b"];
}

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

function calcularResumenPanel() {
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

  return { totalMapas, mapasCubiertos };
}

function generarTextoCiudad(ciudad, ahora) {
  let texto = "";

  state.mapas[ciudad].forEach(mapa => {
    const users = state.registros[ciudad]?.[mapa] || [];
    const menciones = users.map(id => {
      const entrada = state.scoutsActivos[id]?.find(e => e.ciudad === ciudad && e.mapa === mapa);
      if (entrada) {
        const mins = Math.floor((ahora - entrada.inicio) / 60000);
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
    const minsVacio = sinScouts && ultimaActividad ? Math.floor((ahora - ultimaActividad) / 60000) : 0;
    const alerta = sinScouts && minsVacio > 30;

    const prefijo = lleno ? "🔴 " : alerta ? "🚨 " : "- ";
    texto += `${prefijo}**${mapa}** → ${menciones}\n`;
  });

  return texto;
}

function generarEmbeds() {
  const { totalMapas, mapasCubiertos } = calcularResumenPanel();
  const pct = totalMapas > 0 ? Math.round((mapasCubiertos / totalMapas) * 100) : 0;
  const hora = new Date().toISOString().slice(11, 16);

  const totalScoutsActivos = Object.keys(state.scoutsActivos).length;
  const descBase = "Usa el botón **Anotarse** para registrarte en un mapa.\nMáximo 5 scouts por mapa.";
  const descActivos = totalScoutsActivos > 0 ? `\n👥 **${totalScoutsActivos} scout${totalScoutsActivos > 1 ? "s" : ""} activo${totalScoutsActivos > 1 ? "s" : ""}**` : "";
  const encabezado = `${descBase}${descActivos}`;
  const pie = "📋 Usa `!revisar` para revisar los mapas por 15 minutos.";
  const embeds = [];
  const color = calcularColorEmbed();

  const ahora = Date.now();
  let hayMapas = false;
  let bloqueActual = encabezado;

  function agregarEmbedPanel(descripcion, esContinuacion = false) {
    if (embeds.length >= MAX_EMBEDS_PER_MESSAGE) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setDescription(descripcion);

    if (!esContinuacion) {
      embed.setTitle("🗺️ Mapas del Día");
      embed.setFooter({ text: `📊 ${pct}% cobertura (${mapasCubiertos}/${totalMapas}) • Actualizado ${hora} UTC` });
    }

    embeds.push(embed);
  }

  for (const ciudad in state.mapas) {
    if (!state.mapas[ciudad] || state.mapas[ciudad].length === 0) continue;
    hayMapas = true;
    const titulo = `${config.ICONOS_CIUDAD[ciudad] || "📍"} ${ciudad}`;
    const seccionCiudad = `${titulo}\n${generarTextoCiudad(ciudad, ahora).trim()}`;
    const candidato = `${bloqueActual}\n\n${seccionCiudad}`;

    if (candidato.length <= MAX_EMBED_DESCRIPTION_LENGTH) {
      bloqueActual = candidato;
      continue;
    }

    agregarEmbedPanel(bloqueActual, embeds.length > 0);

    if (seccionCiudad.length <= MAX_EMBED_DESCRIPTION_LENGTH) {
      bloqueActual = seccionCiudad;
      continue;
    }

    const partes = dividirTextoPorLineas(generarTextoCiudad(ciudad, ahora), MAX_EMBED_DESCRIPTION_LENGTH - titulo.length - 1);
    partes.forEach((parte, index) => {
      const sufijo = partes.length > 1 ? ` ${index + 1}/${partes.length}` : "";
      agregarEmbedPanel(`${titulo}${sufijo}\n${parte}`, embeds.length > 0);
    });
    bloqueActual = "";
  }

  if (!hayMapas) {
    bloqueActual = `${encabezado}\n\nSin mapas configurados\nUn admin debe usar \`/editar_mapas\` para agregar mapas.`;
  }

  const bloqueFinal = bloqueActual ? `${bloqueActual}\n\n${pie}` : pie;
  if (bloqueFinal.length <= MAX_EMBED_DESCRIPTION_LENGTH) {
    agregarEmbedPanel(bloqueFinal, embeds.length > 0);
  } else {
    if (bloqueActual) agregarEmbedPanel(bloqueActual, embeds.length > 0);
    agregarEmbedPanel(pie, embeds.length > 0);
  }

  return embeds;
}

function generarEmbed() {
  return generarEmbeds()[0];
}

module.exports = { calcularColorEmbed, generarEmbed, generarEmbeds };
