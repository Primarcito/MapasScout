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

// 🔹 Cargar datos al iniciar
if (fs.existsSync('data.json')) {
  registros = JSON.parse(fs.readFileSync('data.json', 'utf8'));
}

// 🔹 Guardar datos
function guardarDatos() {
  fs.writeFileSync('data.json', JSON.stringify(registros, null, 2));
}

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

  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "panel_mapas") {

      await interaction.reply({
        embeds: [generarEmbed()],
        components: [
          selectCiudad("registro_ciudad"),
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("dropear_mapas")
              .setLabel("Dropear mapas")
              .setStyle(ButtonStyle.Danger)
          )
        ]
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

  /* ===== BOTÓN DROPEAR ===== */
  if (interaction.isButton() && interaction.customId === "dropear_mapas") {

    const userId = interaction.user.id;

    for (const ciudad in registros) {
      for (const mapa in registros[ciudad]) {
        registros[ciudad][mapa] =
          registros[ciudad][mapa].filter(id => id !== userId);
      }
    }

    guardarDatos();

    await interaction.update({
      embeds: [generarEmbed()],
      components: interaction.message.components
    });

    return;
  }

  /* ===== SELECT REGISTRO ===== */
  if (interaction.isStringSelectMenu()) {

    const ciudad = interaction.values[0];

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

      if (!registros[ciudad][mapa].includes(userId)) {
        if (registros[ciudad][mapa].length < 3) {
          registros[ciudad][mapa].push(userId);
          guardarDatos();
        }
      }

      await interaction.update({
        embeds: [generarEmbed()],
        components: interaction.message.components
      });

      return;
    }
  }

});

client.login(TOKEN);
