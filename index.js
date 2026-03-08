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
const CLIENT_ID = "1473617798600200342";
const GUILD_ID = "969420681349574677";

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* ================= PERSISTENCIA ================= */

const DATA_FILE = './data.json';
const SCOUT_FILE = './scouts.json';
const PANEL_FILE = './panel.json';

let panelChannelId = null;
let panelMessageId = null;

let scoutsActivos = {};
let historialScouts = [];

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

function guardarDatos() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ mapas, registros }, null, 2));
}

function cargarDatos() {
  if (fs.existsSync(DATA_FILE)) {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    mapas = data.mapas || mapas;
    registros = data.registros || {};
  }
}

cargarDatos();

function cargarScouts() {
  if (fs.existsSync(SCOUT_FILE)) {
    const data = JSON.parse(fs.readFileSync(SCOUT_FILE, 'utf8'));
    scoutsActivos = data.activos || {};
    historialScouts = data.historial || [];
  }
}

function guardarScouts() {
  fs.writeFileSync(
    SCOUT_FILE,
    JSON.stringify(
      {
        activos: scoutsActivos,
        historial: historialScouts
      },
      null,
      2
    )
  );
}

cargarScouts();

function guardarPanel() {

  fs.writeFileSync(
    PANEL_FILE,
    JSON.stringify({
      channelId: panelChannelId,
      messageId: panelMessageId
    }, null, 2)
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
    .setDescription("Selecciona tu ciudad y registra tu mapa.\nMáximo 5 jugadores por mapa.")
    .setColor(0x8B5CF6)
    .setFooter({ text: `Actualizado • ${new Date().toLocaleDateString()}` });

  const iconos = {
    "Lymhurst": "🌲",
    "Bridgewatch": "🏜️",
    "Fort Sterling": "❄️",
    "Thetford": "🌿",
    "Martlock": "⛰️",
    "Zona Roja": "🔥"
  };

  for (const ciudad in mapas) {

    if (!mapas[ciudad] || mapas[ciudad].length === 0) continue;

    let texto = "";

    mapas[ciudad].forEach(mapa => {
      const users = registros[ciudad]?.[mapa] || [];
      const menciones = users.map(id => `<@${id}>`).join(" ");
      texto += `- **${mapa}** → ${menciones || "—"}\n`;
    });

    embed.addFields({
      name: `${iconos[ciudad]} ${ciudad}`,
      value: texto,
      inline: false
    });

  }

  return embed;
}

/* ===== SELECT CIUDAD FILTRADO ===== */

function selectCiudad(customId) {
  const ciudades =
    customId === "editar_ciudad"
      ? Object.keys(mapas)
      : Object.keys(mapas).filter(
          ciudad => mapas[ciudad] && mapas[ciudad].length > 0
        );

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("Selecciona ciudad")
      .addOptions(
        ciudades.map(ciudad => ({
          label: ciudad,
          value: ciudad
        }))
      )
  );
}

async function actualizarPanel() {
  if (!panelMessage) return;

  await panelMessage.edit({
    embeds: [generarEmbed()],
    components: panelMessage.components
  });
}

/* ================= EVENTOS ================= */

client.on("interactionCreate", async interaction => {

  /* ===== SLASH ===== */

  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "panel_mapas") {

      panelMessage = await interaction.reply({
        embeds: [generarEmbed()],
        components: [
          selectCiudad("registro_ciudad"),
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("dropear_mapas")
              .setLabel("Dropear mapas")
              .setStyle(ButtonStyle.Danger)
          )
        ],
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
        return interaction.reply({
          content: "Necesitas el rol prio1 para usar este comando.",
          ephemeral: true
        });
      }

      return interaction.reply({
        content: "Selecciona ciudad a editar:",
        components: [selectCiudad("editar_ciudad")],
        ephemeral: true
      });
    }

    if (interaction.commandName === "limpiar_scout") {

      const tieneRol = interaction.member.roles.cache.some(
        role => role.name.toLowerCase() === "prio1"
      );

      if (!tieneRol) {
        return interaction.reply({
          content: "Necesitas el rol prio1 para usar este comando.",
          ephemeral: true
        });
      }

      const scouts = new Set();

      for (const ciudad in registros) {
        for (const mapa in registros[ciudad]) {
          registros[ciudad][mapa].forEach(id => scouts.add(id));
        }
      }

      if (scouts.size === 0) {
        return interaction.reply({
          content: "No hay scouts registrados.",
          ephemeral: true
        });
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
        return interaction.reply({
          content: "Aún no hay scouts registrados.",
          ephemeral: true
        });
      }

      const ranking = {};

      historialScouts.forEach(s => {
        if (!ranking[s.userId]) ranking[s.userId] = 0;
        ranking[s.userId] += s.duracionMin;
      });

      const top = Object.entries(ranking)
        .sort((a,b) => b[1] - a[1])
        .slice(0,10);

      let texto = "";

      top.forEach(([userId, minutos], i) => {

        const horas = Math.floor(minutos / 60);
        const mins = minutos % 60;

        const tiempo =
          horas > 0 ? `${horas}h ${mins}m` : `${mins}m`;

        const medal =
          i === 0 ? "🥇" :
          i === 1 ? "🥈" :
          i === 2 ? "🥉" :
          `${i+1}.`;

        texto += `${medal} <@${userId}> — ${tiempo}\n`;
      });

      const embed = new EmbedBuilder()
        .setTitle("🏆 Ranking Scouts")
        .setColor(0xFFD700)
        .setDescription(texto);

      return interaction.reply({
        embeds: [embed]
      });
    }

  }

  /* ===== BOTÓN DROPEAR ===== */

  if (interaction.isButton() && interaction.customId === "dropear_mapas") {

    const userId = interaction.user.id;

    if (scoutsActivos[userId]) {

      const scout = scoutsActivos[userId];
      const fin = Date.now();
      const duracionMin = Math.floor((fin - scout.inicio) / 60000);

      historialScouts.push({
        userId,
        ciudad: scout.ciudad,
        mapa: scout.mapa,
        inicio: scout.inicio,
        fin,
        duracionMin
      });

      delete scoutsActivos[userId];
      guardarScouts();
    }

    for (const ciudad in registros) {
      for (const mapa in registros[ciudad]) {
        registros[ciudad][mapa] =
          registros[ciudad][mapa].filter(id => id !== userId);
      }
    }

    guardarDatos();
    await actualizarPanel();

    return interaction.reply({
      content: "Has dropeado todos tus mapas.",
      ephemeral: true
    });
  }

  /* ===== SELECT ===== */

  if (interaction.isStringSelectMenu()) {

    if (interaction.customId === "editar_ciudad") {

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

    if (interaction.customId === "registro_ciudad") {

      const ciudad = interaction.values[0];

      if (!mapas[ciudad].length) {
        return interaction.reply({
          content: "No hay mapas configurados.",
          ephemeral: true
        });
      }

      const filas = [];
      let fila = new ActionRowBuilder();

      mapas[ciudad].forEach((mapa, i) => {

        if (i % 5 === 0 && i !== 0) {
          filas.push(fila);
          fila = new ActionRowBuilder();
        }

        fila.addComponents(
          new ButtonBuilder()
            .setCustomId(`registro_btn_${ciudad}__${mapa}`)
            .setLabel(mapa)
            .setStyle(ButtonStyle.Primary)
        );

      });

      filas.push(fila);

      return interaction.reply({
        content: `Mapas en ${ciudad}:`,
        components: filas,
        ephemeral: true
      });
    }

    if (interaction.customId === "select_limpiar_scout") {

      const userId = interaction.values[0];

      for (const ciudad in registros) {
        for (const mapa in registros[ciudad]) {
          registros[ciudad][mapa] =
            registros[ciudad][mapa].filter(id => id !== userId);
        }
      }

      guardarDatos();
      await actualizarPanel();

      return interaction.update({
        content: `Scout <@${userId}> removido correctamente.`,
        components: []
      });
    }

  }

  /* ===== BOTÓN REGISTRO MAPA ===== */

  if (interaction.isButton() && interaction.customId.startsWith("registro_btn_")) {

    const partes = interaction.customId.replace("registro_btn_", "").split("__");

    const ciudad = partes[0];
    const mapa = partes[1];
    const userId = interaction.user.id;

    if (!registros[ciudad]) registros[ciudad] = {};
    if (!registros[ciudad][mapa]) registros[ciudad][mapa] = [];

    if (!registros[ciudad][mapa].includes(userId) &&
        registros[ciudad][mapa].length < 5) {

      registros[ciudad][mapa].push(userId);

      scoutsActivos[userId] = {
        ciudad,
        mapa,
        inicio: Date.now()
      };

      guardarDatos();
      guardarScouts();
      await actualizarPanel();
    }

    return interaction.reply({
      content: `Registrado en **${mapa}**`,
      ephemeral: true
    });
  }

  /* ===== MODAL ===== */

  if (interaction.isModalSubmit()) {

    const ciudad = interaction.customId.replace("modal_", "");
    const texto = interaction.fields.getTextInputValue("mapas_input");

    const nuevos = texto
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0);

    mapas[ciudad] = nuevos;
    registros[ciudad] = {};

    guardarDatos();
    await actualizarPanel();

    return interaction.reply({
      content: "Mapas actualizados.",
      ephemeral: true
    });
  }

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

    console.log("No se pudo recuperar el panel");

  }

});

client.login(TOKEN);
