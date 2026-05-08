require('dotenv').config();

module.exports = {
  TOKEN: process.env.TOKEN,
  CLIENT_ID: process.env.CLIENT_ID || "1473617798600200342",
  GUILD_ID: process.env.GUILD_ID || "969420681349574677",

  SCOUT_ROLE_ID: "1422971680480956547",
  PRIO1_ROLE_ID: "1476467289418367158",
  LIDER_ROLE_ID: "983987481961717782",

  REVISION_CHANNEL_ID: "1486359169786183811",
  ARCHIVE_CHANNEL_ID: "1437299088721973288",

  DATA_FILE: 'data.json',
  SCOUT_FILE: 'scouts.json',
  PANEL_FILE: 'panel.json',
  REVISION_PANEL_FILE: 'revision_panel.json',

  ICONOS_CIUDAD: {
    "Lymhurst": "🌲",
    "Bridgewatch": "🏜️",
    "Fort Sterling": "❄️",
    "Thetford": "🌾",
    "Martlock": "⛰️",
    "Zona Roja": "🔴"
  },

  CIUDADES_ALIAS: {
    "lymhurst": "Lymhurst",
    "bridgewatch": "Bridgewatch",
    "fort sterling": "Fort Sterling",
    "fortsterling": "Fort Sterling",
    "thetford": "Thetford",
    "martlock": "Martlock",
    "zona roja": "Zona Roja",
    "redzone": "Zona Roja",
    "red zone": "Zona Roja"
  }
};
