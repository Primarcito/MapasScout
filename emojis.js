const DEFINITIONS = {
  MAP: { name: "mapas_map", id: "1525624890575683674", fallback: "🗺️" },
  JOIN: { name: "mapas_join", id: "1525624887639670864", fallback: "✅" },
  DROP: { name: "mapas_drop", id: "1525624880828121149", fallback: "🚪" },
  RETURN: { name: "mapas_return", id: "1525624894241374368", fallback: "↩️" },
  REVIEW: { name: "mapas_review", id: "1525624895940329542", fallback: "🔎" },
  ACTIVE: { name: "mapas_active", id: "1525624875295965285", fallback: "⏱️" },
  EMPTY: { name: "mapas_empty", id: "1525624883055431910", fallback: "⚠️" },
  FULL: { name: "mapas_full", id: "1525624886138245271", fallback: "🔴" },
  ALERT: { name: "mapas_alert", id: "1525624876977750219", fallback: "🚨" },
  VERIFIED: { name: "mapas_verified", id: "1525624899417411765", fallback: "☑️" },
  LYMHURST: { name: "mapas_lymhurst", id: "1525624889216733256", fallback: "🌲" },
  BRIDGEWATCH: { name: "mapas_bridgewatch", id: "1525624878676447424", fallback: "🏜️" },
  FORT_STERLING: { name: "mapas_fort_sterling", id: "1525624884523176017", fallback: "❄️" },
  THETFORD: { name: "mapas_thetford", id: "1525624897861062817", fallback: "🌾" },
  MARTLOCK: { name: "mapas_martlock", id: "1525624892735881306", fallback: "⛰️" },
  ZONA_ROJA: { name: "mapas_zona_roja", id: "1525624901312974918", fallback: "🔴" },
};

const CITY_KEYS = {
  Lymhurst: 'LYMHURST',
  Bridgewatch: 'BRIDGEWATCH',
  'Fort Sterling': 'FORT_STERLING',
  Thetford: 'THETFORD',
  Martlock: 'MARTLOCK',
  'Zona Roja': 'ZONA_ROJA',
};

function emojiId(key) {
  return process.env[`EMOJI_MAPAS_${key}_ID`] || DEFINITIONS[key]?.id || null;
}

function textEmoji(key) {
  const definition = DEFINITIONS[key];
  const id = emojiId(key);
  return id ? `<:${definition.name}:${id}>` : definition.fallback;
}

function buttonEmoji(key) {
  const definition = DEFINITIONS[key];
  const id = emojiId(key);
  return id ? { id, name: definition.name } : definition.fallback;
}

function cityTextEmoji(ciudad) {
  const key = CITY_KEYS[ciudad];
  return key ? textEmoji(key) : '📍';
}

function cityButtonEmoji(ciudad) {
  const key = CITY_KEYS[ciudad];
  return key ? buttonEmoji(key) : '📍';
}

module.exports = {
  DEFINITIONS,
  textEmoji,
  buttonEmoji,
  cityTextEmoji,
  cityButtonEmoji,
};
