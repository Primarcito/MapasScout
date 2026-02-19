require('dotenv').config();

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

/* ================= DATOS ================= */

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
let historialDrop = {}; // 🔥 NUEVO

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
    .setDescription("Remover un scout registrado (solo prio1)")
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
    .setDescription("Selecciona tu ciudad y registra tu mapa.\nMáximo 3 jugadores por mapa.")
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
    let texto = "";

    mapas[ciudad].forEach(mapa => {
      const users = registros[ciudad]?.[mapa] || [];
      const menciones = users.map(id => `<@${id}>`).join(" ");
      texto += `- **${mapa}** → ${menciones || "—"}\n`;
    });

    embed.addFields({
      name: `${iconos[ciudad]} ${ciudad}`,
      value: texto || "Sin mapas configurados",
      inline: false
    });
  }

  return embed;
}

function selectCiudad(customId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("Selecciona ciudad")
      .addOptions(Object.keys(mapas).map(ciudad => ({
        label: ciudad,
        value: ciudad
      })))
  );
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
              .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
              .setCustomId("volver_mapas")
              .setLabel("Volver a mapas")
              .setStyle(ButtonStyle.Success)
          )
        ],
        fetchReply: true
      });

      return;
    }
  }

  /* ===== BOTONES ===== */
  if (interaction.isButton()) {

    const userId = interaction.user.id;

    // 🔴 DROPEAR MAPAS
    if (interaction.customId === "dropear_mapas") {

      let eliminado = false;
      historialDrop[userId] = [];

      for (const ciudad in registros) {
        for (const mapa in registros[ciudad]) {

          if (registros[ciudad][mapa].includes(userId)) {

            historialDrop[userId].push({ ciudad, mapa });

            registros[ciudad][mapa] =
              registros[ciudad][mapa].filter(id => id !== userId);

            eliminado = true;
          }
        }
      }

      if (panelMessage) {
        panelMessage.edit({ embeds: [generarEmbed()] });
      }

      return interaction.reply({
        content: eliminado
          ? "Has dropeado tus mapas. Puedes volver a restaurarlos."
          : "No estabas registrado en ningún mapa.",
        ephemeral: true
      });
    }

    // 🟢 VOLVER A MAPAS
    if (interaction.customId === "volver_mapas") {

      if (!historialDrop[userId] || historialDrop[userId].length === 0) {
        return interaction.reply({
          content: "No tienes mapas para restaurar.",
          ephemeral: true
        });
      }

      historialDrop[userId].forEach(({ ciudad, mapa }) => {

        if (!registros[ciudad]) registros[ciudad] = {};
        if (!registros[ciudad][mapa]) registros[ciudad][mapa] = [];

        if (registros[ciudad][mapa].length < 3) {
          registros[ciudad][mapa].push(userId);
        }
      });

      delete historialDrop[userId];

      if (panelMessage) {
        panelMessage.edit({ embeds: [generarEmbed()] });
      }

      return interaction.reply({
        content: "Tus mapas fueron restaurados correctamente.",
        ephemeral: true
      });
    }
  }

  /* ===== SELECT Y MODAL siguen igual que los tuyos ===== */
});

client.login(TOKEN);
