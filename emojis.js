const DEFINITIONS = {
  MAP: { name: "mapas_map", id: "1525672654739079178", fallback: "🗺️" },
  JOIN: { name: "mapas_join", id: "1525672650054303776", fallback: "✅" },
  DROP: { name: "mapas_drop", id: "1525672642332594251", fallback: "🚪" },
  RETURN: { name: "mapas_return", id: "1525672658954489876", fallback: "↩️" },
  REVIEW: { name: "mapas_review", id: "1525672660863029402", fallback: "🔎" },
  ACTIVE: { name: "mapas_active", id: "1525672626700288130", fallback: "⏱️" },
  EMPTY: { name: "mapas_empty", id: "1525672644245061722", fallback: "⚪" },
  FULL: { name: "mapas_full", id: "1525672648309346334", fallback: "🔴" },
  ALERT: { name: "mapas_alert", id: "1525672637538504815", fallback: "⚠️" },
  VERIFIED: { name: "mapas_verified", id: "1525672664834900148", fallback: "☑️" },
  LYMHURST: { name: "mapas_lymhurst", id: "1525672651853398106", fallback: "🌲" },
  BRIDGEWATCH: { name: "mapas_bridgewatch", id: "1525672640260341801", fallback: "🏜️" },
  FORT_STERLING: { name: "mapas_fort_sterling", id: "1525672646392418524", fallback: "❄️" },
  THETFORD: { name: "mapas_thetford", id: "1525672662968303616", fallback: "🌾" },
  MARTLOCK: { name: "mapas_martlock", id: "1525672657121706114", fallback: "⛰️" },
  ZONA_ROJA: { name: "mapas_zona_roja", id: "1525672666604769381", fallback: "🔴" },
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
