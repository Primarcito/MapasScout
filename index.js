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
  ButtonStyle
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

const SCOUT_ROLE_ID = "1422971680480956547";

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
  }
}

function guardarScouts() {
  fs.writeFileSync(
    SCOUT_FILE,
    JSON.stringify({ activos: scoutsActivos, historial: historialScouts, ultimosMapas }, null, 2)
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
    .setName("top_scouts")
    .setDescription("Ranking Scouts"),

  new SlashCommandBuilder()
    .setName("revisar")
    .setDescription("Crear el panel de revisión de mapas"),

  new SlashCommandBuilder()
    .setName("reset_revision")
    .setDescription("Limpiar el panel de revisión (solo prio1)")
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
})();

/* ================= EMBED ================= */

function generarEmbed() {
  const embed = new EmbedBuilder()
    .setTitle("🗺️ Mapas del Día")
    .setDescription("Usa el botón **Anotarse** para registrarte en un mapa.\nMáximo 5 scouts por mapa.")
    .setColor(0xe91e63)
    .setFooter({ text: `Actualizado • ${new Date().toLocaleString('es-AR', { timeZone: 'UTC' })} UTC` });

  const iconos = {
    "Lymhurst": "🌲",
    "Bridgewatch": "🏜️",
    "Fort Sterling": "❄️",
    "Thetford": "🌾",
    "Martlock": "⛰️",
    "Zona Roja": "🔴"
  };

  let hayMapas = false;

  for (const ciudad in mapas) {
    if (!mapas[ciudad] || mapas[ciudad].length === 0) continue;

    hayMapas = true;
    let texto = "";

    mapas[ciudad].forEach(mapa => {
      const users = registros[ciudad]?.[mapa] || [];
      const menciones = users.map(id => `<@${id}>`).join(" ");
      const lleno = users.length >= 5;
      texto += `${lleno ? "🔴 " : "- "}**${mapa}** → ${menciones}\n`;
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

function cerrarScoutsActivos(userId) {
  const entradas = scoutsActivos[userId];
  if (!entradas || entradas.length === 0) return;

  const fin = Date.now();
  entradas.forEach(entry => {
    const duracionMin = Math.floor((fin - entry.inicio) / 60000);
    historialScouts.push({
      userId,
      ciudad: entry.ciudad,
      mapa: entry.mapa,
      inicio: entry.inicio,
      fin,
      duracionMin
    });
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

  ciudadesDisponibles.forEach((ciudad, i) => {
    if (i % 5 === 0 && i !== 0) {
      filas.push(fila);
      fila = new ActionRowBuilder();
    }
    fila.addComponents(
      new ButtonBuilder()
        .setCustomId(`ciudad_btn_${ciudad}`)
        .setLabel(ciudad)
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

  for (const userId in scoutsActivos) cerrarScoutsActivos(userId);

  ultimosMapas = {};
  ultimaEdicion = null;

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

  const embed = new EmbedBuilder()
    .setTitle("🔍 Revisión de Mapas")
    .setDescription("Marca tu mapa cada 5 minutos")
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
        const mins = Math.floor((ahora - estado.revisadoEn) / 60000);
        const menciones = estado.revisores.map(id => `<@${id}>`).join(" ");
        texto += `- ✅ **${mapa}** — ${menciones} hace ${mins}min
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

function componentesRevision() {
  const filas = [];
  let fila = new ActionRowBuilder();
  let count = 0;

  for (const ciudad in mapas) {
    if (!mapas[ciudad] || mapas[ciudad].length === 0) continue;

    mapas[ciudad].forEach(mapa => {
      if (count % 5 === 0 && count !== 0) {
        filas.push(fila);
        fila = new ActionRowBuilder();
      }

      const key = `${ciudad}__${mapa}`;
      const revisado = revisionEstado[key]?.revisores?.length > 0;

      fila.addComponents(
        new ButtonBuilder()
          .setCustomId(`revision_btn_${key}`)
          .setLabel(revisado ? `✅ ${mapa}` : mapa)
          .setStyle(revisado ? ButtonStyle.Success : ButtonStyle.Secondary)
      );

      count++;
    });
  }

  if (count > 0) filas.push(fila);
  return filas;
}

async function actualizarRevision() {
  if (!revisionMessage) return;
  try {
    await revisionMessage.edit({
      embeds: [generarEmbedRevision()],
      components: componentesRevision()
    });
  } catch (err) {
    console.error("Error actualizando panel revisión:", err);
    revisionMessage = null;
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
      panelMessage = await interaction.reply({
        embeds: [generarEmbed()],
        components: componentesPanel(),
        fetchReply: true
      });

      panelChannelId = panelMessage.channel.id;
      panelMessageId = panelMessage.id;
      guardarPanel();
      return;
    }

    if (interaction.commandName === "editar_mapas") {
      const tieneRol = interaction.member.roles.cache.some(
        role => role.name.toLowerCase() === "prio1"
      );

      if (!tieneRol) {
        return interaction.reply({ content: "Necesitas el rol prio1 para usar este comando.", ephemeral: true });
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId("editar_ciudad")
        .setPlaceholder("Selecciona ciudad")
        .addOptions(Object.keys(mapas).map(c => ({ label: c, value: c })));

      return interaction.reply({
        content: "Selecciona ciudad a editar:",
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true
      });
    }

    if (interaction.commandName === "limpiar_scout") {
      const tieneRol = interaction.member.roles.cache.some(
        role => role.name.toLowerCase() === "prio1"
      );

      if (!tieneRol) {
        return interaction.reply({ content: "Necesitas el rol prio1 para usar este comando.", ephemeral: true });
      }

      const scouts = new Set();
      for (const ciudad in registros) {
        for (const mapa in registros[ciudad]) {
          registros[ciudad][mapa].forEach(id => scouts.add(id));
        }
      }

      if (scouts.size === 0) {
        return interaction.reply({ content: "No hay scouts registrados.", ephemeral: true });
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
        ephemeral: true
      });
    }

    if (interaction.commandName === "reset_revision") {
      const tieneRol = interaction.member.roles.cache.some(
        role => role.name.toLowerCase() === "prio1"
      );

      if (!tieneRol) {
        return interaction.reply({
          content: "Necesitas el rol prio1 para usar este comando.",
          ephemeral: true
        });
      }

      // Limpiar todos los estados de revisión
      for (const key in revisionEstado) {
        if (revisionEstado[key]?.timeout) clearTimeout(revisionEstado[key].timeout);
        delete revisionEstado[key];
      }

      // Intentar borrar el mensaje del panel de revisión
      if (revisionMessage) {
        try { await revisionMessage.delete(); } catch (e) {}
        revisionMessage = null;
      }

      return interaction.reply({
        content: "✅ Panel de revisión limpiado.",
        ephemeral: true
      });
    }

    if (interaction.commandName === "revisar") {
      const tieneRol = interaction.member.roles.cache.some(
        role => role.name.toLowerCase() === "scout"
      );

      if (!tieneRol) {
        return interaction.reply({
          content: "Necesitas el rol Scout para usar este comando.",
          ephemeral: true
        });
      }

      const comps = componentesRevision();

      if (comps.length === 0) {
        return interaction.reply({
          content: "No hay scouts anotados en ningún mapa.",
          ephemeral: true
        });
      }

      revisionMessage = await interaction.reply({
        embeds: [generarEmbedRevision()],
        components: comps,
        fetchReply: true
      });

      return;
    }

    if (interaction.commandName === "top_scouts") {
      if (historialScouts.length === 0) {
        return interaction.reply({ content: "Aún no hay scouts registrados.", ephemeral: true });
      }

      const ranking = {};
      historialScouts.forEach(s => {
        if (!ranking[s.userId]) ranking[s.userId] = 0;
        ranking[s.userId] += s.duracionMin;
      });

      const top = Object.entries(ranking).sort((a, b) => b[1] - a[1]).slice(0, 10);
      let texto = "";

      top.forEach(([userId, minutos], i) => {
        const horas = Math.floor(minutos / 60);
        const mins = minutos % 60;
        const tiempo = horas > 0 ? `${horas}h ${mins}m` : `${mins}m`;
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
        texto += `${medal} <@${userId}> — ${tiempo}\n`;
      });

      const embed = new EmbedBuilder()
        .setTitle("🏆 Ranking Scouts")
        .setColor(0xFFD700)
        .setDescription(texto);

      return interaction.reply({ embeds: [embed] });
    }
  }

  /* ===== BOTÓN: ABRIR ANOTARSE ===== */

  if (interaction.isButton() && interaction.customId === "abrir_anotarse") {
    return interaction.reply({ ...respuestaCiudades(), ephemeral: true });
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
          historialScouts.push({ userId, ciudad, mapa, inicio: entry.inicio, fin: Date.now(), duracionMin });
          scoutsActivos[userId] = scoutsActivos[userId].filter(e => !(e.ciudad === ciudad && e.mapa === mapa));
          if (scoutsActivos[userId].length === 0) delete scoutsActivos[userId];
        }
      }

      guardarDatos();
      guardarScouts();
      await actualizarPanel();
      await verificarMapaVacio(ciudad, mapa);

      const resp = respuestaMapas(ciudad, userId);
      resp.content = `❌ Saliste de **${mapa}**\n\n` + resp.content;
      return interaction.update(resp);

    } else if (registros[ciudad][mapa].length < 5) {
      // No está anotado y hay lugar → anotarlo
      registros[ciudad][mapa].push(userId);

      if (!scoutsActivos[userId]) scoutsActivos[userId] = [];
      scoutsActivos[userId].push({ ciudad, mapa, inicio: Date.now() });

      guardarDatos();
      guardarScouts();
      await actualizarPanel();
      await verificarMapaVacio(ciudad, mapa);

      const resp = respuestaMapas(ciudad, userId);
      resp.content = `✅ Listo causa, ya estás en **${mapa}**\n\n` + resp.content;
      return interaction.update(resp);
    } else {
      // Lleno
      const resp = respuestaMapas(ciudad, userId);
      resp.content = `⚠️ **${mapa}** está lleno.\n\n` + resp.content;
      return interaction.update(resp);
    }
  }

  /* ===== BOTÓN: DROPEAR ===== */

  if (interaction.isButton() && interaction.customId === "dropear_mapas") {
    const userId = interaction.user.id;

    if (procesando.has(userId)) {
      return interaction.reply({ content: "⏳ Espera un momento...", ephemeral: true });
    }
    procesando.add(userId);
    await interaction.deferReply({ ephemeral: true });

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
      return interaction.reply({ content: "No tienes nada guardado pe.", ephemeral: true });
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

    return interaction.reply({ content: respuesta, ephemeral: true });
  }

  /* ===== BOTÓN: REVISIÓN MAPA ===== */

  if (interaction.isButton() && interaction.customId.startsWith("revision_btn_")) {
    const key = interaction.customId.replace("revision_btn_", "");
    const userId = interaction.user.id;
    const ahora = Date.now();

    const [ciudad, mapa] = key.split("__");

    // Verificar rol Scout
    const tieneRol = interaction.member?.roles.cache.some(
      role => role.id === "1422971680480956547"
    );
    if (!tieneRol) {
      return interaction.reply({
        content: "Necesitas el rol Scout para marcar mapas.",
        ephemeral: true
      });
    }

    // Limpiar timeout anterior si existe
    if (revisionEstado[key]?.timeout) {
      clearTimeout(revisionEstado[key].timeout);
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

    // Marcar como revisado
    const timeout = setTimeout(async () => {
      delete revisionEstado[key];
      await actualizarRevision();
    }, 5 * 60 * 1000);

    revisionEstado[key] = { revisadoEn: ahora, revisores, timeout };

    await actualizarRevision();

    return interaction.reply({
      content: `✅ **${mapa}** marcado como revisado.`,
      ephemeral: true
    });
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

    guardarDatos();
    guardarScouts();
    await actualizarPanel();

    return interaction.reply({ content: `✅ Mapas de **${ciudad}** actualizados.`, ephemeral: true });
  }

});

/* ================= READY ================= */

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

  programarReset();
});

client.login(TOKEN);
