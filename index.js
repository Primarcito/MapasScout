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

/* ================= COMANDOS ================= */

const commands = [
  new SlashCommandBuilder()
    .setName("panel_mapas")
    .setDescription("Crear el panel principal de mapas"),

  new SlashCommandBuilder()
    .setName("editar_mapas")
    .setDescription("Editar mapas de una ciudad")
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
              .setCustomId("salir_mapa")
              .setLabel("Salir del mapa")
              .setStyle(ButtonStyle.Danger)
          )
        ],
        fetchReply: true
      });

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
  }

  /* ===== BOTÓN SALIR ===== */
  if (interaction.isButton()) {

    if (interaction.customId === "salir_mapa") {

      const userId = interaction.user.id;
      let eliminado = false;

      for (const ciudad in registros) {
        for (const mapa in registros[ciudad]) {
          const antes = registros[ciudad][mapa].length;
          registros[ciudad][mapa] = registros[ciudad][mapa].filter(id => id !== userId);
          if (registros[ciudad][mapa].length < antes) eliminado = true;
        }
      }

      if (panelMessage) {
        panelMessage.edit({ embeds: [generarEmbed()] });
      }

      return interaction.reply({
        content: eliminado
          ? "Has salido de todos los mapas."
          : "No estabas registrado en ningún mapa.",
        ephemeral: true
      });
    }
  }

  /* ===== SELECT ===== */
  if (interaction.isStringSelectMenu()) {

    const ciudad = interaction.values[0];

    if (interaction.customId === "editar_ciudad") {

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

      if (!mapas[ciudad].length) {
        return interaction.reply({ content: "No hay mapas configurados.", ephemeral: true });
      }

      const selectMapa = new StringSelectMenuBuilder()
        .setCustomId(`registro_mapa_${ciudad}`)
        .setPlaceholder("Selecciona mapa")
        .addOptions(mapas[ciudad].map(m => ({
          label: m,
          value: m
        })));

      return interaction.reply({
        content: `Mapas en ${ciudad}:`,
        components: [new ActionRowBuilder().addComponents(selectMapa)],
        ephemeral: true
      });
    }

    if (interaction.customId.startsWith("registro_mapa_")) {

      const ciudad = interaction.customId.replace("registro_mapa_", "");
      const mapa = interaction.values[0];
      const userId = interaction.user.id;

      if (!registros[ciudad]) registros[ciudad] = {};
      if (!registros[ciudad][mapa]) registros[ciudad][mapa] = [];

      if (registros[ciudad][mapa].includes(userId)) {
        return interaction.reply({
          content: "Ya estás en este mapa.",
          ephemeral: true
        });
      }

      if (registros[ciudad][mapa].length >= 3) {
        return interaction.reply({
          content: "Mapa lleno (3/3).",
          ephemeral: true
        });
      }

      registros[ciudad][mapa].push(userId);

      if (panelMessage) {
        panelMessage.edit({ embeds: [generarEmbed()] });
      }

      return interaction.reply({
        content: "Registrado correctamente.",
        ephemeral: true
      });
    }
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

    if (panelMessage) {
      panelMessage.edit({ embeds: [generarEmbed()] });
    }

    return interaction.reply({
      content: "Mapas actualizados.",
      ephemeral: true
    });
  }

});

client.login(TOKEN);
