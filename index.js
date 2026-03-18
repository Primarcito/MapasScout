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
  intents: [GatewayIntentBits.Guilds]
});

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
    .setDescription("Ranking Scouts")
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
    .setDescription("Usá el botón **Anotarse** para registrarte en un mapa.\nMáximo 5 scouts por mapa.")
    .setColor(0x8B5CF6)
    .setFooter({ text: `Actualizado • ${new Date().toLocaleString('es-AR', { timeZone: 'UTC' })} UTC` });

  const iconos = {
    "Lymhurst": "🌲",
    "Bridgewatch": "🏜️",
    "Fort Sterling": "❄️",
    "Thetford": "🌿",
    "Martlock": "⛰️",
    "Zona Roja": "🔥"
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
      texto += `${lleno ? "🔴 " : ""}**${mapa}** → ${menciones}\n`;
    });

    embed.addFields({
      name: `${iconos[ciudad] || "📍"} ${ciudad}`,
      value: texto + "\u200b",
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
        .setLabel("Dropear")
        .setStyle(ButtonStyle.Danger)
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

  return { content: "📍 **Seleccioná una ciudad:**", components: filas };
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
    const label = lleno ? `🔴 ${mapa}` : `${mapa} (${users.length}/5)`;

    fila.addComponents(
      new ButtonBuilder()
        .setCustomId(`registro_btn_${ciudad}__${mapa}`)
        .setLabel(label)
        .setStyle(lleno ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setDisabled(lleno || yaAnotado)
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

  return { content: `📍 **${ciudad}** — elegí tu mapa:`, components: filas };
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
        await panelMessage.channel.send(
          "⚠️ **Reset cancelado** — Los mapas fueron actualizados hoy. El panel sigue vigente."
        );
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

    if (!registros[ciudad][mapa].includes(userId) && registros[ciudad][mapa].length < 5) {
      registros[ciudad][mapa].push(userId);

      if (!scoutsActivos[userId]) scoutsActivos[userId] = [];
      scoutsActivos[userId].push({ ciudad, mapa, inicio: Date.now() });

      guardarDatos();
      guardarScouts();
      await actualizarPanel();
    }

    // Actualizar el ephemeral mostrando los mapas actualizados
    const resp = respuestaMapas(ciudad, userId);
    resp.content = `✅ Registrado en **${mapa}**\n\n` + resp.content;
    return interaction.update(resp);
  }

  /* ===== BOTÓN: DROPEAR ===== */

  if (interaction.isButton() && interaction.customId === "dropear_mapas") {
    const userId = interaction.user.id;

    guardarUltimosMapas(userId);
    cerrarScoutsActivos(userId);
    borrarRegistrosUsuario(userId);

    guardarDatos();
    guardarScouts();
    await actualizarPanel();

    const tieneUltimos = ultimosMapas[userId]?.length > 0;

    return interaction.reply({
      content: "🔴 Dropeaste todos tus mapas." + (tieneUltimos ? "\nPodés volver a anotarte con el botón." : ""),
      components: tieneUltimos
        ? [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("volver_mapas")
              .setLabel("↩️ Volver a mis mapas")
              .setStyle(ButtonStyle.Success)
          )]
        : [],
      ephemeral: true
    });
  }

  /* ===== BOTÓN: VOLVER A MAPAS ===== */

  if (interaction.isButton() && interaction.customId === "volver_mapas") {
    const userId = interaction.user.id;
    const lista = ultimosMapas[userId];

    if (!lista || lista.length === 0) {
      return interaction.update({ content: "No tenés mapas guardados para volver.", components: [] });
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
    if (anotados.length > 0) respuesta += `✅ Volviste a:\n${anotados.map(m => `• ${m}`).join("\n")}`;
    if (saltados.length > 0) respuesta += `\n⚠️ No se pudo:\n${saltados.map(m => `• ${m}`).join("\n")}`;
    if (!respuesta) respuesta = "No se pudo volver a ningún mapa.";

    return interaction.update({ content: respuesta, components: [] });
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
  }

  programarReset();
});

client.login(TOKEN);
