const { EmbedBuilder } = require('discord.js');
const state = require('../data/state');
const { textEmoji, cityTextEmoji } = require('../emojis');

function generarEmbedRevision() {
  const round = state.revisionRound;
  const isCurrent = estado => Boolean(
    estado?.revisores?.length > 0
    && estado.revisadoEn >= (round?.startedAt || 0)
    && estado.revisadoEn <= (round?.endsAt || Infinity)
  );
  let totalRev = 0, revisadosRev = 0;
  for (const ciudad in state.mapas) {
    state.mapas[ciudad].forEach(mapa => {
      totalRev++;
      const key = `${ciudad}__${mapa}`;
      if (isCurrent(state.revisionEstado[key])) revisadosRev++;
    });
  }
  const barLen = 10;
  const filled = Math.round((revisadosRev / Math.max(totalRev, 1)) * barLen);
  const bar = "█".repeat(filled) + "░".repeat(barLen - filled);

  const embed = new EmbedBuilder()
    .setTitle(`${textEmoji('REVIEW')} Revisión de Mapas • ${revisadosRev}/${totalRev}`)
    .setDescription(
      `[${bar}] ${Math.round((revisadosRev / Math.max(totalRev, 1)) * 100)}%` +
      (round?.endsAt ? `\n⏳ La ronda cierra <t:${Math.floor(round.endsAt / 1000)}:R>.` : '')
    )
    .setColor(0xe91e63)
    .setFooter({ text: `Actualizado • ${new Date().toLocaleString('es-AR', { timeZone: 'UTC' })} UTC` });

  const ahora = Date.now();
  let hayMapas = false;

  for (const ciudad in state.mapas) {
    if (!state.mapas[ciudad] || state.mapas[ciudad].length === 0) continue;
    hayMapas = true;
    let texto = "";

    state.mapas[ciudad].forEach(mapa => {
      const key = `${ciudad}__${mapa}`;
      const estado = state.revisionEstado[key];

      if (isCurrent(estado)) {
        const totalMins = Math.floor((ahora - estado.revisadoEn) / 60000);
        const horas = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        const tiempo = horas > 0 ? `${horas}h ${mins}min` : `${mins}min`;
        const menciones = estado.revisores.map(id => `<@${id}>`).join(" ");
        texto += `- ${textEmoji('VERIFIED')} **${mapa}** — ${menciones} hace ${tiempo}\n`;
      } else {
        texto += `- ⚪ **${mapa}** — sin revisar\n`;
      }
    });

    embed.addFields({
      name: `${cityTextEmoji(ciudad)} ${ciudad}`,
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

  return embed;
}

module.exports = { generarEmbedRevision };
