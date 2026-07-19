function parseTimeAdjustmentToMinutes(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(',', '.');
  if (!normalized) return null;

  const sign = normalized.startsWith('-') ? -1 : 1;
  const unsigned = normalized.replace(/^[+-]\s*/, '').trim();
  if (!unsigned || /[+-]/.test(unsigned)) return null;

  let minutes = null;

  // Compatibilidad: un número sin unidad continúa representando horas.
  if (/^\d+(?:\.\d+)?$/.test(unsigned)) {
    minutes = Number(unsigned) * 60;
  } else {
    const colon = /^(\d+):([0-5]?\d)$/.exec(unsigned);
    if (colon) {
      minutes = Number(colon[1]) * 60 + Number(colon[2]);
    } else {
      const hours = /(\d+(?:\.\d+)?)\s*(?:h|hora|horas)\b/.exec(unsigned);
      const mins = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minuto|minutos)\b/.exec(unsigned);
      const residue = unsigned
        .replace(/(\d+(?:\.\d+)?)\s*(?:h|hora|horas)\b/g, '')
        .replace(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minuto|minutos)\b/g, '')
        .trim();
      if (!residue && (hours || mins)) {
        minutes = (Number(hours?.[1]) || 0) * 60 + (Number(mins?.[1]) || 0);
      }
    }
  }

  if (!Number.isFinite(minutes)) return null;
  const rounded = Math.round(minutes) * sign;
  return rounded === 0 ? null : rounded;
}

module.exports = { parseTimeAdjustmentToMinutes };
