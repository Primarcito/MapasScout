const settings = require('./settings');

const SERVER_IDS = settings.servers;
const ROLE_IDS = settings.roles;

function hasRole(member, roleId) {
  const roleIds = Array.isArray(roleId) ? roleId : [roleId];
  return roleIds.some(id => Boolean(member?.roles?.cache?.has(id)));
}

function canScout(member) {
  return hasRole(member, ROLE_IDS.scout);
}

function canManageMaps(member) {
  return hasRole(member, ROLE_IDS.admin);
}

function canUseAdmin(member) {
  return hasRole(member, ROLE_IDS.admin);
}

function canManageSensitiveScoutData(member) {
  return hasRole(member, ROLE_IDS.seniorAdmin);
}

function canReview(member) {
  return hasRole(member, ROLE_IDS.scout);
}

function canExport(member) {
  return hasRole(member, ROLE_IDS.lider);
}

function canDecideVerification(member) {
  return hasRole(member, ROLE_IDS.verificationOfficer);
}

module.exports = {
  SERVER_IDS,
  ROLE_IDS,
  hasRole,
  canScout,
  canManageMaps,
  canUseAdmin,
  canManageSensitiveScoutData,
  canReview,
  canExport,
  canDecideVerification,
};
