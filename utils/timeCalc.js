/**
 * Calcula el tiempo real (en minutos) que un scout estuvo activo,
 * mergeando intervalos superpuestos para no contar de más cuando
 * están en múltiples mapas al mismo tiempo.
 *
 * @param {Array} sesiones Array de objetos con { inicio, fin } (timestamps en ms)
 * @returns {number} Minutos totales reales
 */
function calcularTiempoReal(sesiones) {
  if (!sesiones || sesiones.length === 0) return 0;

  // Filtrar sesiones válidas y ordenar por inicio
  const validas = sesiones.filter(s => s && s.inicio).sort((a, b) => a.inicio - b.inicio);
  if (validas.length === 0) return 0;

  const merged = [];
  for (const s of validas) {
    const inicio = s.inicio;
    const fin = s.fin || Date.now(); // Si no tiene fin, sigue activo hasta ahora

    if (!merged.length || merged[merged.length - 1].fin < inicio) {
      merged.push({ inicio, fin });
    } else {
      merged[merged.length - 1].fin = Math.max(merged[merged.length - 1].fin, fin);
    }
  }

  const msReales = merged.reduce((acc, s) => acc + (s.fin - s.inicio), 0);
  return Math.floor(msReales / 60000);
}

module.exports = { calcularTiempoReal };
