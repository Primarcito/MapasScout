const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./config');
const state = require('./data/state');
const { cargarDatos, cargarScouts, cargarPanel, cargarRevisionPanel, guardarPanel } = require('./data/persistence');
const { registerCommands, getCommandsMap } = require('./commands/register');
const handleButton = require('./handlers/buttonHandler');
const handleSelect = require('./handlers/selectHandler');
const handleModal = require('./handlers/modalHandler');
const { generarEmbedRevision } = require('./embeds/revisionEmbed');
const { componentesRevision } = require('./components/revisionComponents');
const { programarReset } = require('./utils/reset');
const { actualizarPanel, actualizarRevision, crearPanelRevision } = require('./utils/panel');
const { startScoutVerification, isVerificationButton, handleVerificationScreenshotMessage } = require('./utils/verification');
const { startApiServer } = require('./api');
const { canScout } = require('./permissions');
const { sendCreatorMessage } = require('./utils/creatorMessages');

/* ================= CARGAR DATOS PERSISTIDOS ================= */

cargarDatos();
cargarScouts();
cargarPanel();
cargarRevisionPanel();
startApiServer();

/* ================= CREAR CLIENT ================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

state.client = client;

/* ================= REGISTRAR SLASH COMMANDS ================= */

const commands = getCommandsMap();

(async () => {
  await registerCommands();
})();

/* ================= ROUTER DE INTERACCIONES ================= */

client.on("interactionCreate", async interaction => {
  if (interaction.isButton() && isVerificationButton(interaction.customId)) {
    return handleButton(interaction);
  }

  if (interaction.guildId !== config.GUILD_ID) return;

  if (interaction.isChatInputCommand()) {
    const cmd = commands.get(interaction.commandName);
    if (cmd) return cmd.execute(interaction);
  }

  if (interaction.isButton()) return handleButton(interaction);
  if (interaction.isStringSelectMenu()) return handleSelect(interaction);
  if (interaction.isModalSubmit()) return handleModal(interaction);
});

/* ================= MENSAJE !revisar ================= */

client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.guild) {
    await handleVerificationScreenshotMessage(message);
    return;
  }

  if (message.content.toLowerCase() !== "!revisar") return;

  if (!canScout(message.member)) {
    return message.reply("Necesitas el rol Scout para usar este comando.");
  }

  const comps = componentesRevision();

  if (comps.length === 0) {
    return message.reply("No hay scouts anotados en ningún mapa.");
  }

  state.revisionMessage = await message.channel.send({
    embeds: [generarEmbedRevision()],
    components: comps
  });

  try { await message.delete(); } catch (e) {}
});

/* ================= HANDLER GLOBAL DE ERRORES ================= */

process.on("unhandledRejection", (err) => {
  if (err?.code === 10062) return; // Unknown interaction - ignorar
  console.error("Unhandled rejection:", err);
});

client.on("error", (err) => {
  console.error("Client error:", err);
});

/* ================= READY ================= */

client.once("clientReady", async () => {
  console.log(`Bot listo: ${client.user.tag}`);

  if (config.CREATOR_NOTIFY_STARTUP) {
    await sendCreatorMessage(`Bot de mapas listo: **${client.user.tag}**`);
  }

  try {
    if (state.panelChannelId && state.panelMessageId) {
      const channel = await client.channels.fetch(state.panelChannelId);
      state.panelMessage = await channel.messages.fetch(state.panelMessageId);
      console.log("Panel recuperado correctamente");
    } else if (state.panelChannelId) {
      await actualizarPanel();
    }
  } catch (err) {
    if (err?.code === 10008 && state.panelChannelId) {
      console.log("Panel guardado no encontrado, recreando en el mismo canal...");
      state.panelMessage = null;
      state.panelMessageId = null;
      await actualizarPanel();
    } else {
      console.log("No se pudo recuperar el panel:", err.message);
      state.panelChannelId = null;
      state.panelMessageId = null;
      state.panelMessage = null;
      guardarPanel();
      console.log("Panel.json limpiado, usar /mapas panel para recrear.");
    }
  }

  // Recuperar o crear panel de revisión
  try {
    const revChannel = await client.channels.fetch(config.REVISION_CHANNEL_ID);
    if (state.revisionMessageId) {
      try {
        state.revisionMessage = await revChannel.messages.fetch(state.revisionMessageId);
        console.log("Panel de revisión recuperado");
      } catch (e) {
        console.log("Panel de revisión no encontrado, creando nuevo...");
        state.revisionMessage = null;
        state.revisionMessageId = null;
        await crearPanelRevision();
      }
    } else {
      await crearPanelRevision();
    }
  } catch (err) {
    console.error("Error recuperando canal de revisión:", err);
  }

  programarReset();
  startScoutVerification();

  // Auto-actualizar panel de revisión cada minuto
  setInterval(async () => {
    await actualizarRevision();
  }, 60 * 1000);
});

client.login(config.TOKEN);
