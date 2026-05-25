require('dotenv').config();
const settings = require('./settings');
const { SERVER_IDS, ROLE_IDS } = require('./permissions');

function firstId(ids) {
  return Array.isArray(ids) ? ids[0] : ids;
}

function mentionRoles(ids) {
  const roleIds = Array.isArray(ids) ? ids : [ids];
  return roleIds.map(id => `<@&${id}>`).join(' ');
}

module.exports = {
  TOKEN: process.env.TOKEN,
  CLIENT_ID: process.env.CLIENT_ID || "1473617798600200342",
  GUILD_ID: SERVER_IDS.main,

  SCOUT_ROLE_ID: firstId(ROLE_IDS.scout),
  SCOUT_ROLE_IDS: ROLE_IDS.scout,
  SCOUT_ROLE_MENTIONS: mentionRoles(ROLE_IDS.scout),
  ADMIN_ROLE_IDS: ROLE_IDS.admin,
  LIDER_ROLE_IDS: ROLE_IDS.lider,
  SCOUT_VERIFIER_ROLE_IDS: ROLE_IDS.scoutVerifier,

  REVISION_CHANNEL_ID: settings.channels.revision,
  ARCHIVE_CHANNEL_ID: settings.channels.archive,
  SCOUT_VERIFICATION_ADMIN_CHANNEL_ID: settings.channels.scoutVerificationAdmin,

  DATA_DIR: settings.files.dataDir,
  DATA_FILE: settings.files.data,
  SCOUT_FILE: settings.files.scouts,
  PANEL_FILE: settings.files.panel,
  REVISION_PANEL_FILE: settings.files.revisionPanel,

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
