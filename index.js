require('dotenv').config();
const fs = require('fs');

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || "1473617798600200342";
const GUILD_ID = process.env.GUILD_ID || "969420681349574677";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const procesando = new Set();

// Historial del día actual (se limpia a las 10 UTC)
let historialDia = [];

// Log de cambios de admin
let logAdmin = [];

// Cobertura: tiempo total por mapa { "ciudad__mapa": minutos }
let coberturaDia = {};

const SCOUT_ROLE_ID = "1422971680480956547";
const REVISION_CHANNEL_ID = "1486359169786183811";
const REVISION_PANEL_FILE = './revision_panel.json';

let revisionChannelId = REVISION_CHANNEL_ID;
let revisionMessageId = null;

function guardarRevisionPanel() {
  fs.writeFileSync(REVISION_PANEL_FILE, JSON.stringify({ messageId: revisionMessageId }, null, 2));
}

function cargarRevisionPanel() {
  if (fs.existsSync(REVISION_PANEL_FILE)) {
    const data = JSON.parse(fs.readFileSync(REVISION_PANEL_FILE, 'utf8'));
    revisionMessageId = data.messageId || null;
  }
}

cargarRevisionPanel();

cargarRevisionPanel();

// alertasMapas[ciudad__mapa] = { messageId, timeout20min, timeout90min }
const alertasMapas = {};

/* ================= PERSISTENCIA ================= */

const DATA_FILE = './data.json';
const SCOUT_FILE = './scouts.json';
const PANEL_FILE = './panel.json';

let panelChannelId = null;
let panelMessageId = null;

// scoutsActivos[userId] = [ { ciudad, mapa, inicio }, ... ]
let scoutsActivos = {};
let historialScouts = [];

// ultimosMapas[userId] = [ { ciudad, mapa }, ... ]
let ultimosMapas = {};

let mapas = {
  "Lymhurst": [],
  "Bridgewatch": [],
  "Fort Sterling": [],
  "Thetford": [],
  "Martlock": [],
  "Zona Roja": []
};

let registros = {};
let panelMessage = null;

// Timestamp de la última edición de mapas
let ultimaEdicion = null;

/* ===== CARGA / GUARDADO ===== */

function guardarDatos() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ mapas, registros, ultimaEdicion }, null, 2));
}

function cargarDatos() {
  if (fs.existsSync(DATA_FILE)) {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    mapas = data.mapas || mapas;
    registros = data.registros || {};
    ultimaEdicion = data.ultimaEdicion || null;
  }
}

cargarDatos();

function cargarScouts() {
  if (fs.existsSync(SCOUT_FILE)) {
    const data = JSON.parse(fs.readFileSync(SCOUT_FILE, 'utf8'));
    scoutsActivos = data.activos || {};
    historialScouts = data.historial || [];
    ultimosMapas = data.ultimosMapas || {};
    historialDia = data.historialDia || [];
  }
}

function guardarScouts() {
  fs.writeFileSync(
    SCOUT_FILE,
    JSON.stringify({ activos: scoutsActivos, historial: historialScouts, ultimosMapas, historialDia }, null, 2)
  );
}

cargarScouts();

function guardarPanel() {
  fs.writeFileSync(
    PANEL_FILE,
    JSON.stringify({ channelId: panelChannelId, messageId: panelMessageId }, null, 2)
  );
}

function cargarPanel() {
  if (fs.existsSync(PANEL_FILE)) {
    const data = JSON.parse(fs.readFileSync(PANEL_FILE, 'utf8'));
    panelChannelId = data.channelId;
    panelMessageId = data.messageId;
  }
}

cargarPanel();

/* ================= COMANDOS ================= */

const commands = [
  new SlashCommandBuilder()
    .setName("panel_mapas")
    .setDescription("Crear el panel principal de mapas"),

  new SlashCommandBuilder()
    .setName("editar_mapas")
    .setDescription("Editar mapas de una ciudad"),

  new SlashCommandBuilder()
    .setName("limpiar_scout")
    .setDescription("Remover un scout registrado (solo prio1)"),

  new SlashCommandBuilder()
    .setName("historial")
    .setDescription("Ver historial de scouts del día"),

  new SlashCommandBuilder()
    .setName("revisar")
    .setDescription("Crear el panel de revisión de mapas"),

  new SlashCommandBuilder()
    .setName("reset_revision")
    .setDescription("Limpiar el panel de revisión (solo prio1)"),

  new SlashCommandBuilder()
    .setName("reset_mapas")
    .setDescription("Resetear el panel de mapas (solo prio1)"),

  new SlashCommandBuilder()
    .setName("exportar")
    .setDescription("Exportar historial del día como CSV (solo líderes)"),

  new SlashCommandBuilder()
    .setName("cobertura")
    .setDescription("Ver cobertura de mapas del día"),

  new SlashCommandBuilder()
    .setName("log_admin")
    .setDescription("Ver log de cambios de admin (solo prio1)"),

  new SlashCommandBuilder()
    .setName("cargar_mapas")
    .setDescription("Cargar todos los mapas del día de una vez (solo prio1)")
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
})();

/* ================= EMBED ================= */

function calcularColorEmbed() {
  let total = 0, cubiertos = 0;
  for (const ciudad in mapas) {
    mapas[ciudad].forEach(mapa => {
      total++;
      const users = registros[ciudad]?.[mapa] || [];
      if (users.length > 0) cubiertos++;
    });
  }
  if (total === 0) return 0xe91e63;
  const pct = cubiertos / total;
  if (pct >= 0.8) return 0x57f287; // verde
  if (pct >= 0.4) return 0xfee75c; // amarillo
  return 0xe91e63; // rosa/rojo
}

function generarEmbed() {
  const embed = new EmbedBuilder()
    .setTitle("🗺️ Mapas del Día")
    .setDescription("Usa el botón **Anotarse** para registrarte en un mapa.\nMáximo 5 scouts por mapa.")
    .setColor(calcularColorEmbed())
    .setFooter({ text: `Actualizado • ${new Date().toLocaleString('es-AR', { timeZone: 'UTC' })} UTC` });

  const iconos = {
    "Lymhurst": "🌲",
    "Bridgewatch": "🏜️",
    "Fort Sterling": "❄️",
    "Thetford": "🌾",
    "Martlock": "⛰️",
    "Zona Roja": "🔴"
  };

  // Contar scouts activos
  const totalScoutsActivos = Object.keys(scoutsActivos).length;
  const descBase = "Usa el botón **Anotarse** para registrarte en un mapa.\nMáximo 5 scouts por mapa.";
  const descActivos = totalScoutsActivos > 0 ? `\n👥 **${totalScoutsActivos} scout${totalScoutsActivos > 1 ? "s" : ""} activo${totalScoutsActivos > 1 ? "s" : ""}**` : "";
  embed.setDescription(descBase + descActivos);

  const ahora30 = Date.now();
  let hayMapas = false;

  for (const ciudad in mapas) {
    if (!mapas[ciudad] || mapas[ciudad].length === 0) continue;

    hayMapas = true;
    let texto = "";

    mapas[ciudad].forEach(mapa => {
      const users = registros[ciudad]?.[mapa] || [];
      const menciones = users.map(id => {
        // Idea 8: mostrar tiempo del scout
        const entrada = scoutsActivos[id]?.find(e => e.ciudad === ciudad && e.mapa === mapa);
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

      // Idea 3: 🚨 si lleva >30min sin scouts
      const sinScouts = users.length === 0;
      const cobKey = `${ciudad}__${mapa}`;
      const ultimaActividad = coberturaDia[cobKey]?.ultimaActividad || null;
      const minsVacio = sinScouts && ultimaActividad ? Math.floor((ahora30 - ultimaActividad) / 60000) : 0;
      const alerta = sinScouts && minsVacio > 30;

      const prefijo = lleno ? "🔴 " : alerta ? "🚨 " : "- ";
      texto += `${prefijo}**${mapa}** → ${menciones}\n`;
    });

    embed.addFields({
      name: `${iconos[ciudad] || "📍"} ${ciudad}`,
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

/* ================= COMPONENTES PANEL ================= */

function componentesPanel() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("abrir_anotarse")
        .setLabel("Anotarse")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("dropear_mapas")
        .setLabel("Dropear Mapas")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("volver_mapas_panel")
        .setLabel("Volver a mis Mapas")
        .setStyle(ButtonStyle.Success)
    )
  ];
}

/* ================= ACTUALIZAR PANEL ================= */

async function actualizarPanel() {
  if (!panelMessage) return;

  try {
    await panelMessage.edit({
      embeds: [generarEmbed()],
      components: componentesPanel()
    });
  } catch (err) {
    console.error("Error actualizando panel:", err);
    panelMessage = null;
  }
}

/* ================= HELPERS SCOUTS ================= */

function guardarUltimosMapas(userId) {
  const lista = [];
  for (const ciudad in registros) {
    for (const mapa in registros[ciudad]) {
      if (registros[ciudad][mapa].includes(userId)) {
        lista.push({ ciudad, mapa });
      }
    }
  }
  if (lista.length > 0) ultimosMapas[userId] = lista;
}

function cerrarScoutsActivos(userId, username = null, motivo = "manual") {
  const entradas = scoutsActivos[userId];
  if (!entradas || entradas.length === 0) return;

  const fin = Date.now();
  entradas.forEach(entry => {
    const duracionMin = Math.floor((fin - entry.inicio) / 60000);
    const registro = {
      userId,
      username: username || entry.username || userId,
      ciudad: entry.ciudad,
      mapa: entry.mapa,
      inicio: entry.inicio,
      fin,
      duracionMin,
      motivo
    };
    historialScouts.push(registro);
    // Solo agregar al historialDia si no fue por reset
    if (motivo !== "reset") {
      historialDia.push(registro);
    }
    // Actualizar cobertura
    const cobKey = `${entry.ciudad}__${entry.mapa}`;
    if (!coberturaDia[cobKey]) coberturaDia[cobKey] = { ciudad: entry.ciudad, mapa: entry.mapa, minutos: 0 };
    coberturaDia[cobKey].minutos += duracionMin;
  });

  delete scoutsActivos[userId];
}

function borrarRegistrosUsuario(userId) {
  for (const ciudad in registros) {
    for (const mapa in registros[ciudad]) {
      registros[ciudad][mapa] = registros[ciudad][mapa].filter(id => id !== userId);
    }
  }
}

/* ================= FLUJO ANOTARSE ================= */

function respuestaCiudades() {
  const ciudadesDisponibles = Object.keys(mapas).filter(
    c => mapas[c] && mapas[c].length > 0
  );

  if (ciudadesDisponibles.length === 0) {
    return { content: "No hay mapas configurados aún.", components: [] };
  }

  const filas = [];
  let fila = new ActionRowBuilder();

  const iconosCiudad = {
    "Lymhurst": "🌲", "Bridgewatch": "🏜️", "Fort Sterling": "❄️",
    "Thetford": "🌾", "Martlock": "⛰️", "Zona Roja": "🔴"
  };

  ciudadesDisponibles.forEach((ciudad, i) => {
    if (i % 5 === 0 && i !== 0) {
      filas.push(fila);
      fila = new ActionRowBuilder();
    }
    fila.addComponents(
      new ButtonBuilder()
        .setCustomId(`ciudad_btn_${ciudad}`)
        .setLabel(`${iconosCiudad[ciudad] || "📍"} ${ciudad}`)
        .setStyle(ButtonStyle.Secondary)
    );
  });

  filas.push(fila);

  return { content: "📍 **Selecciona una ciudad:**", components: filas };
}

function respuestaMapas(ciudad, userId) {
  const listaMapas = mapas[ciudad];

  if (!listaMapas || listaMapas.length === 0) {
    return { content: "No hay mapas en esa ciudad.", components: [] };
  }

  const filas = [];
  let fila = new ActionRowBuilder();

  listaMapas.forEach((mapa, i) => {
    if (i % 5 === 0 && i !== 0) {
      filas.push(fila);
      fila = new ActionRowBuilder();
    }

    const users = registros[ciudad]?.[mapa] || [];
    const lleno = users.length >= 5;
    const yaAnotado = users.includes(userId);

    let label, style, disabled;

    if (yaAnotado) {
      label = `✓ ${mapa}`;
      style = ButtonStyle.Primary;
      disabled = false;
    } else if (lleno) {
      label = `🔴 ${mapa}`;
      style = ButtonStyle.Secondary;
      disabled = true;
    } else {
      label = `${mapa} (${users.length}/5)`;
      style = ButtonStyle.Success;
      disabled = false;
    }

    fila.addComponents(
      new ButtonBuilder()
        .setCustomId(`registro_btn_${ciudad}__${mapa}`)
        .setLabel(label)
        .setStyle(style)
        .setDisabled(disabled)
    );
  });

  filas.push(fila);

  // Botón volver
  filas.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("volver_ciudades")
        .setLabel("← Volver")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return { content: `📍 **${ciudad}** — elige tu mapa:`, components: filas };
}

/* ================= RESET AUTOMÁTICO ================= */

function programarReset() {
  const ahora = new Date();

  const proximoReset = new Date(Date.UTC(
    ahora.getUTCFullYear(),
    ahora.getUTCMonth(),
    ahora.getUTCDate(),
    10, 0, 0, 0
  ));

  if (proximoReset <= ahora) {
    proximoReset.setUTCDate(proximoReset.getUTCDate() + 1);
  }

  const msHastaReset = proximoReset - ahora;
  console.log(`Reset programado en ${Math.round(msHastaReset / 60000)} minutos`);

  setTimeout(async () => {
    await ejecutarReset();
    programarReset();
  }, msHastaReset);
}

async function ejecutarReset() {
  console.log("Ejecutando reset diario...");

  // Cancelar si se editaron mapas desde las 7 UTC de hoy
  const hoy7UTC = new Date();
  hoy7UTC.setUTCHours(7, 0, 0, 0);

  const huboCambios = ultimaEdicion && ultimaEdicion >= hoy7UTC.getTime();

  if (huboCambios) {
    console.log("Reset cancelado — mapas editados después de las 7 UTC");

    if (panelMessage) {
      try {
        const resetMsg = await panelMessage.channel.send(
          "⚠️ **Reset cancelado** — Los mapas fueron actualizados hoy. El panel sigue vigente."
        );
        setTimeout(async () => {
          try { await resetMsg.delete(); } catch (e) {}
        }, 20 * 60 * 1000);
      } catch (err) {
        console.error("Error enviando aviso:", err);
      }
    }
    return;
  }

  // Reset total
  for (const ciudad in registros) registros[ciudad] = {};
  for (const ciudad in mapas) mapas[ciudad] = [];

  for (const userId in scoutsActivos) cerrarScoutsActivos(userId, null, "reset");

  ultimosMapas = {};
  ultimaEdicion = null;
  historialDia = [];
  coberturaDia = {};
  logAdmin = [];

  guardarDatos();
  guardarScouts();
  await actualizarPanel();

  if (panelMessage) {
    try {
      await panelMessage.channel.send(
        "🔄 **Reset diario completado** — Los mapas han sido limpiados. Un admin puede cargar los nuevos con `/editar_mapas`."
      );
    } catch (err) {
      console.error("Error enviando aviso de reset:", err);
    }
  }

  console.log("Reset diario completado.");
}

/* ================= PANEL REVISIÓN ================= */

let revisionMessage = null;
// revisionEstado[ciudad__mapa] = { revisadoEn: timestamp, timeout: timeoutId } | null
const revisionEstado = {};

function generarEmbedRevision() {
  const iconos = {
    "Lymhurst": "🌲", "Bridgewatch": "🏜️", "Fort Sterling": "❄️",
    "Thetford": "🌾", "Martlock": "⛰️", "Zona Roja": "🔴"
  };

  // Contar revisados
  let totalRev = 0, revisadosRev = 0;
  for (const ciudad in mapas) {
    mapas[ciudad].forEach(mapa => {
      totalRev++;
      const key = `${ciudad}__${mapa}`;
      if (revisionEstado[key]?.revisores?.length > 0) revisadosRev++;
    });
  }
  const barLen = 10;
  const filled = Math.round((revisadosRev / Math.max(totalRev, 1)) * barLen);
  const bar = "█".repeat(filled) + "░".repeat(barLen - filled);

  const embed = new EmbedBuilder()
    .setTitle(`🔍 Revisión de Mapas • ${revisadosRev}/${totalRev}`)
    .setDescription(`[${bar}] ${Math.round((revisadosRev / Math.max(totalRev, 1)) * 100)}%`)
    .setColor(0xe91e63)
    .setFooter({ text: `Actualizado • ${new Date().toLocaleString('es-AR', { timeZone: 'UTC' })} UTC` });

  const ahora = Date.now();
  let hayMapas = false;

  for (const ciudad in mapas) {
    if (!mapas[ciudad] || mapas[ciudad].length === 0) continue;

    hayMapas = true;
    let texto = "";

    mapas[ciudad].forEach(mapa => {
      const key = `${ciudad}__${mapa}`;
      const estado = revisionEstado[key];

      if (estado && estado.revisores && estado.revisores.length > 0) {
        const totalMins = Math.floor((ahora - estado.revisadoEn) / 60000);
        const horas = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        const tiempo = horas > 0 ? `${horas}h ${mins}min` : `${mins}min`;
        const menciones = estado.revisores.map(id => `<@${id}>`).join(" ");
        texto += `- ✅ **${mapa}** — ${menciones} hace ${tiempo}
`;
      } else {
        texto += `- ⚪ **${mapa}** — sin revisar
`;
      }
    });

    embed.addFields({
      name: `${iconos[ciudad] || "📍"} ${ciudad}`,
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

function contarMapasRevision() {
  let total = 0;
  for (const ciudad in mapas) {
    if (mapas[ciudad] && mapas[ciudad].length > 0) total += mapas[ciudad].length;
  }
  return total;
}

function componentesRevisionCiudades() {
  // Botones de ciudad cuando hay >25 mapas
  const iconoBtn = { "Lymhurst": "🌲", "Bridgewatch": "🏜️", "Fort Sterling": "❄️", "Thetford": "🌾", "Martlock": "⛰️", "Zona Roja": "🔴" };
  const filas = [];
  let fila = new ActionRowBuilder();
  let count = 0;

  for (const ciudad in mapas) {
    if (!mapas[ciudad] || mapas[ciudad].length === 0) continue;
    if (count % 5 === 0 && count !== 0) {
      filas.push(fila);
      fila = new ActionRowBuilder();
    }
    // Contar revisados en esta ciudad
    const revisadosCiudad = mapas[ciudad].filter(mapa => {
      const key = `${ciudad}__${mapa}`;
      return revisionEstado[key]?.revisores?.length > 0;
    }).length;
    const totalCiudad = mapas[ciudad].length;
    const emoji = iconoBtn[ciudad] || "📍";
    const label = `${emoji} ${ciudad} (${revisadosCiudad}/${totalCiudad})`;

    fila.addComponents(
      new ButtonBuilder()
        .setCustomId(`revision_ciudad_${ciudad}`)
        .setLabel(label)
        .setStyle(revisadosCiudad === totalCiudad ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
    count++;
  }
  if (count > 0) filas.push(fila);
  return filas;
}

function componentesRevisionMapas(ciudad) {
  // Botones de mapas de una ciudad específica
  const iconoBtn = { "Lymhurst": "🌲", "Bridgewatch": "🏜️", "Fort Sterling": "❄️", "Thetford": "🌾", "Martlock": "⛰️", "Zona Roja": "🔴" };
  const filas = [];
  let fila = new ActionRowBuilder();
  let count = 0;

  (mapas[ciudad] || []).forEach(mapa => {
    if (count % 5 === 0 && count !== 0) {
      filas.push(fila);
      fila = new ActionRowBuilder();
    }
    const key = `${ciudad}__${mapa}`;
    const estado = revisionEstado[key];
    const revisado = estado?.revisores?.length > 0;
    const mins = revisado ? Math.floor((Date.now() - estado.revisadoEn) / 60000) : 0;
    const expirado = revisado && mins >= 15;
    const emoji = iconoBtn[ciudad] || "📍";
    const label = revisado && !expirado ? `✅ ${emoji} ${mapa}` : `${emoji} ${mapa}`;

    fila.addComponents(
      new ButtonBuilder()
        .setCustomId(`revision_btn_${key}`)
        .setLabel(label)
        .setStyle(revisado && !expirado ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
    count++;
  });

  if (count > 0) filas.push(fila);

  // Botón volver
  filas.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("revision_volver_ciudades")
        .setLabel("← Volver")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return filas;
}

function componentesRevision(ciudad = null) {
  const totalMapas = contarMapasRevision();

  if (totalMapas > 25) {
    // Modo ciudad
    if (ciudad) return componentesRevisionMapas(ciudad);
    return componentesRevisionCiudades();
  }

  // Modo normal - todos los botones directos
  const filas = [];
  let fila = new ActionRowBuilder();
  let count = 0;

  for (const c in mapas) {
    if (!mapas[c] || mapas[c].length === 0) continue;
    mapas[c].forEach(mapa => {
      if (count % 5 === 0 && count !== 0) {
        filas.push(fila);
        fila = new ActionRowBuilder();
      }
      const key = `${c}__${mapa}`;
      const estado = revisionEstado[key];
      const revisado = estado?.revisores?.length > 0;
      const mins = revisado ? Math.floor((Date.now() - estado.revisadoEn) / 60000) : 0;
      const expirado = revisado && mins >= 15;
      const iconoBtn = { "Lymhurst": "🌲", "Bridgewatch": "🏜️", "Fort Sterling": "❄️", "Thetford": "🌾", "Martlock": "⛰️", "Zona Roja": "🔴" };
      const emoji = iconoBtn[c] || "📍";
      const label = revisado && !expirado ? `✅ ${emoji} ${mapa}` : `${emoji} ${mapa}`;

      fila.addComponents(
        new ButtonBuilder()
          .setCustomId(`revision_btn_${key}`)
          .setLabel(label)
          .setStyle(revisado && !expirado ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
      count++;
    });
  }
  if (count > 0) filas.push(fila);
  return filas;
}


async function actualizarRevision() {
  try {
    if (revisionMessage) {
      await revisionMessage.edit({
        embeds: [generarEmbedRevision()],
        components: componentesRevision()
      });
    } else {
      await crearPanelRevision();
    }
  } catch (err) {
    console.error("Error actualizando panel revisión:", err);
    revisionMessage = null;
    revisionMessageId = null;
    await crearPanelRevision();
  }
}

async function crearPanelRevision() {
  try {
    const channel = await client.channels.fetch(REVISION_CHANNEL_ID);
    if (!channel) return;

    const comps = componentesRevision();
    const msg = await channel.send({
      embeds: [generarEmbedRevision()],
      components: comps.length > 0 ? comps : []
    });

    revisionMessage = msg;
    revisionMessageId = msg.id;
    guardarRevisionPanel();
    console.log("Panel de revisión creado/recreado");
  } catch (err) {
    console.error("Error creando panel revisión:", err);
  }
}

/* ================= ALERTAS MAPAS ================= */

async function verificarMapaVacio(ciudad, mapa) {
  const users = registros[ciudad]?.[mapa] || [];
  const key = `${ciudad}__${mapa}`;

  if (users.length === 0) {
    // Mapa quedó vacío - mandar alerta
    await enviarAlertaMapa(ciudad, mapa, key);
  } else {
    // Alguien se anotó - limpiar alerta si existe
    await limpiarAlertaMapa(key);
  }
}

async function enviarAlertaMapa(ciudad, mapa, key) {
  // Si ya hay una alerta activa para este mapa, no mandar otra
  if (alertasMapas[key]) return;

  if (!panelMessage) return;

  try {
    const msg = await panelMessage.channel.send(
      `⚠️ **${mapa}** sin scout, alguien que se anote pes`
    );

    const timeout20 = setTimeout(async () => {
      await limpiarAlertaMapa(key);
    }, 20 * 60 * 1000);

    const timeout90 = setTimeout(async () => {
      // A la 1h30 mandar recordatorio con todos los mapas sin scouts
      await enviarRecordatorioMapasVacios();
    }, 150 * 60 * 1000);

    alertasMapas[key] = { messageId: msg.id, timeout20, timeout90 };
  } catch (err) {
    console.error("Error enviando alerta de mapa vacío:", err);
  }
}

async function limpiarAlertaMapa(key) {
  const alerta = alertasMapas[key];
  if (!alerta) return;

  clearTimeout(alerta.timeout20);
  clearTimeout(alerta.timeout90);

  if (panelMessage) {
    try {
      const msg = await panelMessage.channel.messages.fetch(alerta.messageId);
      await msg.delete();
    } catch (err) {
      // Mensaje ya borrado, ignorar
    }
  }

  delete alertasMapas[key];
}

async function enviarRecordatorioMapasVacios() {
  if (!panelMessage) return;

  // No mandar entre 6:00 y 10:00 UTC
  const horaUTC = new Date().getUTCHours();
  if (horaUTC >= 6 && horaUTC < 10) return;

  const vacios = [];
  for (const ciudad in mapas) {
    for (const mapa of mapas[ciudad]) {
      const users = registros[ciudad]?.[mapa] || [];
      if (users.length === 0) vacios.push(mapa);
    }
  }

  if (vacios.length === 0) return;

  try {
    await panelMessage.channel.send({
      content: `<@&${SCOUT_ROLE_ID}> ⚠️ Estos mapas llevan rato solos causitas: ${vacios.map(m => `**${m}**`).join(", ")}`,
      allowedMentions: { roles: [SCOUT_ROLE_ID] }
    });
  } catch (err) {
    console.error("Error enviando recordatorio:", err);
  }
}

/* ================= EVENTOS ================= */

client.on("interactionCreate", async interaction => {

  /* ===== SLASH ===== */

  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "panel_mapas") {
      const panelReply = await interaction.reply({
        embeds: [generarEmbed()],
        components: componentesPanel(),
        withResponse: true
      });
      panelMessage = panelReply.resource.message;

      panelChannelId = panelMessage.channel.id;
      panelMessageId = panelMessage.id;
      guardarPanel();



      return;
    }

    if (interaction.commandName === "cargar_mapas") {
      const tieneRol = interaction.member.roles.cache.some(
        role => role.id === "1476467289418367158" || role.name.toLowerCase() === "prio1"
      );

      if (!tieneRol) {
        return interaction.reply({
          content: "Necesitas el rol prio1 para usar este comando.",
          flags: MessageFlags.Ephemeral
        });
      }

      const modal = new ModalBuilder()
        .setCustomId("modal_cargar_mapas")
        .setTitle("Cargar Mapas del Día");

      const input = new TextInputBuilder()
        .setCustomId("mapas_bulk_input")
        .setLabel("Pega todos los mapas (Ciudad: + mapas)")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Thetford:\nDeathwisp Sink\nDrownfield Slough\n\nLymhurst:\nGiantweald Woods")
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.commandName === "editar_mapas") {
      const tieneRol = interaction.member.roles.cache.some(
        role => role.name.toLowerCase() === "prio1"
      );

      if (!tieneRol) {
        return interaction.reply({ content: "Necesitas el rol prio1 para usar este comando.", flags: MessageFlags.Ephemeral });
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId("editar_ciudad")
        .setPlaceholder("Selecciona ciudad")
        .addOptions(Object.keys(mapas).map(c => ({ label: c, value: c })));

      return interaction.reply({
        content: "Selecciona ciudad a editar:",
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral
      });
    }

    if (interaction.commandName === "limpiar_scout") {
      const tieneRol = interaction.member.roles.cache.some(
        role => role.name.toLowerCase() === "prio1"
      );

      if (!tieneRol) {
        return interaction.reply({ content: "Necesitas el rol prio1 para usar este comando.", flags: MessageFlags.Ephemeral });
      }

      const scouts = new Set();
      for (const ciudad in registros) {
        for (const mapa in registros[ciudad]) {
          registros[ciudad][mapa].forEach(id => scouts.add(id));
        }
      }

      if (scouts.size === 0) {
        return interaction.reply({ content: "No hay scouts registrados.", flags: MessageFlags.Ephemeral });
      }

      const opciones = Array.from(scouts).slice(0, 25).map(id => ({
        label: interaction.guild.members.cache.get(id)?.user?.username || id,
        value: id
      }));

      const select = new StringSelectMenuBuilder()
        .setCustomId("select_limpiar_scout")
        .setPlaceholder("Selecciona scout a remover")
        .addOptions(opciones);

      return interaction.reply({
        content: "Selecciona el scout a remover:",
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral
      });
    }

    if (interaction.commandName === "reset_mapas") {
      const tieneRol = interaction.member.roles.cache.some(
        role => role.name.toLowerCase() === "prio1"
      );

      if (!tieneRol) {
        return interaction.reply({
          content: "Necesitas el rol prio1 para usar este comando.",
          flags: MessageFlags.Ephemeral
        });
      }

      // Cerrar todos los scouts activos
      for (const userId in scoutsActivos) {
        cerrarScoutsActivos(userId);
      }

      // Limpiar mapas y registros
      for (const ciudad in mapas) mapas[ciudad] = [];
      for (const ciudad in registros) registros[ciudad] = {};

      ultimosMapas = {};
      ultimaEdicion = null;

      guardarDatos();
      guardarScouts();
      await actualizarPanel();

      return interaction.reply({
        content: "✅ Panel de mapas reseteado.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (interaction.commandName === "reset_revision") {
      const tieneRol = interaction.member.roles.cache.some(
        role => role.name.toLowerCase() === "prio1"
      );

      if (!tieneRol) {
        return interaction.reply({
          content: "Necesitas el rol prio1 para usar este comando.",
          flags: MessageFlags.Ephemeral
        });
      }

      // Limpiar todos los estados de revisión
      for (const key in revisionEstado) {
        if (revisionEstado[key]?.timeout) clearTimeout(revisionEstado[key].timeout);
        delete revisionEstado[key];
      }

      // Borrar mensaje viejo
      if (revisionMessage) {
        try { await revisionMessage.delete(); } catch (e) {}
        revisionMessage = null;
        revisionMessageId = null;
        guardarRevisionPanel();
      }

      // Recrear panel en el canal fijo
      await crearPanelRevision();

      return interaction.reply({
        content: "✅ Panel de revisión reseteado.",
        flags: MessageFlags.Ephemeral
      });
    }

    if (interaction.commandName === "revisar") {
      const tieneRol = interaction.member.roles.cache.some(
        role => role.name.toLowerCase() === "scout"
      );

      if (!tieneRol) {
        return interaction.reply({
          content: "Necesitas el rol Scout para usar este comando.",
          flags: MessageFlags.Ephemeral
        });
      }

      const comps = componentesRevision();

      if (comps.length === 0) {
        return interaction.reply({
          content: "No hay scouts anotados en ningún mapa.",
          flags: MessageFlags.Ephemeral
        });
      }

      const revisionReply = await interaction.reply({
        embeds: [generarEmbedRevision()],
        components: comps,
        withResponse: true
      });
      revisionMessage = revisionReply.resource.message;

      return;
    }

    if (interaction.commandName === "exportar") {
      const tieneRol = interaction.member.roles.cache.some(
        role => role.id === "983987481961717782"
      );

      if (!tieneRol) {
        return interaction.reply({
          content: "Necesitas el rol Líder para usar este comando.",
          flags: MessageFlags.Ephemeral
        });
      }

      if (historialDia.length === 0) {
        return interaction.reply({
          content: "No hay actividad registrada hoy.",
          flags: MessageFlags.Ephemeral
        });
      }

      // Generar CSV
      const fecha = new Date().toISOString().split("T")[0];
      let csv = "Usuario,Mapa,Ciudad,Entrada UTC,Salida UTC,Duracion (min)\n";
      historialDia.forEach(s => {
        const entrada = new Date(s.inicio).toISOString().replace("T", " ").slice(0, 19);
        const salida = s.fin ? new Date(s.fin).toISOString().replace("T", " ").slice(0, 19) : "activo";
        csv += `${s.username || s.userId},${s.mapa},${s.ciudad},${entrada},${salida},${s.duracionMin}\n`;
      });

      const buffer = Buffer.from(csv, "utf-8");

      return interaction.reply({
        content: `📊 Historial del día ${fecha}`,
        files: [{ attachment: buffer, name: `historial_${fecha}.csv` }],
        flags: MessageFlags.Ephemeral
      });
    }

    if (interaction.commandName === "cobertura") {
      const iconos = {
        "Lymhurst": "🌳", "Bridgewatch": "🏜️", "Fort Sterling": "❄️",
        "Thetford": "🌾", "Martlock": "⛰️", "Zona Roja": "🔴"
      };

      let hayDatos = false;
      let totalMapas = 0, mapasCubiertos = 0;

      const embed = new EmbedBuilder()
        .setTitle("📊 Cobertura del Día")
        .setColor(calcularColorEmbed())
        .setFooter({ text: "Se reinicia a las 10:00 UTC" });

      for (const ciudad in mapas) {
        if (!mapas[ciudad] || mapas[ciudad].length === 0) continue;

        let texto = "";
        mapas[ciudad].forEach(mapa => {
          totalMapas++;
          const key = `${ciudad}__${mapa}`;
          const cob = coberturaDia[key];
          const activos = registros[ciudad]?.[mapa] || [];

          // Tiempo activo actual
          let minActivo = cob?.minutos || 0;
          for (const userId in scoutsActivos) {
            const entry = scoutsActivos[userId].find(e => e.ciudad === ciudad && e.mapa === mapa);
            if (entry) minActivo += Math.floor((Date.now() - entry.inicio) / 60000);
          }

          if (minActivo > 0 || activos.length > 0) mapasCubiertos++;

          const horas = Math.floor(minActivo / 60);
          const mins = minActivo % 60;
          const tiempo = horas > 0 ? `${horas}h ${mins}min` : `${mins}min`;
          const estado = activos.length > 0 ? "✅" : minActivo > 0 ? "⚠️" : "❌";
          texto += `- ${estado} **${mapa}** — ${minActivo > 0 ? tiempo : "sin cobertura"}\n`;
          hayDatos = true;
        });

        if (texto) {
          embed.addFields({ name: `${iconos[ciudad] || "📍"} ${ciudad}`, value: texto, inline: false });
        }
      }

      if (!hayDatos) {
        return interaction.reply({ content: "No hay datos de cobertura aún.", flags: MessageFlags.Ephemeral });
      }

      const pct = totalMapas > 0 ? Math.round((mapasCubiertos / totalMapas) * 100) : 0;
      embed.setDescription(`Cobertura total: **${pct}%** (${mapasCubiertos}/${totalMapas} mapas)`);

      return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === "log_admin") {
      const tieneRol = interaction.member.roles.cache.some(
        role => role.name.toLowerCase() === "prio1"
      );

      if (!tieneRol) {
        return interaction.reply({ content: "Necesitas el rol prio1 para usar este comando.", flags: MessageFlags.Ephemeral });
      }

      if (logAdmin.length === 0) {
        return interaction.reply({ content: "No hay cambios registrados hoy.", flags: MessageFlags.Ephemeral });
      }

      let texto = "";
      logAdmin.slice(-20).forEach(log => {
        const hora = new Date(log.timestamp).toISOString().slice(11, 16);
        texto += `• **${log.username}** — ${log.accion} — ${hora} UTC\n`;
      });

      const embed = new EmbedBuilder()
        .setTitle("📝 Log de Cambios Admin")
        .setColor(0xe91e63)
        .setDescription(texto);

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (interaction.commandName === "historial") {
      // Combinar historialDia con sesiones activas
      const todasSesiones = [...historialDia];

      for (const userId in scoutsActivos) {
        const entradas = scoutsActivos[userId];
        entradas.forEach(entry => {
          todasSesiones.push({
            userId,
            username: entry.username || userId,
            ciudad: entry.ciudad,
            mapa: entry.mapa,
            inicio: entry.inicio,
            fin: null,
            duracionMin: Math.floor((Date.now() - entry.inicio) / 60000)
          });
        });
      }

      if (todasSesiones.length === 0) {
        return interaction.reply({ content: "No hay actividad registrada hoy.", flags: MessageFlags.Ephemeral });
      }

      // Agrupar por usuario
      const porUsuario = {};
      todasSesiones.forEach(s => {
        const key = s.userId;
        if (!porUsuario[key]) {
          porUsuario[key] = {
            username: s.username || s.userId,
            mapas: 0,
            totalMin: 0,
            ultimaSalida: null,
            activo: false
          };
        }
        porUsuario[key].mapas++;
        porUsuario[key].totalMin += s.duracionMin || 0;
        if (!s.fin) {
          porUsuario[key].activo = true;
        } else {
          if (!porUsuario[key].ultimaSalida || s.fin > porUsuario[key].ultimaSalida) {
            porUsuario[key].ultimaSalida = s.fin;
          }
        }
      });

      // Ordenar por tiempo total
      const sorted = Object.values(porUsuario).sort((a, b) => b.totalMin - a.totalMin);

      let texto = "";
      sorted.forEach(u => {
        const horas = Math.floor(u.totalMin / 60);
        const mins = u.totalMin % 60;
        const tiempo = horas > 0 ? `${horas}h ${mins}min` : `${mins}min`;
        const estado = u.activo
          ? "activo"
          : u.ultimaSalida
            ? `salió ${new Date(u.ultimaSalida).toISOString().slice(11, 16)} UTC`
            : "inactivo";
        texto += `• **${u.username}** — ${u.mapas} mapas — ${tiempo} — ${estado}\n`;
      });

      const embed = new EmbedBuilder()
        .setTitle("📋 Historial del Día")
        .setColor(0xe91e63)
        .setDescription(texto)
        .setFooter({ text: "Se reinicia a las 10:00 UTC" });

      return interaction.reply({ embeds: [embed] });
    }
  }

  /* ===== BOTÓN: ABRIR ANOTARSE ===== */

  if (interaction.isButton() && interaction.customId === "abrir_anotarse") {
    return interaction.reply({ ...respuestaCiudades(), flags: MessageFlags.Ephemeral });
  }

  /* ===== BOTÓN: SELECCIONAR CIUDAD ===== */

  if (interaction.isButton() && interaction.customId.startsWith("ciudad_btn_")) {
    const ciudad = interaction.customId.replace("ciudad_btn_", "");
    return interaction.update(respuestaMapas(ciudad, interaction.user.id));
  }

  /* ===== BOTÓN: VOLVER A CIUDADES ===== */

  if (interaction.isButton() && interaction.customId === "volver_ciudades") {
    return interaction.update(respuestaCiudades());
  }

  /* ===== BOTÓN: REGISTRO MAPA ===== */

  if (interaction.isButton() && interaction.customId.startsWith("registro_btn_")) {
    const partes = interaction.customId.replace("registro_btn_", "").split("__");
    const ciudad = partes[0];
    const mapa = partes[1];
    const userId = interaction.user.id;

    await interaction.deferUpdate();

    if (!registros[ciudad]) registros[ciudad] = {};
    if (!registros[ciudad][mapa]) registros[ciudad][mapa] = [];

    if (registros[ciudad][mapa].includes(userId)) {
      // Ya está anotado → desanotarlo
      registros[ciudad][mapa] = registros[ciudad][mapa].filter(id => id !== userId);

      // Cerrar scout activo de ese mapa
      if (scoutsActivos[userId]) {
        const entry = scoutsActivos[userId].find(e => e.ciudad === ciudad && e.mapa === mapa);
        if (entry) {
          const duracionMin = Math.floor((Date.now() - entry.inicio) / 60000);
          const reg = { userId, username: interaction.user.username, ciudad, mapa, inicio: entry.inicio, fin: Date.now(), duracionMin };
          historialScouts.push(reg);
          historialDia.push(reg);
          scoutsActivos[userId] = scoutsActivos[userId].filter(e => !(e.ciudad === ciudad && e.mapa === mapa));
          if (scoutsActivos[userId].length === 0) delete scoutsActivos[userId];
          // Track ultima actividad para alerta 30min
          const cobKey2 = `${ciudad}__${mapa}`;
          if (!coberturaDia[cobKey2]) coberturaDia[cobKey2] = { ciudad, mapa, minutos: 0 };
          coberturaDia[cobKey2].ultimaActividad = Date.now();
        }
      }

      guardarDatos();
      guardarScouts();
      await actualizarPanel();
      await verificarMapaVacio(ciudad, mapa);

      const resp = respuestaMapas(ciudad, userId);
      resp.content = `❌ Saliste de **${mapa}**\n\n` + resp.content;
      return interaction.editReply(resp);

    } else if (registros[ciudad][mapa].length < 5) {
      // No está anotado y hay lugar → anotarlo
      registros[ciudad][mapa].push(userId);

      if (!scoutsActivos[userId]) scoutsActivos[userId] = [];
      scoutsActivos[userId].push({ ciudad, mapa, inicio: Date.now(), username: interaction.user.username });
      // Inicializar cobertura si no existe
      const cobKey = `${ciudad}__${mapa}`;
      if (!coberturaDia[cobKey]) coberturaDia[cobKey] = { ciudad, mapa, minutos: 0, inicio: Date.now() };

      guardarDatos();
      guardarScouts();
      await actualizarPanel();
      await verificarMapaVacio(ciudad, mapa);

      const resp = respuestaMapas(ciudad, userId);
      resp.content = `✅ Listo causa, ya estás en **${mapa}**\n\n` + resp.content;
      return interaction.editReply(resp);
    } else {
      // Lleno
      const resp = respuestaMapas(ciudad, userId);
      resp.content = `⚠️ **${mapa}** está lleno.\n\n` + resp.content;
      return interaction.editReply(resp);
    }
  }

  /* ===== BOTÓN: DROPEAR ===== */

  if (interaction.isButton() && interaction.customId === "dropear_mapas") {
    const userId = interaction.user.id;

    if (procesando.has(userId)) {
      return interaction.reply({ content: "⏳ Espera un momento...", flags: MessageFlags.Ephemeral });
    }
    procesando.add(userId);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Guardar mapas antes de dropear
    guardarUltimosMapas(userId);
    const tieneMaps = ultimosMapas[userId]?.length > 0;

    // Guardar qué mapas tenía antes de borrar
    const mapasDropeados = [];
    for (const c in registros) {
      for (const m in registros[c]) {
        if (registros[c][m].includes(userId)) mapasDropeados.push({ ciudad: c, mapa: m });
      }
    }

    cerrarScoutsActivos(userId);
    borrarRegistrosUsuario(userId);
    guardarDatos();
    guardarScouts();
    await actualizarPanel();

    // Verificar alertas para cada mapa que abandonó
    for (const { ciudad, mapa } of mapasDropeados) {
      await verificarMapaVacio(ciudad, mapa);
    }

    const msg = tieneMaps
      ? "🔴 Te borraste de todo pata.\nUsá **VOLVER A MIS MAPAS** en el panel para volver."
      : "🔴 Te borraste de todo pata.";

    await interaction.editReply({ content: msg });
    procesando.delete(userId);
  }

  /* ===== BOTÓN: VOLVER A MAPAS ===== */

  if (interaction.isButton() && (interaction.customId === "volver_mapas" || interaction.customId === "volver_mapas_panel")) {
    const userId = interaction.user.id;
    const lista = ultimosMapas[userId];

    if (!lista || lista.length === 0) {
      return interaction.reply({ content: "No tienes nada guardado pe.", flags: MessageFlags.Ephemeral });
    }

    const anotados = [];
    const saltados = [];

    for (const { ciudad, mapa } of lista) {
      if (!mapas[ciudad]?.includes(mapa)) {
        saltados.push(`${ciudad} - ${mapa} (eliminado)`);
        continue;
      }

      if (!registros[ciudad]) registros[ciudad] = {};
      if (!registros[ciudad][mapa]) registros[ciudad][mapa] = [];

      if (registros[ciudad][mapa].includes(userId)) continue;

      if (registros[ciudad][mapa].length >= 5) {
        saltados.push(`${ciudad} - ${mapa} (lleno)`);
        continue;
      }

      registros[ciudad][mapa].push(userId);

      if (!scoutsActivos[userId]) scoutsActivos[userId] = [];
      scoutsActivos[userId].push({ ciudad, mapa, inicio: Date.now() });

      anotados.push(`${ciudad} - ${mapa}`);
    }

    delete ultimosMapas[userId];

    guardarDatos();
    guardarScouts();
    await actualizarPanel();

    let respuesta = "";
    if (anotados.length > 0) respuesta += `✅ Ahí estás de vuelta hermano:\n${anotados.map(m => `• ${m}`).join("\n")}`;
    if (saltados.length > 0) respuesta += `\n⚠️ No se pudo:\n${saltados.map(m => `• ${m}`).join("\n")}`;
    if (!respuesta) respuesta = "No se pudo volver a ningún mapa.";

    return interaction.reply({ content: respuesta, flags: MessageFlags.Ephemeral });
  }

  /* ===== BOTÓN: REVISIÓN CIUDAD ===== */

  if (interaction.isButton() && interaction.customId.startsWith("revision_ciudad_")) {
    const ciudad = interaction.customId.replace("revision_ciudad_", "");
    await interaction.update({
      embeds: [generarEmbedRevision()],
      components: componentesRevision(ciudad)
    });
    return;
  }

  /* ===== BOTÓN: REVISIÓN VOLVER CIUDADES ===== */

  if (interaction.isButton() && interaction.customId === "revision_volver_ciudades") {
    await interaction.update({
      embeds: [generarEmbedRevision()],
      components: componentesRevision()
    });
    return;
  }

  /* ===== BOTÓN: REVISIÓN MAPA ===== */

  if (interaction.isButton() && interaction.customId.startsWith("revision_btn_")) {
    const key = interaction.customId.replace("revision_btn_", "");
    const userId = interaction.user.id;
    const ahora = Date.now();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [ciudad, mapa] = key.split("__");

    // Verificar rol Scout
    const tieneRol = interaction.member?.roles.cache.some(
      role => role.id === "1422971680480956547"
    );
    if (!tieneRol) {
      return interaction.editReply({ content: "Necesitas el rol Scout para marcar mapas." });
    }

    // Obtener revisores actuales (max 2, orden de llegada)
    let revisores = revisionEstado[key]?.revisores || [];

    if (!revisores.includes(userId)) {
      if (revisores.length >= 2) {
        // Sacar al primero, meter al nuevo
        revisores = [revisores[1], userId];
      } else {
        revisores = [...revisores, userId];
      }
    }

    // Guardar sin timeout — queda hasta reset manual
    revisionEstado[key] = { revisadoEn: ahora, revisores };

    // Responder primero antes de actualizar el panel
    await interaction.editReply({ content: `✅ **${mapa}** marcado como revisado.` });

    await actualizarRevision();
  }

  /* ===== SELECT: EDITAR CIUDAD ===== */

  if (interaction.isStringSelectMenu() && interaction.customId === "editar_ciudad") {
    const ciudad = interaction.values[0];

    const modal = new ModalBuilder()
      .setCustomId(`modal_${ciudad}`)
      .setTitle(`Editar mapas - ${ciudad}`);

    const input = new TextInputBuilder()
      .setCustomId("mapas_input")
      .setLabel("Pega mapas (uno por línea)")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  /* ===== SELECT: LIMPIAR SCOUT ===== */

  if (interaction.isStringSelectMenu() && interaction.customId === "select_limpiar_scout") {
    const userId = interaction.values[0];

    cerrarScoutsActivos(userId);
    borrarRegistrosUsuario(userId);

    guardarDatos();
    guardarScouts();
    await actualizarPanel();

    return interaction.update({
      content: `✅ Scout <@${userId}> removido correctamente.`,
      components: []
    });
  }

  /* ===== MODAL: CARGAR MAPAS BULK ===== */

  if (interaction.isModalSubmit() && interaction.customId === "modal_cargar_mapas") {
    const texto = interaction.fields.getTextInputValue("mapas_bulk_input");
    const lineas = texto.split("\n").map(l => l.trim());

    const ciudadesValidas = Object.keys(mapas);
    const iconosCiudadMap = {
      "lymhurst": "Lymhurst",
      "bridgewatch": "Bridgewatch",
      "fort sterling": "Fort Sterling",
      "fortsterling": "Fort Sterling",
      "thetford": "Thetford",
      "martlock": "Martlock",
      "zona roja": "Zona Roja",
      "redzone": "Zona Roja",
      "red zone": "Zona Roja"
    };

    let ciudadActual = null;
    const cambios = {};

    for (const linea of lineas) {
      if (!linea) continue;

      // Detectar si es una ciudad
      const lineaLower = linea.toLowerCase().replace(/:$/, "").trim();
      const ciudadMatch = iconosCiudadMap[lineaLower] ||
        ciudadesValidas.find(c => c.toLowerCase() === lineaLower);

      if (ciudadMatch || linea.endsWith(":")) {
        ciudadActual = ciudadMatch || ciudadesValidas.find(
          c => c.toLowerCase() === linea.replace(/:$/, "").trim().toLowerCase()
        );
        if (ciudadActual && !cambios[ciudadActual]) {
          cambios[ciudadActual] = [];
        }
        continue;
      }

      // Detectar "0 mapas" o "0 map"
      if (/^0\s*(map|mapas?)/i.test(linea)) {
        if (ciudadActual) cambios[ciudadActual] = [];
        continue;
      }

      // Es un mapa
      if (ciudadActual && linea.length > 0) {
        cambios[ciudadActual].push(linea);
      }
    }

    if (Object.keys(cambios).length === 0) {
      return interaction.reply({
        content: "No se detectó ninguna ciudad válida. Verificá el formato.",
        flags: MessageFlags.Ephemeral
      });
    }

    // Aplicar cambios
    const ciudadesEditadas = [];
    for (const ciudad in cambios) {
      // Cerrar scouts activos de esa ciudad
      for (const userId in scoutsActivos) {
        scoutsActivos[userId] = (scoutsActivos[userId] || []).filter(e => e.ciudad !== ciudad);
        if (scoutsActivos[userId].length === 0) delete scoutsActivos[userId];
      }
      mapas[ciudad] = cambios[ciudad];
      registros[ciudad] = {};
      ciudadesEditadas.push(`${ciudad} (${cambios[ciudad].length} mapas)`);

      logAdmin.push({
        userId: interaction.user.id,
        username: interaction.user.username,
        accion: `Cargó mapas de ${ciudad} via /cargar_mapas`,
        timestamp: Date.now()
      });
    }

    ultimaEdicion = Date.now();
    guardarDatos();
    guardarScouts();
    await actualizarPanel();

    return interaction.reply({
      content: `✅ Mapas cargados:\n${ciudadesEditadas.map(c => `• ${c}`).join("\n")}`,
      flags: MessageFlags.Ephemeral
    });
  }

  /* ===== MODAL: EDITAR MAPAS ===== */

  if (interaction.isModalSubmit()) {
    const ciudad = interaction.customId.replace("modal_", "");
    const texto = interaction.fields.getTextInputValue("mapas_input");
    const nuevos = texto.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    // Limpiar scouts activos de esa ciudad
    for (const userId in scoutsActivos) {
      scoutsActivos[userId] = (scoutsActivos[userId] || []).filter(e => e.ciudad !== ciudad);
      if (scoutsActivos[userId].length === 0) delete scoutsActivos[userId];
    }

    mapas[ciudad] = nuevos;
    registros[ciudad] = {};
    ultimaEdicion = Date.now();
    logAdmin.push({
      userId: interaction.user.id,
      username: interaction.user.username,
      accion: `Editó mapas de ${ciudad}`,
      timestamp: Date.now()
    });

    guardarDatos();
    guardarScouts();
    await actualizarPanel();

    const confirmMsg = await interaction.reply({ content: `✅ Mapas de **${ciudad}** actualizados.`, flags: MessageFlags.Ephemeral, withResponse: true });
    setTimeout(async () => {
      try { await confirmMsg.resource.message.delete(); } catch (e) {}
    }, 45000);
  }

});

/* ================= READY ================= */

// Handler global para evitar crashes por interacciones expiradas
process.on("unhandledRejection", (err) => {
  if (err?.code === 10062) return; // Unknown interaction - ignorar
  console.error("Unhandled rejection:", err);
});

client.on("error", (err) => {
  console.error("Client error:", err);
});

client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (message.content.toLowerCase() !== "!revisar") return;

  const tieneRol = message.member?.roles.cache.some(
    role => role.name.toLowerCase() === "scout"
  );

  if (!tieneRol) {
    return message.reply("Necesitas el rol Scout para usar este comando.");
  }

  const comps = componentesRevision();

  if (comps.length === 0) {
    return message.reply("No hay scouts anotados en ningún mapa.");
  }

  revisionMessage = await message.channel.send({
    embeds: [generarEmbedRevision()],
    components: comps
  });

  try { await message.delete(); } catch (e) {}
});

client.once("clientReady", async () => {
  console.log(`Bot listo: ${client.user.tag}`);

  try {
    if (panelChannelId && panelMessageId) {
      const channel = await client.channels.fetch(panelChannelId);
      panelMessage = await channel.messages.fetch(panelMessageId);
      console.log("Panel recuperado correctamente");
    }
  } catch (err) {
    console.log("No se pudo recuperar el panel:", err.message);
    panelChannelId = null;
    panelMessageId = null;
    panelMessage = null;
    guardarPanel();
    console.log("Panel.json limpiado, usar /panel_mapas para recrear.");
  }

  // Recuperar o crear panel de revisión
  try {
    const revChannel = await client.channels.fetch(REVISION_CHANNEL_ID);
    if (revisionMessageId) {
      try {
        revisionMessage = await revChannel.messages.fetch(revisionMessageId);
        console.log("Panel de revisión recuperado");
      } catch (e) {
        console.log("Panel de revisión no encontrado, creando nuevo...");
        revisionMessage = null;
        revisionMessageId = null;
        await crearPanelRevision();
      }
    } else {
      await crearPanelRevision();
    }
  } catch (err) {
    console.error("Error recuperando canal de revisión:", err);
  }

  programarReset();

  // Auto-actualizar panel de revisión cada minuto
  setInterval(async () => {
    await actualizarRevision();
  }, 60 * 1000);
});

client.login(TOKEN);
