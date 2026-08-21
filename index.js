const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./config');
const state = require('./data/state');
const { cargarDatos, cargarScouts, cargarPanel, cargarRevisionPanel, guardarRevisionPanel } = require('./data/persistence');
const { registerCommands, getCommandsMap } = require('./commands/register');
const handleButton = require('./handlers/buttonHandler');
const handleSelect = require('./handlers/selectHandler');
const handleModal = require('./handlers/modalHandler');
const { programarReset, recoverMissedDailyReset } = require('./utils/reset');
const {
  actualizarPanel,
  actualizarRevision,
  crearPanelRevisionMovil,
  republicarPanelPrincipal,
} = require('./utils/panel');
const { startScoutVerification, isVerificationButton, handleVerificationScreenshotMessage } = require('./utils/verification');
const { startApiServer } = require('./api');
const { canScout } = require('./permissions');
const { sendCreatorMessage } = require('./utils/creatorMessages');
const { sincronizarMensajeAlertas } = require('./utils/alerts');
const { startRevisionRounds, beginRevisionRound } = require('./utils/revisionRounds');
const { sendOneTimeReply } = require('./utils/oneTimeReplies');

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

let mapsPanelRepostTimer = null;

function programarRepublicacionPanelMapas(channel) {
  if (!channel?.send || channel.id !== config.MAPS_CHANNEL_ID) return;
  if (mapsPanelRepostTimer) clearTimeout(mapsPanelRepostTimer);

  mapsPanelRepostTimer = setTimeout(async () => {
    mapsPanelRepostTimer = null;
    try {
      await republicarPanelPrincipal(channel);
    } catch (err) {
      console.error('No se pudo devolver el panel principal al final del canal:', err);
    }
  }, config.MAPS_PANEL_REPOST_DELAY_MS);
}

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
  if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
    return handleSelect(interaction);
  }
  if (interaction.isModalSubmit()) return handleModal(interaction);
});

/* ================= MENSAJE !revisar ================= */

client.on("messageCreate", async message => {
  if (message.author.bot) return;
  if (!message.guild) {
    await handleVerificationScreenshotMessage(message);
    return;
  }

  programarRepublicacionPanelMapas(message.channel);

  if (message.content.trim().toLowerCase() !== "!revisar") return;

  if (!canScout(message.member)) {
    return message.reply("Necesitas el rol Scout para usar este comando.");
  }

  const { created } = await beginRevisionRound(Date.now(), { announce: false });
  await crearPanelRevisionMovil(message.channel, { mentionRole: true, created });

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
    const replied = await sendOneTimeReply(client);
    if (replied) console.log('Respuesta troll de la piedra enviada.');
  } catch (err) {
    console.error('No se pudo enviar la respuesta troll de la piedra:', err);
  }

  try {
    const mapsChannel = await client.channels.fetch(config.MAPS_CHANNEL_ID);
    await republicarPanelPrincipal(mapsChannel);
    console.log('Panel principal publicado al final del canal de mapas');
  } catch (err) {
    console.error('No se pudo publicar el panel principal en el canal de mapas:', err);
  }

  // Recuperar el panel de revisión si ya existe. Nunca publicarlo por un redeploy.
  try {
    const revChannel = await client.channels.fetch(config.REVISION_CHANNEL_ID);
    if (state.revisionMessageId) {
      try {
        state.revisionMessage = await revChannel.messages.fetch(state.revisionMessageId);
        console.log("Panel de revisión recuperado");
      } catch (e) {
        console.log("Panel de revisión no encontrado; se esperará a /revisar.");
        state.revisionMessage = null;
        state.revisionMessageId = null;
        guardarRevisionPanel();
      }
    }
  } catch (err) {
    console.error("Error recuperando canal de revisión:", err);
  }

  if (state.revisionMobileChannelId && state.revisionMobileMessageId) {
    try {
      const mobileChannel = await client.channels.fetch(state.revisionMobileChannelId);
      state.revisionMobileMessage = await mobileChannel.messages.fetch(state.revisionMobileMessageId);
      console.log('Panel móvil de revisión recuperado');
    } catch (err) {
      state.revisionMobileMessage = null;
      state.revisionMobileMessageId = null;
      state.revisionMobileChannelId = null;
      guardarRevisionPanel();
    }
  }

  const recoveredReset = await recoverMissedDailyReset();
  if (recoveredReset) console.log('Se recuperó un cierre diario que Railway no alcanzó a ejecutar.');
  programarReset();
  startScoutVerification();
  const discardedRevision = startRevisionRounds();
  if (discardedRevision) {
    console.log('Ronda residual descartada al iniciar; se esperará a /revisar.');
    await actualizarRevision();
  }
  await sincronizarMensajeAlertas();

  // Mantener tiempos, prefijos de alerta y mensaje consolidado al día.
  setInterval(async () => {
    try {
      await sincronizarMensajeAlertas();
      await actualizarPanel({ recrearSiFalta: false });
    } catch (err) {
      console.error('Error actualizando alertas de mapas:', err);
    }
  }, 60 * 1000);

  // Auto-actualizar panel de revisión cada minuto
  setInterval(async () => {
    await actualizarRevision();
  }, 60 * 1000);
});

client.login(config.TOKEN);
