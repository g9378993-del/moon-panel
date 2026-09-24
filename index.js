require('dotenv').config();
const crypto = require('crypto');
const https = require('https');
const db = require('./db');
const { t, SUPPORTED_LANGS } = require('./lang');
const { obfuscateScript } = require('./obfuscate');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  Events,
} = require('discord.js');

// ----------------------------------------------------------------
// CONFIG
// ----------------------------------------------------------------
// Évite que le bot s'arrête complètement sur une erreur imprévue (Render le
// relancerait, mais on perd la connexion Discord pendant quelques secondes).
process.on('unhandledRejection', (err) => console.error('Promesse rejetée non gérée :', err));
process.on('uncaughtException', (err) => console.error('Exception non gérée :', err));

const APP_CONFIG = { KEY_LENGTH: 16, EMBED_COLOR: 0x5865F2, BOT_NAME: 'Script Panel' };

// Boutons que l'owner peut mettre (ou non) sur un panel.
const PANEL_BUTTON_IDS = ['key_get', 'key_redeem', 'view_script', 'key_info', 'get_buyer_role', 'reset_hwid'];
const BUTTON_DEFS = {
  key_get: { label: 'btn_get_keys', style: ButtonStyle.Primary, emoji: '🔑' },
  key_redeem: { label: 'btn_get_script', style: ButtonStyle.Success, emoji: '📥' },
  view_script: { label: 'btn_view_script', style: ButtonStyle.Primary, emoji: '📜' },
  key_info: { label: 'btn_key_info', style: ButtonStyle.Secondary, emoji: '📊' },
  get_buyer_role: { label: 'btn_get_buyer_role', style: ButtonStyle.Secondary, emoji: '👤' },
  reset_hwid: { label: 'btn_reset_hwid', style: ButtonStyle.Danger, emoji: '🔄' },
};

// Commandes réservées à TOI (OWNER_ID), utilisables partout.
const OWNER_CMDS = new Set(['ownerinfo', 'disableguild', 'enableguild']);
// Commandes dont la réponse contient des clés / données perso : toujours privées.
const SENSITIVE_CMDS = new Set(['genkey', 'whitelist', 'bulkgen', 'lookupkey', 'lookupuser', 'permissions']);

// ----------------------------------------------------------------
// OUTILS
// ----------------------------------------------------------------
const isBotOwner = (userId) => !!process.env.OWNER_ID && userId === process.env.OWNER_ID;
// Traduction inline des messages admin : L('français', 'english').
const mk = (lang) => (fr, en) => (lang === 'fr' ? fr : en);

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'produit';
}
function generateKeyString() {
  return crypto.randomBytes(APP_CONFIG.KEY_LENGTH).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
}
const findKeyByValue = (g, value) => g.keys.find((k) => k.key === value);
const findKeysByUser = (g, userId) => g.keys.filter((k) => k.userId === userId);
const issuedCountForProduct = (g, productId) => g.keys.filter((k) => k.productId === productId).length;
function fmtDate(ts, lang = 'fr') { return ts ? new Date(ts).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB') : '—'; }

// Qui a le droit d'utiliser les commandes du bot sur ce serveur ?
// → le propriétaire du serveur, toi (OWNER_ID), et ceux que le propriétaire
//   a autorisés avec /permissions (personnes ou rôles).
function isGuildOwner(interaction, guild) { return !!guild && guild.ownerId === interaction.user.id; }
function canManage(interaction, guild, g) {
  const uid = interaction.user.id;
  if (isBotOwner(uid) || isGuildOwner(interaction, guild)) return true;
  if (g.allowedUsers.includes(uid)) return true;
  const roles = interaction.member?.roles;
  const roleIds = roles?.cache ? [...roles.cache.keys()] : (Array.isArray(roles) ? roles : []);
  return g.allowedRoles.some((r) => roleIds.includes(r));
}

// Identifiant de CETTE copie du bot. Si /ownerinfo affiche des identifiants
// différents d'une fois sur l'autre, le bot tourne à 2 endroits en même temps.
const INSTANCE_ID = crypto.randomBytes(2).toString('hex');
const STARTED_AT = Date.now();
const dup = { count: 0, lastAt: null }; // "déjà répondu" = une autre copie du bot répond aussi
// Permissions de l'invitation : voir/écrire/intégrer/historique/gérer les rôles.
const INVITE_PERMS = '268520448';

const NOT_CONFIGURED_MSG =
  "⚠️ Le bot n'est pas encore configuré sur ce serveur : le propriétaire doit lancer `/start`.\n" +
  "⚠️ The bot isn't set up on this server yet: the server owner must run `/start`.";

// ----------------------------------------------------------------
// CLIENT DISCORD
// ----------------------------------------------------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel, Partials.GuildMember],
});

const pendingProducts = new Map(); // `${guildId}:${userId}` → produit en cours de création
const panelDrafts = new Map(); // `${guildId}:${userId}` → brouillon de panel (boutons + produits choisis)
const DRAFT_TTL_MS = 30 * 60 * 1000;

function getDraft(gid, uid) {
  const d = panelDrafts.get(`${gid}:${uid}`);
  if (!d) return null;
  if (Date.now() - d.createdAt > DRAFT_TTL_MS) { panelDrafts.delete(`${gid}:${uid}`); return null; }
  return d;
}

// ----------------------------------------------------------------
// EMBEDS / COMPOSANTS DU PANEL
// (chaque panel a SES boutons et SES produits, choisis via /panel)
// ----------------------------------------------------------------
function buildPanelEmbed(g, panel) {
  const lang = g.config.language;
  const list = panel.productIds
    .map((id) => g.products[id])
    .filter(Boolean)
    .map((p) => `• **${p.name}**${p.killswitch ? ` 🔒 (${t(lang, 'tag_disabled')})` : ''}`)
    .join('\n') || t(lang, 'panel_no_products');
  return new EmbedBuilder()
    .setColor(g.config.panelColor ?? APP_CONFIG.EMBED_COLOR)
    .setTitle(g.config.panelTitle || `🔐 ${APP_CONFIG.BOT_NAME}`)
    .setDescription(g.config.panelDescription || t(lang, 'panel_default_desc'))
    .addFields({ name: t(lang, 'panel_products_field'), value: list.slice(0, 1024) })
    .setFooter({ text: g.config.panelFooter || 'Made by aln' });
}

function buildPanelButtons(g, panel) {
  const lang = g.config.language;
  const ids = PANEL_BUTTON_IDS.filter((id) => panel.buttons.includes(id));
  const rows = [];
  for (let i = 0; i < ids.length; i += 3) {
    const row = new ActionRowBuilder();
    for (const id of ids.slice(i, i + 3)) {
      const def = BUTTON_DEFS[id];
      row.addComponents(new ButtonBuilder().setCustomId(id).setLabel(t(lang, def.label)).setEmoji(g.config.buttonEmojis?.[id] || def.emoji).setStyle(def.style));
    }
    rows.push(row);
  }
  return rows;
}

// Brouillon de panel : l'owner choisit boutons + produits AVANT la publication.
function renderPanelDraft(g, draft) {
  const lang = g.config.language;
  const L = mk(lang);
  for (const id of [...draft.productIds]) if (!g.products[id]) draft.productIds.delete(id);

  const buttonSelect = new StringSelectMenuBuilder()
    .setCustomId('panel_sel_buttons')
    .setPlaceholder(L('1️⃣ Choisis les boutons du panel', '1️⃣ Choose the panel buttons'))
    .setMinValues(1)
    .setMaxValues(PANEL_BUTTON_IDS.length)
    .addOptions(PANEL_BUTTON_IDS.map((id) => ({ label: t(lang, BUTTON_DEFS[id].label), value: id, default: draft.buttons.has(id) })));
  const rows = [new ActionRowBuilder().addComponents(buttonSelect)];

  const productEntries = Object.entries(g.products).slice(0, 25);
  if (productEntries.length) {
    const productSelect = new StringSelectMenuBuilder()
      .setCustomId('panel_sel_products')
      .setPlaceholder(L('2️⃣ Choisis les produits du panel', '2️⃣ Choose the panel products'))
      .setMinValues(1)
      .setMaxValues(productEntries.length)
      .addOptions(productEntries.map(([id, p]) => ({ label: String(p.name).slice(0, 100), value: id, default: draft.productIds.has(id) })));
    rows.push(new ActionRowBuilder().addComponents(productSelect));
  }

  const ready = draft.buttons.size > 0 && draft.productIds.size > 0;
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_add_product').setLabel(L('Ajouter un produit', 'Add a product')).setEmoji('📦').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('panel_publish').setLabel(L('Publier le panel', 'Publish panel')).setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(!ready),
    new ButtonBuilder().setCustomId('panel_cancel').setLabel(L('Annuler', 'Cancel')).setStyle(ButtonStyle.Danger),
  ));

  const content = [
    L('**Configuration du panel**', '**Panel setup**'),
    L('1️⃣ Choisis les boutons à afficher.', '1️⃣ Choose the buttons to show.'),
    productEntries.length
      ? L('2️⃣ Choisis les produits du panel.', '2️⃣ Choose the products for the panel.')
      : L("2️⃣ Aucun produit pour l'instant : ajoutes-en un avec 📦.", '2️⃣ No product yet: add one with 📦.'),
    L('3️⃣ Clique sur **Publier** (le panel sera envoyé dans ce salon).', '3️⃣ Click **Publish** (the panel will be posted in this channel).'),
  ].join('\n');
  return { content, components: rows };
}

// ----------------------------------------------------------------
// SUIVI DES PANELS PUBLIÉS (pour les mettre à jour automatiquement)
// ----------------------------------------------------------------
async function trackPanel(gid, g, message, panel) {
  g.panels.push({ messageId: message.id, channelId: message.channelId, createdAt: Date.now(), buttons: panel.buttons, productIds: panel.productIds });
  await db.save(gid);
}

async function updatePanelByRecord(gid, g, record) {
  try {
    const channel = await client.channels.fetch(record.channelId);
    const message = await channel.messages.fetch(record.messageId);
    await message.edit({ embeds: [buildPanelEmbed(g, record)], components: buildPanelButtons(g, record) });
    return { ok: true };
  } catch (e) {
    console.error('Erreur mise à jour panel :', e.code || '', e.message);
    // On ne retire le panel du suivi que s'il a vraiment disparu (message
    // ou salon supprimé). Pour toute autre erreur (permissions, réseau...),
    // on le garde en suivi et on remonte le vrai message d'erreur.
    const reallyGone = e.code === 10008 || e.code === 10003;
    if (reallyGone) { g.panels = g.panels.filter((p) => p.messageId !== record.messageId); await db.save(gid); }
    return { ok: false, reason: reallyGone ? 'gone' : (e.message || 'inconnue') };
  }
}

// Appelée après toute commande qui change l'apparence du panel. Si aucun
// panel n'existe encore, rien à faire. Sinon, on demande TOUJOURS quoi
// faire — jamais de mise à jour silencieuse.
async function offerPanelUpdate(interaction, g) {
  const L = mk(g.config.language);
  const panels = g.panels;
  if (panels.length === 0) return;

  const row = new ActionRowBuilder();
  if (panels.length === 1) {
    row.addComponents(
      new ButtonBuilder().setCustomId('panelupdate_latest').setLabel(L('✅ Appliquer au panel existant', '✅ Apply to the existing panel')).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('panelupdate_cancel').setLabel(L('Ne pas appliquer', "Don't apply")).setStyle(ButtonStyle.Secondary),
    );
  } else {
    row.addComponents(
      new ButtonBuilder().setCustomId('panelupdate_latest').setLabel(L('Le plus récent', 'Most recent')).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('panelupdate_pick').setLabel(L('Choisir lequel', 'Pick one')).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panelupdate_cancel').setLabel(L('Ne pas appliquer', "Don't apply")).setStyle(ButtonStyle.Danger),
    );
  }
  await interaction.followUp({
    content: panels.length === 1
      ? L('Un panel existe déjà. Veux-tu lui appliquer ce changement ?', 'A panel already exists. Apply this change to it?')
      : L(`Plusieurs panels existent (${panels.length}). Lequel mettre à jour ?`, `Several panels exist (${panels.length}). Which one should be updated?`),
    components: [row],
    ephemeral: true,
  });
}

// ----------------------------------------------------------------
// GÉNÉRATION DE CLÉS (toujours dans le serveur concerné)
// ----------------------------------------------------------------
async function issueKeyForUser(gid, g, userId, productId, { bypassStock = false } = {}) {
  const product = g.products[productId];
  if (!product) return { error: "Ce produit n'existe plus." };

  const existing = g.keys.find((k) => k.userId === userId && k.productId === productId);
  if (existing) return { key: existing.key, alreadyExisted: true };

  if (!bypassStock && product.stock && product.stock > 0 && issuedCountForProduct(g, productId) >= product.stock) {
    return { error: 'Stock épuisé pour ce produit.' };
  }

  const now = Date.now();
  const expiresAt = product.expireDays && product.expireDays > 0 ? now + product.expireDays * 86400000 : null;
  const record = { key: generateKeyString(), productId, userId, hwid: null, hwidResetAt: null, createdAt: now, claimedAt: now, expiresAt, redeemedAt: null };
  g.keys.push(record);
  await db.save(gid);
  return { key: record.key, alreadyExisted: false };
}

async function bulkGenerate(gid, g, productId, quantity, { bypassStock = false } = {}) {
  const product = g.products[productId];
  if (!product) return { error: "Ce produit n'existe plus." };

  if (!bypassStock && product.stock && product.stock > 0) {
    const remaining = product.stock - issuedCountForProduct(g, productId);
    if (quantity > remaining) return { error: `Stock insuffisant (il reste ${remaining} place(s)).` };
  }

  const now = Date.now();
  const generated = [];
  for (let i = 0; i < quantity; i++) {
    const record = { key: generateKeyString(), productId, userId: null, hwid: null, hwidResetAt: null, createdAt: now, claimedAt: null, expiresAt: null, redeemedAt: null };
    g.keys.push(record);
    generated.push(record.key);
  }
  await db.save(gid);
  return { keys: generated };
}

async function createProductFromScriptInput(gid, g, { id, name, stock, expireDays, scriptInput }) {
  if (g.products[id]) throw new Error('PRODUCT_EXISTS');
  const input = scriptInput.trim();
  let rawContent = input;
  if (/^https?:\/\//i.test(input)) {
    rawContent = await fetchUrl(input); // peut lever une erreur, à catcher par l'appelant
  }
  const obfuscated = obfuscateScript(rawContent);
  const hostedFilename = `${crypto.randomBytes(24).toString('hex')}.lua`;
  g.products[id] = { name, script: obfuscated, rawScript: rawContent, hostedFilename, stock, expireDays, killswitch: false };
  await db.save(gid);
}

async function dmUser(user, content) {
  try { await user.send(content); return true; } catch (e) { return false; }
}

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Trop de redirections'));
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchUrl(res.headers.location, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Loader COURT (2 lignes). Le calcul du HWID n'est plus collé dans le
// message : il est fourni par le serveur (route /l/<clé>, voir server.js).
function buildHostedLoader(record) {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  if (!base) {
    return [
      "-- ⚠️ PUBLIC_URL n'est pas configuré côté serveur, demande à aln de finir la config.",
      `script_key = "${record.key}"`,
    ].join('\n');
  }
  return [
    `script_key = "${record.key}"`,
    `loadstring(game:HttpGet("${base}/l/${record.key}"))()`,
  ].join('\n');
}

// ----------------------------------------------------------------
// SLASH COMMANDS
// ----------------------------------------------------------------
const commands = [
  new SlashCommandBuilder().setName('start').setDescription('(Propriétaire du serveur) Configure le bot : langue et visibilité. Obligatoire avant tout.'),

  new SlashCommandBuilder()
    .setName('permissions')
    .setDescription('(Propriétaire du serveur) Choisis qui peut utiliser les commandes du bot')
    .addSubcommand((s) => s.setName('add-role').setDescription('Autoriser un rôle')
      .addRoleOption((o) => o.setName('role').setDescription('Le rôle').setRequired(true)))
    .addSubcommand((s) => s.setName('remove-role').setDescription('Retirer un rôle')
      .addRoleOption((o) => o.setName('role').setDescription('Le rôle').setRequired(true)))
    .addSubcommand((s) => s.setName('add-user').setDescription('Autoriser une personne')
      .addUserOption((o) => o.setName('utilisateur').setDescription('La personne').setRequired(true)))
    .addSubcommand((s) => s.setName('remove-user').setDescription('Retirer une personne')
      .addUserOption((o) => o.setName('utilisateur').setDescription('La personne').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Voir qui est autorisé')),

  new SlashCommandBuilder().setName('panel').setDescription('(Admin) Crée et publie un panel (tu choisis les boutons et les produits)'),
  new SlashCommandBuilder().setName('help').setDescription('(Admin) Affiche l\'aide et les commandes disponibles'),

  new SlashCommandBuilder()
    .setName('addproduct')
    .setDescription('(Admin) Crée un nouveau produit/script (obfusqué automatiquement)')
    .addStringOption((o) => o.setName('nom').setDescription('Nom du produit').setRequired(true))
    .addIntegerOption((o) => o.setName('stock').setDescription('Nombre max de clés (0 = illimité)').setRequired(false))
    .addIntegerOption((o) => o.setName('expiration_jours').setDescription("Durée de validité en jours (0 = jamais)").setRequired(false)),

  new SlashCommandBuilder().setName('listproducts').setDescription('(Admin) Liste les produits configurés'),

  new SlashCommandBuilder()
    .setName('removeproduct')
    .setDescription('(Admin) Supprime un produit')
    .addStringOption((o) => o.setName('produit').setDescription('Le produit').setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('setrole')
    .setDescription('(Admin) Lie un rôle à un produit')
    .addRoleOption((o) => o.setName('role').setDescription('Le rôle déclencheur').setRequired(true))
    .addStringOption((o) => o.setName('produit').setDescription('Le produit lié').setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('genkey')
    .setDescription("(Admin) Génère/attribue une clé à quelqu'un")
    .addUserOption((o) => o.setName('utilisateur').setDescription('La personne').setRequired(true))
    .addStringOption((o) => o.setName('produit').setDescription('Le produit').setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription("(Admin) Donne le rôle lié au produit (déclenche la clé automatiquement)")
    .addUserOption((o) => o.setName('utilisateur').setDescription('La personne').setRequired(true))
    .addStringOption((o) => o.setName('produit').setDescription('Le produit').setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('bulkgen')
    .setDescription('(Admin) Génère plusieurs clés non attribuées')
    .addStringOption((o) => o.setName('produit').setDescription('Le produit').setRequired(true).setAutocomplete(true))
    .addIntegerOption((o) => o.setName('quantite').setDescription('Nombre de clés à générer').setRequired(true)),

  new SlashCommandBuilder()
    .setName('revokekey')
    .setDescription('(Admin) Révoque une clé précise')
    .addStringOption((o) => o.setName('cle').setDescription('La clé exacte').setRequired(true)),

  new SlashCommandBuilder()
    .setName('deletekey')
    .setDescription('(Admin) Supprime une clé précise (identique à /revokekey)')
    .addStringOption((o) => o.setName('cle').setDescription('La clé exacte').setRequired(true)),

  new SlashCommandBuilder()
    .setName('deleteuserkeys')
    .setDescription("(Admin) Supprime TOUTES les clés d'un utilisateur")
    .addUserOption((o) => o.setName('utilisateur').setDescription('La personne').setRequired(true)),

  new SlashCommandBuilder()
    .setName('lookupkey')
    .setDescription('(Admin) Infos sur une clé')
    .addStringOption((o) => o.setName('cle').setDescription('La clé exacte').setRequired(true)),

  new SlashCommandBuilder()
    .setName('lookupuser')
    .setDescription("(Admin) Infos sur les clés d'un utilisateur")
    .addUserOption((o) => o.setName('utilisateur').setDescription('La personne').setRequired(true)),

  new SlashCommandBuilder()
    .setName('resetkeyhwid')
    .setDescription('(Admin) Réinitialise le HWID lié à une clé')
    .addStringOption((o) => o.setName('cle').setDescription('La clé exacte').setRequired(true)),

  new SlashCommandBuilder()
    .setName('sethwidcooldown')
    .setDescription('(Admin) Délai minimum entre deux resets HWID (auto ou manuel)')
    .addIntegerOption((o) => o.setName('heures').setDescription("Nombre d'heures (0 = pas de délai)").setRequired(true)),

  new SlashCommandBuilder()
    .setName('killswitch')
    .setDescription("(Admin) Active/désactive l'accès à un produit (ou tout)")
    .addStringOption((o) => o.setName('produit').setDescription('Le produit, ou "tous"').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('etat').setDescription('on ou off').setRequired(true)
      .addChoices({ name: "on (désactive l'accès)", value: 'on' }, { name: 'off (réactive)', value: 'off' })),

  new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription("(Admin) Bannit quelqu'un du système de clés")
    .addUserOption((o) => o.setName('utilisateur').setDescription('La personne').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Raison').setRequired(false)),

  new SlashCommandBuilder()
    .setName('unblacklist')
    .setDescription("(Admin) Retire quelqu'un de la liste noire")
    .addUserOption((o) => o.setName('utilisateur').setDescription('La personne').setRequired(true)),

  new SlashCommandBuilder().setName('stats').setDescription('(Admin) Statistiques du système de clés'),

  new SlashCommandBuilder()
    .setName('setcolor')
    .setDescription('(Admin) Change la couleur du panel')
    .addStringOption((o) => o.setName('couleur').setDescription('Code hexadécimal, ex: #ff0000').setRequired(true)),

  new SlashCommandBuilder()
    .setName('settitle')
    .setDescription('(Admin) Change le titre du panel')
    .addStringOption((o) => o.setName('titre').setDescription('Nouveau titre').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setdescription')
    .setDescription('(Admin) Change la description du panel')
    .addStringOption((o) => o.setName('texte').setDescription('Nouvelle description').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setfooter')
    .setDescription('(Admin) Change le pied de page du panel')
    .addStringOption((o) => o.setName('texte').setDescription('Nouveau pied de page').setRequired(true)),

  new SlashCommandBuilder()
    .setName('language')
    .setDescription('(Admin) Change la langue du bot (voir aussi /start)')
    .addStringOption((o) => o.setName('langue').setDescription('Langue').setRequired(true)
      .addChoices(
        { name: 'English', value: 'en' },
        { name: 'Français', value: 'fr' },
        { name: 'Español (= anglais pour l\'instant)', value: 'es' },
        { name: 'Português (= anglais pour l\'instant)', value: 'pt' },
        { name: 'Deutsch (= anglais pour l\'instant)', value: 'de' },
      )),

  new SlashCommandBuilder()
    .setName('setemoji')
    .setDescription("(Admin) Change l'emoji d'un bouton du panel")
    .addStringOption((o) => o.setName('bouton').setDescription('Le bouton').setRequired(true)
      .addChoices(
        { name: 'Obtenir mes clés', value: 'key_get' },
        { name: 'Redeem/Get Script (bouton principal)', value: 'key_redeem' },
        { name: 'View Script', value: 'view_script' },
        { name: 'Key Info', value: 'key_info' },
        { name: 'Get Buyer Role', value: 'get_buyer_role' },
        { name: 'Reset HWID', value: 'reset_hwid' },
      ))
    .addStringOption((o) => o.setName('emoji').setDescription('Le nouvel emoji, ex: 🔥').setRequired(true)),
].map((c) => c.setDMPermission(false).toJSON());

// Commandes globales réservées à OWNER_ID (toi), utilisables partout.
const ownerCommands = [
  new SlashCommandBuilder().setName('ownerinfo').setDescription('Statistiques du bot (toi uniquement, dans tous les serveurs)'),
  new SlashCommandBuilder()
    .setName('disableguild')
    .setDescription('(Toi uniquement) Désactive le bot sur un serveur précis')
    .addStringOption((o) => o.setName('guild_id').setDescription("L'ID du serveur (vu via /ownerinfo)").setRequired(true)),
  new SlashCommandBuilder()
    .setName('enableguild')
    .setDescription('(Toi uniquement) Réactive le bot sur un serveur précis')
    .addStringOption((o) => o.setName('guild_id').setDescription("L'ID du serveur").setRequired(true)),
].map((c) => c.toJSON());

// Toutes les commandes sont enregistrées en GLOBAL (tous serveurs où le bot
// est présent). Ça peut prendre un peu de temps pour apparaître partout.
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    const body = [...commands, ...ownerCommands];
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body });
    console.log(`Commandes slash enregistrées en global (${body.length} commandes).`);
    if (process.env.GUILD_ID) {
      // Nettoie les anciennes commandes propres au serveur (avant le passage
      // au global) pour éviter que chaque commande apparaisse deux fois.
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [] });
    }
  } catch (err) {
    console.error('Erreur enregistrement des commandes :', err);
  }
}

// ----------------------------------------------------------------
// SERVEURS : chaque serveur démarre à zéro à l'ajout du bot
// ----------------------------------------------------------------
// Discord donne la date d'arrivée du bot (joinedTimestamp). Si elle change,
// c'est que le bot a été retiré puis ré-ajouté → on remet tout à zéro.
async function syncGuildRecord(guild) {
  const existing = db.peek(guild.id);
  const joined = guild.joinedTimestamp || null;
  if (!existing) {
    const g = db.get(guild.id);
    g.botJoinedAt = joined;
    await db.save(guild.id);
    return 'new';
  }
  if (existing.botJoinedAt && joined && Math.abs(existing.botJoinedAt - joined) > 60000) {
    await db.reset(guild.id, joined);
    return 'reset';
  }
  if (!existing.botJoinedAt && joined) { existing.botJoinedAt = joined; await db.save(guild.id); }
  return 'ok';
}

async function promptOwnerToStart(guild) {
  try {
    const owner = await guild.fetchOwner();
    await owner.send(
      `👋 Merci d'avoir ajouté **${APP_CONFIG.BOT_NAME}** sur **${guild.name}** !\n` +
      `Lance \`/start\` sur le serveur pour le configurer (rien ne fonctionne avant).\n\n` +
      `👋 Thanks for adding **${APP_CONFIG.BOT_NAME}** to **${guild.name}**!\n` +
      `Run \`/start\` on the server to set it up (nothing works before that).`
    );
  } catch (e) { /* DM fermés : pas grave, le message "pas configuré" guidera */ }
}

// MP au propriétaire du bot (toi) : ajout/retrait de serveur, alertes.
async function notifyBotOwner(text) {
  if (!process.env.OWNER_ID) return;
  try { const u = await client.users.fetch(process.env.OWNER_ID); await u.send(text); }
  catch (e) { console.error('MP au propriétaire du bot impossible :', e.message); }
}

// Journal PERSISTANT des serveurs : où le bot est ajouté, quand, et retiré.
async function logGuild(type, guild) {
  const glob = db.getGlobal();
  glob.guildLog = glob.guildLog || [];
  const open = glob.guildLog.find((e) => e.id === guild.id && !e.removedAt);
  if (type === 'add' && !open) {
    glob.guildLog.push({ id: guild.id, name: guild.name, ownerId: guild.ownerId || null, addedAt: guild.joinedTimestamp || Date.now(), removedAt: null });
  } else if (type === 'remove' && open) {
    open.removedAt = Date.now();
    open.name = guild.name || open.name;
  } else if (type === 'add' && open) {
    open.name = guild.name; open.ownerId = guild.ownerId || open.ownerId;
  }
  glob.guildLog = glob.guildLog.slice(-100);
  await db.saveGlobal();
}

client.once(Events.ClientReady, async () => {
  console.log(`Connecté en tant que ${client.user.tag} (instance ${INSTANCE_ID})`);
  console.log(`Serveurs actuels (${client.guilds.cache.size}) :`, [...client.guilds.cache.values()].map((g) => `${g.name} (${g.id})`).join(' | '));
  for (const guild of client.guilds.cache.values()) {
    const status = await syncGuildRecord(guild);
    if (status === 'reset') console.log(`♻️ Bot ré-ajouté à ${guild.name} : données remises à zéro.`);
    await logGuild('add', guild);
  }
  // Serveurs où le bot a été retiré pendant qu'il était éteint.
  for (const entry of (db.getGlobal().guildLog || [])) {
    if (!entry.removedAt && !client.guilds.cache.has(entry.id)) await logGuild('remove', { id: entry.id, name: entry.name });
  }
  await registerCommands();

  const st = db.getStatus();
  if (!st.persistent) {
    await notifyBotOwner(
      "⚠️ **Ton bot tourne SANS stockage persistant.** Tout ce qui est créé (produits, clés...) sera PERDU au prochain redémarrage de Render.\n" +
      `Raison : ${st.uriSet ? `connexion MongoDB échouée (${st.connectError || 'erreur inconnue'})` : 'la variable MONGODB_URI est absente sur Render'}.`
    );
  }
});

client.on(Events.GuildCreate, async (guild) => {
  const status = await syncGuildRecord(guild);
  await logGuild('add', guild);
  console.log(`✅ Bot ajouté au serveur : ${guild.name} (${guild.id}) [${status}]`);
  await notifyBotOwner(`➕ **Bot ajouté** au serveur **${guild.name}**\nID : \`${guild.id}\` · 👑 <@${guild.ownerId}> · 👥 ${guild.memberCount}`);
  if (status !== 'ok') await promptOwnerToStart(guild);
});
client.on(Events.GuildDelete, async (guild) => {
  if (guild.available === false) return; // simple coupure Discord, le bot est toujours dedans
  console.log(`❌ Bot retiré d'un serveur : ${guild.name || guild.id}`);
  await logGuild('remove', guild);
  await notifyBotOwner(`➖ **Bot retiré** du serveur **${guild.name || guild.id}** (\`${guild.id}\`)`);
});

// ----------------------------------------------------------------
// AUTO-GÉNÉRATION QUAND UN RÔLE LIÉ EST ATTRIBUÉ
// ----------------------------------------------------------------
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const gid = newMember.guild.id;
  const g = db.peek(gid);
  if (!g || !g.setupDone) return;
  if (g.blacklist[newMember.id]) return;

  const lang = g.config.language;
  const newRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));

  for (const [, role] of newRoles) {
    const productId = g.roleMap[role.id];
    if (!productId) continue;
    const result = await issueKeyForUser(gid, g, newMember.id, productId);
    if (result.error || result.alreadyExisted) continue;
    await dmUser(newMember.user, {
      embeds: [
        new EmbedBuilder()
          .setColor(APP_CONFIG.EMBED_COLOR)
          .setTitle(t(lang, 'new_key_title'))
          .setDescription(t(lang, 'new_key_desc', { product: g.products[productId]?.name || productId, key: result.key })),
      ],
    });
  }
});

// ----------------------------------------------------------------
// COMMANDES DU PROPRIÉTAIRE DU BOT (toi) — /ownerinfo, /disableguild, /enableguild
// ----------------------------------------------------------------
async function handleOwnerCommand(interaction) {
  const cmd = interaction.commandName;
  await interaction.deferReply({ ephemeral: true });
  if (!isBotOwner(interaction.user.id)) {
    await interaction.editReply({ content: '❌ Cette commande est réservée au propriétaire du bot (OWNER_ID).' });
    return;
  }
  const glob = db.getGlobal();
  const disabled = glob.disabledGuildIds || [];

  if (cmd === 'ownerinfo') {
    // On croise le cache du bot ET la liste officielle Discord (API), pour ne
    // rater aucun serveur où le bot a été ajouté.
    const rows = new Map();
    for (const gd of client.guilds.cache.values()) rows.set(gd.id, { id: gd.id, name: gd.name, ownerId: gd.ownerId, members: gd.memberCount });
    try {
      const fetched = await client.guilds.fetch();
      for (const og of fetched.values()) if (!rows.has(og.id)) rows.set(og.id, { id: og.id, name: og.name, ownerId: null, members: null });
    } catch (e) { console.error('ownerinfo : liste API impossible :', e.message); }

    const list = [...rows.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const lines = list.map((r) => {
      const gs = db.peek(r.id);
      const status = [gs?.setupDone ? '✅ /start fait' : '⏳ /start pas fait', disabled.includes(r.id) ? '🔴 désactivé' : null].filter(Boolean).join(' · ');
      return `**${r.name}**\nID : \`${r.id}\`\n👑 ${r.ownerId ? `<@${r.ownerId}>` : '?'} · 👥 ${r.members ?? '?'}\n${status}`;
    });

    // --- Bloc diagnostic : sur quelle copie du bot je parle, et le stockage.
    const st = db.getStatus();
    const invite = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID || client.user.id}&scope=bot%20applications.commands&permissions=${INVITE_PERMS}`;
    const diag = [
      `🤖 **${client.user.tag}** · app \`${process.env.CLIENT_ID || client.user.id}\``,
      `🧩 Copie du bot \`${INSTANCE_ID}\` · démarrée <t:${Math.floor(STARTED_AT / 1000)}:R>`,
      st.persistent
        ? '💾 Stockage : ✅ MongoDB connecté (les données survivent aux redémarrages)'
        : `💾 Stockage : ❌ **NON persistant** — ${st.uriSet ? `MongoDB inaccessible (${st.connectError || '?'})` : 'MONGODB_URI absent sur Render'}. Tout est perdu au redémarrage !`,
      st.lastSaveError ? `⚠️ Dernière erreur d'écriture MongoDB : ${st.lastSaveError}` : null,
      dup.count > 0
        ? `🚨 **Le bot tourne à 2 endroits !** ${dup.count} fois, une autre copie a répondu avant celle-ci (dernière : <t:${Math.floor(dup.lastAt / 1000)}:R>). Arrête l'autre copie (Termux : \`pkill node\`, ou un 2e service Render).`
        : '✅ Aucune autre copie du bot détectée.',
      `➕ [Lien pour ajouter CE bot](${invite})`,
    ].filter(Boolean).join('\n');

    // --- Historique des ajouts / retraits (persistant).
    const history = (db.getGlobal().guildLog || []).slice(-12).reverse().flatMap((e) => {
      const out = [`➕ **${e.name}** (\`${e.id}\`) — ajouté <t:${Math.floor(e.addedAt / 1000)}:f>`];
      if (e.removedAt) out.unshift(`➖ **${e.name}** (\`${e.id}\`) — retiré <t:${Math.floor(e.removedAt / 1000)}:f>`);
      return out;
    }).slice(0, 14).join('\n') || 'Aucun historique pour le moment.';

    const embeds = [{ t: '🛠️ Diagnostic du bot', d: diag }];
    let cur = '';
    for (const line of lines.length ? lines : ['Aucun serveur.']) {
      if ((cur + '\n\n' + line).length > 1800) { embeds.push({ t: '📡 Serveurs où le bot est ajouté', d: cur }); cur = line; }
      else cur = cur ? `${cur}\n\n${line}` : line;
    }
    if (cur) embeds.push({ t: `📡 Serveurs où le bot est ajouté (${list.length} au total)`, d: cur });
    embeds.push({ t: '🕘 Historique des ajouts / retraits', d: history });

    // Regroupe en messages de moins de 5500 caractères (limite Discord : 6000).
    const messages = [];
    let group = []; let size = 0;
    for (const e of embeds) {
      const len = e.t.length + e.d.length;
      if (group.length && (size + len > 5500 || group.length >= 10)) { messages.push(group); group = []; size = 0; }
      group.push(new EmbedBuilder().setColor(APP_CONFIG.EMBED_COLOR).setTitle(e.t).setDescription(e.d));
      size += len;
    }
    if (group.length) messages.push(group);

    await interaction.editReply({ embeds: messages[0], allowedMentions: { parse: [] } });
    for (const m of messages.slice(1)) await interaction.followUp({ embeds: m, ephemeral: true, allowedMentions: { parse: [] } });
    return;
  }

  // disableguild / enableguild
  const guildId = interaction.options.getString('guild_id').trim();
  const targetGuild = client.guilds.cache.get(guildId);
  if (!targetGuild) { await interaction.editReply({ content: "❌ Le bot n'est pas dans un serveur avec cet ID." }); return; }
  const set = new Set(disabled);
  if (cmd === 'disableguild') set.add(guildId); else set.delete(guildId);
  glob.disabledGuildIds = [...set];
  await db.saveGlobal();
  await interaction.editReply({
    content: cmd === 'disableguild' ? `🔴 Bot désactivé sur **${targetGuild.name}**.` : `🟢 Bot réactivé sur **${targetGuild.name}**.`,
  });
}

// ----------------------------------------------------------------
// /start : configuration obligatoire (langue + visibilité)
// ----------------------------------------------------------------
async function handleStartCommand(interaction, guild) {
  if (!(isBotOwner(interaction.user.id) || isGuildOwner(interaction, guild))) {
    await interaction.reply({ content: '❌ Seul le propriétaire du serveur peut lancer `/start`.\n❌ Only the server owner can run `/start`.', ephemeral: true });
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId('start_lang')
    .setPlaceholder('🌍 Language / Langue')
    .addOptions([
      { label: 'English', value: 'en' },
      { label: 'Français', value: 'fr' },
      { label: 'Español', value: 'es', description: 'English for now / anglais pour le moment' },
      { label: 'Português', value: 'pt', description: 'English for now / anglais pour le moment' },
      { label: 'Deutsch', value: 'de', description: 'English for now / anglais pour le moment' },
    ]);
  await interaction.reply({
    content: '🌍 **Configuration — étape 1/2**\nDans quelle langue le bot doit-il te parler (et parler à tes membres) ?\n\n**Setup — step 1/2**\nWhich language should the bot use with you (and your members)?',
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: true,
  });
}

async function handleStartComponent(interaction, guild, g) {
  if (!(isBotOwner(interaction.user.id) || isGuildOwner(interaction, guild))) {
    await interaction.reply({ content: '❌ Seul le propriétaire du serveur peut faire ça. / Only the server owner can do this.', ephemeral: true });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'start_lang') {
    const lang = interaction.values[0];
    if (!SUPPORTED_LANGS.includes(lang)) return;
    const L = mk(lang);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`start_vis:${lang}:public`).setLabel(L('Visibles par tous', 'Visible to everyone')).setEmoji('👁️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`start_vis:${lang}:private`).setLabel(L('Privées (seulement la personne)', 'Private (only the person)')).setEmoji('🔒').setStyle(ButtonStyle.Primary),
    );
    await interaction.update({
      content: L(
        "👁️ **Configuration — étape 2/2**\nLes réponses du bot (celles qui ne contiennent pas de clé) doivent-elles être **visibles par tout le monde** dans le salon, ou **privées** (seulement la personne qui a fait la commande) ?\n_Les clés et scripts restent toujours privés._",
        "👁️ **Setup — step 2/2**\nShould bot replies (the ones that don't contain a key) be **visible to everyone** in the channel, or **private** (only the person who used the command)?\n_Keys and scripts are always private._",
      ),
      components: [row],
    });
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('start_vis:')) {
    const [, lang, vis] = interaction.customId.split(':');
    if (!SUPPORTED_LANGS.includes(lang) || !['public', 'private'].includes(vis)) return;
    const L = mk(lang);
    g.config.language = lang;
    g.config.visibility = vis;
    g.setupDone = true;
    g.setupAt = Date.now();
    await db.save(guild.id);
    await interaction.update({
      content: L(
        `✅ **Configuration terminée !**\nLangue : \`${lang}\` · Réponses : ${vis === 'public' ? 'visibles par tous' : 'privées'}\n\n**Étapes suivantes**\n1. \`/addproduct\` pour ajouter un produit\n2. \`/panel\` pour créer un panel (tu choisis les boutons et les produits)\n3. \`/permissions\` pour autoriser d'autres rôles/personnes à utiliser le bot\n\nTu peux relancer \`/start\` à tout moment pour changer ces réglages.`,
        `✅ **Setup complete!**\nLanguage: \`${lang}\` · Replies: ${vis === 'public' ? 'visible to everyone' : 'private'}\n\n**Next steps**\n1. \`/addproduct\` to add a product\n2. \`/panel\` to create a panel (you choose the buttons and products)\n3. \`/permissions\` to allow other roles/people to use the bot\n\nYou can run \`/start\` again at any time to change these settings.`,
      ),
      components: [],
    });
  }
}

// ----------------------------------------------------------------
// COMMANDES ADMIN (propriétaire du serveur + personnes/rôles autorisés)
// ----------------------------------------------------------------
async function handleChatCommand(interaction, guild, g) {
  const cmd = interaction.commandName;
  const gid = guild.id;
  const uid = interaction.user.id;
  const lang = g.config.language;
  const L = mk(lang);
  const reply = (content) => interaction.editReply({ content, allowedMentions: { parse: [] } });

  // /panel : ouvre le brouillon (boutons + produits à choisir AVANT publication)
  if (cmd === 'panel') {
    const draft = { buttons: new Set(), productIds: new Set(), channelId: interaction.channelId, createdAt: Date.now() };
    panelDrafts.set(`${gid}:${uid}`, draft);
    await interaction.reply({ ...renderPanelDraft(g, draft), ephemeral: true });
    return;
  }

  // /addproduct ouvre une fenêtre : doit être la toute première réponse
  if (cmd === 'addproduct') {
    const name = interaction.options.getString('nom');
    const stock = interaction.options.getInteger('stock') || 0;
    const expireDays = interaction.options.getInteger('expiration_jours') || 0;
    const id = slugify(name);
    if (g.products[id]) { await interaction.reply({ content: L('❌ Un produit avec ce nom existe déjà.', '❌ A product with this name already exists.'), ephemeral: true }); return; }
    pendingProducts.set(`${gid}:${uid}`, { id, name, stock, expireDays });
    const modal = new ModalBuilder().setCustomId('modal_addproduct').setTitle(L(`Script pour ${name}`, `Script for ${name}`).slice(0, 45));
    const scriptInput = new TextInputBuilder().setCustomId('script_content').setLabel(L('Lien Pastebin/Pastefy (raw) ou code', 'Pastebin/Pastefy (raw) link or code')).setStyle(TextInputStyle.Paragraph).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(scriptInput));
    await interaction.showModal(modal);
    return;
  }

  // Les réponses contenant des clés / données perso sont TOUJOURS privées ;
  // les autres suivent le réglage choisi dans /start.
  await interaction.deferReply({ ephemeral: SENSITIVE_CMDS.has(cmd) || g.config.visibility !== 'public' });

  if (cmd === 'permissions') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add-role' || sub === 'remove-role') {
      const role = interaction.options.getRole('role');
      if (sub === 'add-role') {
        if (role.id === gid) { await reply(L("❌ Impossible d'autoriser @everyone (tout le monde pourrait gérer le bot).", '❌ You cannot allow @everyone (everyone could manage the bot).')); return; }
        if (!g.allowedRoles.includes(role.id)) g.allowedRoles.push(role.id);
      } else {
        g.allowedRoles = g.allowedRoles.filter((r) => r !== role.id);
      }
      await db.save(gid);
      await reply(sub === 'add-role' ? L(`✅ Le rôle <@&${role.id}> peut maintenant utiliser les commandes.`, `✅ Role <@&${role.id}> can now use the commands.`) : L(`✅ Le rôle <@&${role.id}> n'a plus accès aux commandes.`, `✅ Role <@&${role.id}> can no longer use the commands.`));
      return;
    }
    if (sub === 'add-user' || sub === 'remove-user') {
      const target = interaction.options.getUser('utilisateur');
      if (sub === 'add-user') { if (!g.allowedUsers.includes(target.id)) g.allowedUsers.push(target.id); }
      else g.allowedUsers = g.allowedUsers.filter((u) => u !== target.id);
      await db.save(gid);
      await reply(sub === 'add-user' ? L(`✅ <@${target.id}> peut maintenant utiliser les commandes.`, `✅ <@${target.id}> can now use the commands.`) : L(`✅ <@${target.id}> n'a plus accès aux commandes.`, `✅ <@${target.id}> can no longer use the commands.`));
      return;
    }
    // list
    await reply([
      L('👑 Propriétaire du serveur : toujours autorisé.', '👑 Server owner: always allowed.'),
      L('🎭 **Rôles autorisés** : ', '🎭 **Allowed roles**: ') + (g.allowedRoles.map((r) => `<@&${r}>`).join(' ') || L('aucun', 'none')),
      L('👤 **Personnes autorisées** : ', '👤 **Allowed people**: ') + (g.allowedUsers.map((u) => `<@${u}>`).join(' ') || L('aucune', 'none')),
    ].join('\n'));
    return;
  }

  if (cmd === 'listproducts') {
    const entries = Object.entries(g.products);
    if (entries.length === 0) { await reply(L('Aucun produit configuré.', 'No product configured.')); return; }
    const embed = new EmbedBuilder().setColor(APP_CONFIG.EMBED_COLOR).setTitle(L('📦 Produits', '📦 Products'));
    for (const [id, p] of entries.slice(0, 25)) {
      const issued = issuedCountForProduct(g, id);
      const stockStr = p.stock && p.stock > 0 ? `${issued}/${p.stock}` : `${issued}/∞`;
      const expStr = p.expireDays && p.expireDays > 0 ? `${p.expireDays}${L('j', 'd')}` : L('jamais', 'never');
      embed.addFields({ name: `${p.name} (${id})${p.killswitch ? ' 🔒' : ''}`, value: `Stock: ${stockStr} | ${L('Expiration', 'Expiry')}: ${expStr}` });
    }
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (cmd === 'help') {
    const embed = new EmbedBuilder().setColor(APP_CONFIG.EMBED_COLOR).setTitle(t(lang, 'help_title')).setDescription(L(
      'Toutes les commandes sont réservées au propriétaire du serveur et aux personnes/rôles autorisés avec `/permissions`.',
      'All commands are reserved for the server owner and the people/roles allowed with `/permissions`.',
    ));
    embed.addFields({
      name: L('Commandes', 'Commands'),
      value: [
        L('**Démarrage** : `/start` `/permissions` `/panel`', '**Getting started**: `/start` `/permissions` `/panel`'),
        L('**Produits** : `/addproduct` `/listproducts` `/removeproduct` `/setrole`', '**Products**: `/addproduct` `/listproducts` `/removeproduct` `/setrole`'),
        L('**Clés** : `/genkey` `/whitelist` `/bulkgen` `/revokekey` `/deletekey` `/deleteuserkeys` `/lookupkey` `/lookupuser`', '**Keys**: `/genkey` `/whitelist` `/bulkgen` `/revokekey` `/deletekey` `/deleteuserkeys` `/lookupkey` `/lookupuser`'),
        L('**Sécurité** : `/resetkeyhwid` `/sethwidcooldown` `/killswitch` `/blacklist` `/unblacklist`', '**Security**: `/resetkeyhwid` `/sethwidcooldown` `/killswitch` `/blacklist` `/unblacklist`'),
        L('**Apparence** : `/setcolor` `/settitle` `/setdescription` `/setfooter` `/setemoji`', '**Appearance**: `/setcolor` `/settitle` `/setdescription` `/setfooter` `/setemoji`'),
        L('**Autre** : `/language` `/stats`', '**Other**: `/language` `/stats`'),
      ].join('\n'),
    });
    const tuto = new EmbedBuilder().setColor(APP_CONFIG.EMBED_COLOR).setTitle(L('📘 Tuto : créer ton panel', '📘 Tutorial: create your panel')).setDescription(L(
      [
        '**1️⃣ Configurer le bot** (une seule fois)',
        "`/start` → choisis la langue puis la visibilité des réponses.",
        '',
        '**2️⃣ Ajouter un produit**',
        "`/addproduct nom:MonScript` → colle un lien **raw** (Pastebin/Pastefy) ou ton code. Le bot l'obfusque tout seul.",
        'Options : `stock` (nb max de clés), `expiration_jours`.',
        '',
        '**3️⃣ Lier un rôle (optionnel)**',
        "`/setrole role:@Acheteur produit:MonScript` → quand un membre reçoit ce rôle, il reçoit sa clé en MP automatiquement.",
        '',
        '**4️⃣ Créer le panel**',
        "`/panel` dans le salon voulu, puis :",
        "• choisis les **boutons** : 🔑 Obtenir mes clés · 📥 Get Script (entrer sa clé) · 📜 Voir le script · 📊 Infos clé · 👤 Rôle acheteur · 🔄 Reset HWID",
        "• choisis les **produits** (ou 📦 pour en ajouter un)",
        "• clique **Publier** ✅",
        '',
        '**5️⃣ Donner accès à quelqu\'un**',
        "`/whitelist utilisateur produit` (donne le rôle lié + la clé) ou `/genkey`. Pour des clés à vendre : `/bulkgen`.",
        '',
        '**6️⃣ Personnaliser**',
        "`/settitle` `/setdescription` `/setcolor` `/setfooter` `/setemoji` → le bot propose de mettre à jour le panel déjà publié.",
        '',
        '**7️⃣ Donner accès à ton staff**',
        "`/permissions add-role` ou `add-user` (owner du serveur uniquement).",
      ].join('\n'),
      [
        '**1️⃣ Set up the bot** (once)',
        '`/start` → pick the language, then reply visibility.',
        '',
        '**2️⃣ Add a product**',
        "`/addproduct nom:MyScript` → paste a **raw** link (Pastebin/Pastefy) or your code. The bot obfuscates it automatically.",
        'Options: `stock` (max keys), `expiration_jours`.',
        '',
        '**3️⃣ Link a role (optional)**',
        "`/setrole role:@Buyer produit:MyScript` → when a member gets this role, they automatically receive their key by DM.",
        '',
        '**4️⃣ Create the panel**',
        "`/panel` in the channel you want, then:",
        "• choose the **buttons**: 🔑 Get my keys · 📥 Get Script (enter a key) · 📜 View script · 📊 Key info · 👤 Buyer role · 🔄 Reset HWID",
        "• choose the **products** (or 📦 to add one)",
        "• click **Publish** ✅",
        '',
        '**5️⃣ Give someone access**',
        "`/whitelist utilisateur produit` (gives the linked role + key) or `/genkey`. To sell keys: `/bulkgen`.",
        '',
        '**6️⃣ Customize**',
        "`/settitle` `/setdescription` `/setcolor` `/setfooter` `/setemoji` → the bot offers to update the already-published panel.",
        '',
        '**7️⃣ Give your staff access**',
        "`/permissions add-role` or `add-user` (server owner only).",
      ].join('\n'),
    ));
    await interaction.editReply({ embeds: [embed, tuto] });
    return;
  }

  if (cmd === 'removeproduct') {
    const id = interaction.options.getString('produit');
    if (!g.products[id]) { await reply(L('❌ Produit introuvable.', '❌ Product not found.')); return; }
    delete g.products[id];
    for (const roleId of Object.keys(g.roleMap)) if (g.roleMap[roleId] === id) delete g.roleMap[roleId];
    for (const p of g.panels) p.productIds = p.productIds.filter((x) => x !== id);
    await db.save(gid);
    await reply(L('✅ Produit supprimé.', '✅ Product removed.'));
    await offerPanelUpdate(interaction, g);
    return;
  }

  if (cmd === 'setrole') {
    const role = interaction.options.getRole('role');
    const productId = interaction.options.getString('produit');
    if (!g.products[productId]) { await reply(L('❌ Produit introuvable.', '❌ Product not found.')); return; }
    g.roleMap[role.id] = productId;
    await db.save(gid);
    await reply(L(`✅ <@&${role.id}> déclenche maintenant une clé pour **${g.products[productId].name}**.`, `✅ <@&${role.id}> now triggers a key for **${g.products[productId].name}**.`));
    return;
  }

  if (cmd === 'genkey') {
    const target = interaction.options.getUser('utilisateur');
    const productId = interaction.options.getString('produit');
    if (g.blacklist[target.id]) { await reply(L('❌ Cet utilisateur est blacklist.', '❌ This user is blacklisted.')); return; }
    const result = await issueKeyForUser(gid, g, target.id, productId, { bypassStock: true });
    if (result.error) { await reply(`❌ ${result.error}`); return; }
    await reply(L(`✅ Clé pour <@${target.id}> : \`${result.key}\``, `✅ Key for <@${target.id}>: \`${result.key}\``));
    return;
  }

  if (cmd === 'whitelist') {
    const target = interaction.options.getUser('utilisateur');
    const productId = interaction.options.getString('produit');
    if (g.blacklist[target.id]) { await reply(L('❌ Cet utilisateur est blacklist.', '❌ This user is blacklisted.')); return; }
    const linkedRoleId = Object.entries(g.roleMap).find(([, pid]) => pid === productId)?.[0];
    if (linkedRoleId) {
      try {
        const member = await guild.members.fetch(target.id);
        if (member.roles.cache.has(linkedRoleId)) {
          await reply(L(`ℹ️ <@${target.id}> a déjà ce rôle. Utilise \`/genkey\` pour forcer une nouvelle clé.`, `ℹ️ <@${target.id}> already has this role. Use \`/genkey\` to force a new key.`));
          return;
        }
        await member.roles.add(linkedRoleId);
        await reply(L(`✅ Rôle <@&${linkedRoleId}> donné à <@${target.id}> — sa clé sera générée et envoyée automatiquement.`, `✅ Role <@&${linkedRoleId}> given to <@${target.id}> — their key will be generated and sent automatically.`));
      } catch (e) {
        await reply(L("❌ Impossible d'ajouter le rôle (permission Gérer les rôles / hiérarchie).", "❌ Couldn't add the role (Manage Roles permission / role hierarchy)."));
      }
      return;
    }
    const result = await issueKeyForUser(gid, g, target.id, productId, { bypassStock: true });
    if (result.error) { await reply(`❌ ${result.error}`); return; }
    await reply(L(`✅ Clé pour <@${target.id}> : \`${result.key}\` (aucun rôle lié, clé attribuée directement).`, `✅ Key for <@${target.id}>: \`${result.key}\` (no linked role, key assigned directly).`));
    return;
  }

  if (cmd === 'bulkgen') {
    const productId = interaction.options.getString('produit');
    const quantity = interaction.options.getInteger('quantite');
    if (quantity < 1 || quantity > 100) { await reply(L('❌ Quantité entre 1 et 100.', '❌ Quantity must be between 1 and 100.')); return; }
    const result = await bulkGenerate(gid, g, productId, quantity, { bypassStock: true });
    if (result.error) { await reply(`❌ ${result.error}`); return; }
    await reply(L(`✅ ${quantity} clé(s) générée(s) :\n\`\`\`${result.keys.join('\n')}\`\`\``, `✅ ${quantity} key(s) generated:\n\`\`\`${result.keys.join('\n')}\`\`\``));
    return;
  }

  if (cmd === 'revokekey' || cmd === 'deletekey') {
    const value = interaction.options.getString('cle').trim().toUpperCase();
    const idx = g.keys.findIndex((k) => k.key === value);
    if (idx === -1) { await reply(L('❌ Clé introuvable.', '❌ Key not found.')); return; }
    g.keys.splice(idx, 1);
    await db.save(gid);
    await reply(L('✅ Clé supprimée.', '✅ Key deleted.'));
    return;
  }

  if (cmd === 'deleteuserkeys') {
    const target = interaction.options.getUser('utilisateur');
    const remaining = g.keys.filter((k) => k.userId !== target.id);
    const removedCount = g.keys.length - remaining.length;
    g.keys = remaining;
    await db.save(gid);
    await reply(L(`✅ ${removedCount} clé(s) supprimée(s) pour <@${target.id}>.`, `✅ ${removedCount} key(s) deleted for <@${target.id}>.`));
    return;
  }

  if (cmd === 'lookupkey') {
    const value = interaction.options.getString('cle').trim().toUpperCase();
    const record = findKeyByValue(g, value);
    if (!record) { await reply(L('❌ Clé introuvable.', '❌ Key not found.')); return; }
    const embed = new EmbedBuilder().setColor(APP_CONFIG.EMBED_COLOR).setTitle(`🔎 ${record.key}`)
      .addFields(
        { name: L('Produit', 'Product'), value: g.products[record.productId]?.name || record.productId, inline: true },
        { name: L('Propriétaire', 'Owner'), value: record.userId ? `<@${record.userId}>` : L('Non réclamée', 'Unclaimed'), inline: true },
        { name: 'HWID', value: record.hwid || L('Aucun', 'None'), inline: true },
        { name: L('Créée', 'Created'), value: fmtDate(record.createdAt, lang), inline: true },
        { name: L('Réclamée', 'Claimed'), value: fmtDate(record.claimedAt, lang), inline: true },
        { name: L('Expire', 'Expires'), value: record.expiresAt ? fmtDate(record.expiresAt, lang) : L('Jamais', 'Never'), inline: true },
        { name: L('Utilisée', 'Used'), value: fmtDate(record.redeemedAt, lang), inline: true },
        { name: L('Lancements', 'Launches'), value: `${record.useCount || 0}`, inline: true },
        { name: L('Dernier lancement', 'Last launch'), value: fmtDate(record.lastUsedAt, lang), inline: true },
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (cmd === 'lookupuser') {
    const target = interaction.options.getUser('utilisateur');
    const userKeys = findKeysByUser(g, target.id);
    if (userKeys.length === 0) { await reply(L(`${target.tag} n'a aucune clé.${g.blacklist[target.id] ? ' (Blacklist)' : ''}`, `${target.tag} has no key.${g.blacklist[target.id] ? ' (Blacklisted)' : ''}`)); return; }
    const embed = new EmbedBuilder().setColor(APP_CONFIG.EMBED_COLOR).setTitle(L(`👤 Clés de ${target.tag}`, `👤 Keys of ${target.tag}`));
    for (const k of userKeys.slice(0, 25)) {
      embed.addFields({ name: g.products[k.productId]?.name || k.productId, value: `\`${k.key}\` — ${k.redeemedAt ? t(lang, 'word_used') : t(lang, 'word_unused')}` });
    }
    if (g.blacklist[target.id]) embed.setDescription(`⚠️ Blacklist : ${g.blacklist[target.id].reason}`);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (cmd === 'resetkeyhwid') {
    const value = interaction.options.getString('cle').trim().toUpperCase();
    const record = findKeyByValue(g, value);
    if (!record) { await reply(L('❌ Clé introuvable.', '❌ Key not found.')); return; }
    record.hwid = null;
    record.hwidResetAt = Date.now();
    await db.save(gid);
    await reply(L(`✅ HWID réinitialisé pour \`${record.key}\`.`, `✅ HWID reset for \`${record.key}\`.`));
    return;
  }

  if (cmd === 'sethwidcooldown') {
    const hours = interaction.options.getInteger('heures');
    g.config.hwidCooldownHours = hours;
    await db.save(gid);
    await reply(L(`✅ Délai de reset HWID : ${hours}h.`, `✅ HWID reset delay: ${hours}h.`));
    return;
  }

  if (cmd === 'killswitch') {
    const productId = interaction.options.getString('produit');
    const state = interaction.options.getString('etat') === 'on';
    if (productId === 'tous') {
      g.config.killswitchGlobal = state;
      await db.save(gid);
      await reply(L(`✅ Killswitch global : ${state ? 'activé (tout bloqué)' : 'désactivé'}.`, `✅ Global killswitch: ${state ? 'enabled (everything blocked)' : 'disabled'}.`));
      await offerPanelUpdate(interaction, g);
      return;
    }
    if (!g.products[productId]) { await reply(L('❌ Produit introuvable.', '❌ Product not found.')); return; }
    g.products[productId].killswitch = state;
    await db.save(gid);
    await reply(L(`✅ ${g.products[productId].name} : ${state ? 'accès bloqué' : 'accès rétabli'}.`, `✅ ${g.products[productId].name}: ${state ? 'access blocked' : 'access restored'}.`));
    await offerPanelUpdate(interaction, g);
    return;
  }

  if (cmd === 'blacklist') {
    const target = interaction.options.getUser('utilisateur');
    const reason = interaction.options.getString('raison') || L('Non spécifiée', 'Not specified');
    g.blacklist[target.id] = { reason, bannedAt: Date.now() };
    await db.save(gid);
    await reply(L(`✅ <@${target.id}> blacklist. Raison : ${reason}`, `✅ <@${target.id}> blacklisted. Reason: ${reason}`));
    return;
  }

  if (cmd === 'unblacklist') {
    const target = interaction.options.getUser('utilisateur');
    delete g.blacklist[target.id];
    await db.save(gid);
    await reply(L(`✅ <@${target.id}> retiré de la liste noire.`, `✅ <@${target.id}> removed from the blacklist.`));
    return;
  }

  if (cmd === 'stats') {
    const nowTs = Date.now();
    const embed = new EmbedBuilder().setColor(APP_CONFIG.EMBED_COLOR).setTitle(L('📊 Statistiques', '📊 Statistics'))
      .addFields(
        { name: L('Produits', 'Products'), value: `${Object.keys(g.products).length}`, inline: true },
        { name: L('Clés générées', 'Keys generated'), value: `${g.keys.length}`, inline: true },
        { name: L('Clés utilisées', 'Keys used'), value: `${g.keys.filter((k) => k.redeemedAt).length}`, inline: true },
        { name: 'Blacklist', value: `${Object.keys(g.blacklist).length}`, inline: true },
        { name: L('Clés expirées', 'Expired keys'), value: `${g.keys.filter((k) => k.expiresAt && k.expiresAt < nowTs).length}`, inline: true },
        { name: L('Clés verrouillées HWID', 'HWID-locked keys'), value: `${g.keys.filter((k) => k.hwid).length}`, inline: true },
        { name: L('Lancements du script', 'Script launches'), value: `${g.keys.reduce((n, k) => n + (k.useCount || 0), 0)}`, inline: true },
      );
    for (const [id, p] of Object.entries(g.products).slice(0, 12)) {
      embed.addFields({ name: p.name, value: L(`${issuedCountForProduct(g, id)} clé(s)`, `${issuedCountForProduct(g, id)} key(s)`), inline: false });
    }
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (cmd === 'setcolor') {
    const raw = interaction.options.getString('couleur').trim().replace('#', '');
    if (!/^[0-9A-Fa-f]{6}$/.test(raw)) { await reply(L('❌ Format invalide. Exemple : #ff0000', '❌ Invalid format. Example: #ff0000')); return; }
    g.config.panelColor = parseInt(raw, 16);
    await db.save(gid);
    await reply(L(`✅ Couleur du panel changée en #${raw}.`, `✅ Panel color changed to #${raw}.`));
    await offerPanelUpdate(interaction, g);
    return;
  }

  if (cmd === 'settitle' || cmd === 'setdescription' || cmd === 'setfooter') {
    const map = {
      settitle: ['panelTitle', 'titre', L('✅ Titre du panel mis à jour.', '✅ Panel title updated.')],
      setdescription: ['panelDescription', 'texte', L('✅ Description du panel mise à jour.', '✅ Panel description updated.')],
      setfooter: ['panelFooter', 'texte', L('✅ Pied de page du panel mis à jour.', '✅ Panel footer updated.')],
    };
    const [field, opt, msg] = map[cmd];
    g.config[field] = interaction.options.getString(opt);
    await db.save(gid);
    await reply(msg);
    await offerPanelUpdate(interaction, g);
    return;
  }

  if (cmd === 'language') {
    const langChoice = interaction.options.getString('langue');
    g.config.language = langChoice;
    await db.save(gid);
    const M = mk(langChoice);
    const note = ['es', 'pt', 'de'].includes(langChoice) ? M(" (traduction pas encore faite, affichera l'anglais)", ' (translation not done yet, English will be shown)') : '';
    await reply(M(`✅ Langue : ${langChoice}${note}.`, `✅ Language: ${langChoice}${note}.`));
    await offerPanelUpdate(interaction, g);
    return;
  }

  if (cmd === 'setemoji') {
    const btn = interaction.options.getString('bouton');
    const emoji = interaction.options.getString('emoji');
    g.config.buttonEmojis = { ...g.config.buttonEmojis, [btn]: emoji };
    await db.save(gid);
    await reply(L(`✅ Emoji mis à jour pour ce bouton : ${emoji}`, `✅ Emoji updated for this button: ${emoji}`));
    await offerPanelUpdate(interaction, g);
    return;
  }
}

// ----------------------------------------------------------------
// PANEL : quels produits sont sur CE panel (selon le message cliqué)
// ----------------------------------------------------------------
function panelProductIds(g, interaction) {
  const record = interaction.message ? g.panels.find((p) => p.messageId === interaction.message.id) : null;
  const ids = record ? record.productIds : Object.keys(g.products);
  return new Set(ids.filter((id) => g.products[id]));
}

const noPermMsg = (L) => L(
  "❌ Tu n'as pas la permission d'utiliser cette commande. Demande au propriétaire du serveur (`/permissions`).",
  "❌ You don't have permission to use this. Ask the server owner (`/permissions`).",
);

// ----------------------------------------------------------------
// BOUTONS
// ----------------------------------------------------------------
async function handleButton(interaction, guild, g) {
  const gid = guild.id;
  const uid = interaction.user.id;
  const lang = g.config.language;
  const L = mk(lang);
  const id = interaction.customId;

  // ---- Boutons d'administration (brouillon de panel, mise à jour) ----
  if (id.startsWith('panel_') || id.startsWith('panelupdate_')) {
    if (!canManage(interaction, guild, g)) { await interaction.reply({ content: noPermMsg(L), ephemeral: true }); return; }

    if (id === 'panel_add_product') {
      const modal = new ModalBuilder().setCustomId('modal_quick_addproduct').setTitle(L('Ajouter un produit', 'Add a product'));
      const nameInput = new TextInputBuilder().setCustomId('q_name').setLabel(L('Nom du produit', 'Product name')).setStyle(TextInputStyle.Short).setRequired(true);
      const stockInput = new TextInputBuilder().setCustomId('q_stock').setLabel(L('Stock max (0 = illimité)', 'Max stock (0 = unlimited)')).setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('0');
      const expireInput = new TextInputBuilder().setCustomId('q_expire').setLabel(L('Expiration en jours (0 = jamais)', 'Expiry in days (0 = never)')).setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('0');
      const scriptInput = new TextInputBuilder().setCustomId('q_script').setLabel(L('Lien Pastebin/Pastefy (raw) ou code', 'Pastebin/Pastefy (raw) link or code')).setStyle(TextInputStyle.Paragraph).setRequired(true);
      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(stockInput),
        new ActionRowBuilder().addComponents(expireInput),
        new ActionRowBuilder().addComponents(scriptInput),
      );
      await interaction.showModal(modal);
      return;
    }

    if (id === 'panel_cancel') {
      panelDrafts.delete(`${gid}:${uid}`);
      await interaction.update({ content: L('❌ Panel annulé.', '❌ Panel cancelled.'), components: [] });
      return;
    }

    if (id === 'panel_publish') {
      const draft = getDraft(gid, uid);
      if (!draft) { await interaction.update({ content: L('⌛ Session expirée, relance `/panel`.', '⌛ Session expired, run `/panel` again.'), components: [] }); return; }
      const productIds = [...draft.productIds].filter((p) => g.products[p]);
      if (draft.buttons.size === 0 || productIds.length === 0) { await interaction.update(renderPanelDraft(g, draft)); return; }
      const panel = { buttons: PANEL_BUTTON_IDS.filter((b) => draft.buttons.has(b)), productIds };
      try {
        const channel = await client.channels.fetch(draft.channelId);
        const message = await channel.send({ embeds: [buildPanelEmbed(g, panel)], components: buildPanelButtons(g, panel) });
        await trackPanel(gid, g, message, panel);
      } catch (e) {
        console.error('Publication du panel impossible :', e.message);
        await interaction.reply({ content: L("❌ Je n'ai pas pu envoyer le panel dans ce salon (permissions : voir le salon, envoyer des messages, intégrer des liens).", "❌ I couldn't post the panel in this channel (permissions: view channel, send messages, embed links)."), ephemeral: true });
        return;
      }
      panelDrafts.delete(`${gid}:${uid}`);
      await interaction.update({ content: L('✅ Panel publié dans ce salon.', '✅ Panel published in this channel.'), components: [] });
      return;
    }

    if (id === 'panelupdate_latest') {
      await interaction.deferUpdate();
      const panels = [...g.panels].sort((a, b) => b.createdAt - a.createdAt);
      if (panels.length === 0) { await interaction.editReply({ content: L('❌ Plus aucun panel trouvé.', '❌ No panel found anymore.'), components: [] }); return; }
      const result = await updatePanelByRecord(gid, g, panels[0]);
      await interaction.editReply({
        content: result.ok ? L('✅ Panel le plus récent mis à jour.', '✅ Latest panel updated.') : `❌ ${result.reason === 'gone' ? L('Échec : ce panel a été supprimé.', 'Failed: this panel was deleted.') : result.reason}`,
        components: [],
      });
      return;
    }

    if (id === 'panelupdate_pick') {
      const panels = [...g.panels].sort((a, b) => b.createdAt - a.createdAt).slice(0, 25);
      const options = [];
      for (const p of panels) {
        let label = `Salon ${p.channelId}`;
        try { const ch = await client.channels.fetch(p.channelId); label = `#${ch.name}`; } catch (e) { /* salon supprimé */ }
        options.push({ label: label.slice(0, 90), description: fmtDate(p.createdAt, lang), value: p.messageId });
      }
      const select = new StringSelectMenuBuilder().setCustomId('select_panel_update').setPlaceholder(L('Choisis un panel', 'Choose a panel')).addOptions(options);
      await interaction.update({ content: L('Choisis quel panel mettre à jour :', 'Choose which panel to update:'), components: [new ActionRowBuilder().addComponents(select)] });
      return;
    }

    if (id === 'panelupdate_cancel') {
      await interaction.update({ content: L("OK, rien n'a été changé sur le(s) panel(s) existant(s).", 'OK, nothing was changed on the existing panel(s).'), components: [] });
      return;
    }
    return;
  }

  // ---- Boutons des membres (panel) ----
  const blacklisted = !!g.blacklist[uid];
  const pids = panelProductIds(g, interaction);

  // key_redeem / reset_hwid ouvrent une fenêtre : réponse immédiate sans defer
  if (id === 'key_redeem' || id === 'reset_hwid') {
    if (blacklisted) { await interaction.reply({ content: t(lang, 'msg_blacklisted'), ephemeral: true }); return; }
    const isRedeem = id === 'key_redeem';
    const modal = new ModalBuilder().setCustomId(isRedeem ? 'modal_redeem' : 'modal_hwid_reset').setTitle(t(lang, isRedeem ? 'modal_redeem_title' : 'modal_hwid_title'));
    const keyInput = new TextInputBuilder().setCustomId('key_value').setLabel(t(lang, isRedeem ? 'modal_redeem_label' : 'modal_hwid_label')).setStyle(TextInputStyle.Short).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
    await interaction.showModal(modal);
    return;
  }

  if (id === 'key_get') {
    await interaction.deferReply({ ephemeral: true });
    if (blacklisted) { await interaction.editReply({ content: t(lang, 'msg_blacklisted') }); return; }
    const member = interaction.member;
    const lines = [];
    for (const [roleId, productId] of Object.entries(g.roleMap)) {
      if (!pids.has(productId) || !member.roles.cache.has(roleId)) continue;
      const result = await issueKeyForUser(gid, g, member.id, productId);
      const name = g.products[productId]?.name || productId;
      lines.push(result.error ? `❌ ${name} : ${result.error}` : `🔑 ${name} : \`${result.key}\``);
    }
    if (lines.length === 0) { await interaction.editReply({ content: t(lang, 'msg_no_product_access') }); return; }
    const sent = await dmUser(interaction.user, `${t(lang, 'keys_dm_header')}\n${lines.join('\n')}`);
    await interaction.editReply({ content: sent ? t(lang, 'msg_keys_sent_dm') : t(lang, 'msg_dm_failed') });
    return;
  }

  if (id === 'view_script') {
    await interaction.deferReply({ ephemeral: true });
    if (blacklisted) { await interaction.editReply({ content: t(lang, 'msg_blacklisted') }); return; }
    const owned = findKeysByUser(g, uid).filter((k) => pids.has(k.productId));
    if (owned.length === 0) { await interaction.editReply({ content: t(lang, 'msg_no_key_owned') }); return; }
    if (owned.length === 1) {
      const deliveryRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`deliver_dm_${owned[0].key}`).setLabel(t(lang, 'btn_deliver_dm')).setEmoji('📩').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`deliver_here_${owned[0].key}`).setLabel(t(lang, 'btn_deliver_here')).setEmoji('💬').setStyle(ButtonStyle.Secondary),
      );
      await interaction.editReply({ content: t(lang, 'msg_choose_delivery'), components: [deliveryRow] });
      return;
    }
    const select = new StringSelectMenuBuilder().setCustomId('select_view_script').setPlaceholder(t(lang, 'select_product_placeholder'))
      .addOptions(owned.slice(0, 25).map((k) => ({ label: g.products[k.productId]?.name || k.productId, value: k.key })));
    await interaction.editReply({ components: [new ActionRowBuilder().addComponents(select)] });
    return;
  }

  if (id === 'key_info') {
    await interaction.deferReply({ ephemeral: true });
    if (blacklisted) { await interaction.editReply({ content: t(lang, 'msg_blacklisted') }); return; }
    const owned = findKeysByUser(g, uid).filter((k) => pids.has(k.productId));
    if (owned.length === 0) { await interaction.editReply({ content: t(lang, 'msg_no_key_owned') }); return; }
    const embed = new EmbedBuilder().setColor(APP_CONFIG.EMBED_COLOR).setTitle(t(lang, 'key_info_title'));
    for (const k of owned.slice(0, 25)) {
      embed.addFields({
        name: g.products[k.productId]?.name || k.productId,
        value: t(lang, 'key_info_line', { hwid: k.hwid ? '✅' : '—', exp: k.expiresAt ? fmtDate(k.expiresAt, lang) : t(lang, 'word_never'), used: k.redeemedAt ? t(lang, 'word_used') : t(lang, 'word_unused'), n: k.useCount || 0 }),
      });
    }
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (id === 'get_buyer_role') {
    await interaction.deferReply({ ephemeral: true });
    if (blacklisted) { await interaction.editReply({ content: t(lang, 'msg_blacklisted') }); return; }
    const entries = Object.entries(g.roleMap).filter(([, productId]) => pids.has(productId));
    if (entries.length === 0) { await interaction.editReply({ content: t(lang, 'msg_no_role_configured') }); return; }
    if (entries.length === 1) {
      const [roleId] = entries[0];
      if (interaction.member.roles.cache.has(roleId)) { await interaction.editReply({ content: t(lang, 'msg_role_already') }); return; }
      try {
        await interaction.member.roles.add(roleId);
        await interaction.editReply({ content: t(lang, 'msg_role_granted') });
      } catch (e) { await interaction.editReply({ content: t(lang, 'msg_role_add_failed') }); }
      return;
    }
    const select = new StringSelectMenuBuilder().setCustomId('select_buyer_role').setPlaceholder(t(lang, 'select_product_placeholder'))
      .addOptions(entries.slice(0, 25).map(([roleId, productId]) => ({ label: g.products[productId]?.name || productId, value: roleId })));
    await interaction.editReply({ components: [new ActionRowBuilder().addComponents(select)] });
    return;
  }

  // deliver_dm_<clé> / deliver_here_<clé> : choix fait par l'acheteur
  // après avoir validé sa clé.
  if (id.startsWith('deliver_dm_') || id.startsWith('deliver_here_')) {
    await interaction.deferUpdate();
    const viaDm = id.startsWith('deliver_dm_');
    const keyValue = id.replace(viaDm ? 'deliver_dm_' : 'deliver_here_', '');
    const record = findKeyByValue(g, keyValue);

    if (!record || record.userId !== uid) { await interaction.editReply({ content: t(lang, 'msg_invalid_key'), components: [] }); return; }
    if (blacklisted) { await interaction.editReply({ content: t(lang, 'msg_blacklisted'), components: [] }); return; }
    const product = g.products[record.productId];
    if (!product) { await interaction.editReply({ content: t(lang, 'msg_no_script_configured'), components: [] }); return; }
    if (g.config.killswitchGlobal || product.killswitch) { await interaction.editReply({ content: t(lang, 'msg_product_disabled'), components: [] }); return; }
    if (record.expiresAt && Date.now() > record.expiresAt) { await interaction.editReply({ content: t(lang, 'msg_key_expired'), components: [] }); return; }

    const loaderSnippet = buildHostedLoader(record);
    if (viaDm) {
      const sent = await dmUser(interaction.user, `\`\`\`lua\n${loaderSnippet}\n\`\`\``);
      await interaction.editReply({ content: sent ? t(lang, 'msg_script_sent_dm') : t(lang, 'msg_dm_failed'), components: [] });
    } else {
      await interaction.editReply({ content: `\`\`\`lua\n${loaderSnippet}\n\`\`\``, components: [] });
    }
    return;
  }
}

// ----------------------------------------------------------------
// MENUS DÉROULANTS
// ----------------------------------------------------------------
async function handleSelect(interaction, guild, g) {
  const gid = guild.id;
  const uid = interaction.user.id;
  const lang = g.config.language;
  const L = mk(lang);
  const id = interaction.customId;

  // ---- Admin : brouillon de panel / choix du panel à mettre à jour ----
  if (id === 'panel_sel_buttons' || id === 'panel_sel_products' || id === 'select_panel_update') {
    if (!canManage(interaction, guild, g)) { await interaction.reply({ content: noPermMsg(L), ephemeral: true }); return; }

    if (id === 'select_panel_update') {
      await interaction.deferUpdate();
      const record = g.panels.find((p) => p.messageId === interaction.values[0]);
      if (!record) { await interaction.editReply({ content: L('❌ Panel introuvable.', '❌ Panel not found.'), components: [] }); return; }
      const result = await updatePanelByRecord(gid, g, record);
      await interaction.editReply({
        content: result.ok ? L('✅ Panel mis à jour.', '✅ Panel updated.') : `❌ ${result.reason === 'gone' ? L('Échec : ce panel a été supprimé.', 'Failed: this panel was deleted.') : result.reason}`,
        components: [],
      });
      return;
    }

    const draft = getDraft(gid, uid);
    if (!draft) { await interaction.update({ content: L('⌛ Session expirée, relance `/panel`.', '⌛ Session expired, run `/panel` again.'), components: [] }); return; }
    if (id === 'panel_sel_buttons') draft.buttons = new Set(interaction.values.filter((v) => PANEL_BUTTON_IDS.includes(v)));
    else draft.productIds = new Set(interaction.values.filter((v) => g.products[v]));
    await interaction.update(renderPanelDraft(g, draft));
    return;
  }

  // ---- Membres ----
  if (g.blacklist[uid]) { await interaction.update({ content: t(lang, 'msg_blacklisted'), components: [] }); return; }

  if (id === 'select_view_script') {
    const keyValue = interaction.values[0];
    const deliveryRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`deliver_dm_${keyValue}`).setLabel(t(lang, 'btn_deliver_dm')).setEmoji('📩').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`deliver_here_${keyValue}`).setLabel(t(lang, 'btn_deliver_here')).setEmoji('💬').setStyle(ButtonStyle.Secondary),
    );
    await interaction.update({ content: t(lang, 'msg_choose_delivery'), components: [deliveryRow] });
    return;
  }

  if (id === 'select_buyer_role') {
    const roleId = interaction.values[0];
    if (!g.roleMap[roleId]) { await interaction.update({ content: t(lang, 'msg_no_role_configured'), components: [] }); return; }
    if (interaction.member.roles.cache.has(roleId)) { await interaction.update({ content: t(lang, 'msg_role_already'), components: [] }); return; }
    try {
      await interaction.member.roles.add(roleId);
      await interaction.update({ content: t(lang, 'msg_role_granted'), components: [] });
    } catch (e) {
      await interaction.update({ content: t(lang, 'msg_role_add_failed'), components: [] });
    }
    return;
  }
}

// ----------------------------------------------------------------
// FENÊTRES (MODALS)
// ----------------------------------------------------------------
async function handleModal(interaction, guild, g) {
  const gid = guild.id;
  const uid = interaction.user.id;
  const lang = g.config.language;
  const L = mk(lang);
  const id = interaction.customId;

  // ---- Admin : ajout de produit ----
  if (id === 'modal_addproduct' || id === 'modal_quick_addproduct') {
    if (!canManage(interaction, guild, g)) { await interaction.reply({ content: noPermMsg(L), ephemeral: true }); return; }
    const fromDraft = id === 'modal_quick_addproduct' && typeof interaction.isFromMessage === 'function' && interaction.isFromMessage();
    if (fromDraft) await interaction.deferUpdate(); else await interaction.deferReply({ ephemeral: true });
    const say = (content) => (fromDraft ? interaction.followUp({ content, ephemeral: true }) : interaction.editReply({ content }));

    let info;
    if (id === 'modal_addproduct') {
      info = pendingProducts.get(`${gid}:${uid}`);
      pendingProducts.delete(`${gid}:${uid}`);
      if (!info) { await say(L('❌ Session expirée, relance /addproduct.', '❌ Session expired, run /addproduct again.')); return; }
      info = { ...info, scriptInput: interaction.fields.getTextInputValue('script_content') };
    } else {
      const name = interaction.fields.getTextInputValue('q_name').trim();
      info = {
        id: slugify(name), name,
        stock: parseInt(interaction.fields.getTextInputValue('q_stock') || '0', 10) || 0,
        expireDays: parseInt(interaction.fields.getTextInputValue('q_expire') || '0', 10) || 0,
        scriptInput: interaction.fields.getTextInputValue('q_script'),
      };
    }

    try {
      await createProductFromScriptInput(gid, g, info);
    } catch (e) {
      if (e.message === 'PRODUCT_EXISTS') await say(L('❌ Un produit avec ce nom existe déjà.', '❌ A product with this name already exists.'));
      else await say(L(`❌ Impossible de récupérer le lien (${e.message}). Vérifie que c'est bien un lien "raw".`, `❌ Couldn't fetch the link (${e.message}). Make sure it's a "raw" link.`));
      return;
    }

    const persistWarn = db.getStatus().persistent ? '' : L("\n⚠️ Le stockage du bot n'est pas persistant : ce produit sera perdu au prochain redémarrage. Préviens l'admin du bot (MongoDB).", '\n⚠️ The bot storage is not persistent: this product will be lost on the next restart. Tell the bot admin (MongoDB).');
    const doneMsg = L(`✅ Produit **${info.name}** créé (id: \`${info.id}\`) — script obfusqué automatiquement (Moon Obf).`, `✅ Product **${info.name}** created (id: \`${info.id}\`) — script obfuscated automatically (Moon Obf).`) + persistWarn;
    if (fromDraft) {
      const draft = getDraft(gid, uid);
      if (draft) { draft.productIds.add(info.id); await interaction.editReply(renderPanelDraft(g, draft)); }
      await interaction.followUp({ content: doneMsg, ephemeral: true });
    } else {
      await interaction.editReply({ content: doneMsg });
      await offerPanelUpdate(interaction, g);
    }
    return;
  }

  // ---- Membres ----
  await interaction.deferReply({ ephemeral: true });
  const pids = panelProductIds(g, interaction);

  if (id === 'modal_hwid_reset') {
    const inputKey = interaction.fields.getTextInputValue('key_value').trim().toUpperCase();
    const record = findKeyByValue(g, inputKey);
    if (!record || record.userId !== uid || !pids.has(record.productId)) { await interaction.editReply({ content: t(lang, 'msg_no_hwid_key') }); return; }

    const cooldownMs = (g.config.hwidCooldownHours || 0) * 3600000;
    if (cooldownMs > 0 && record.hwidResetAt && Date.now() - record.hwidResetAt < cooldownMs) {
      const remainingH = Math.ceil((cooldownMs - (Date.now() - record.hwidResetAt)) / 3600000);
      await interaction.editReply({ content: t(lang, 'msg_hwid_cooldown', { hours: remainingH }) });
      return;
    }
    record.hwid = null;
    record.hwidResetAt = Date.now();
    await db.save(gid);
    await interaction.editReply({ content: t(lang, 'msg_hwid_reset_success') });
    return;
  }

  if (id === 'modal_redeem') {
    if (g.blacklist[uid]) { await interaction.editReply({ content: t(lang, 'msg_blacklisted') }); return; }

    const inputKey = interaction.fields.getTextInputValue('key_value').trim().toUpperCase();
    // La clé doit exister DANS CE SERVEUR (et sur les produits de ce panel).
    const record = findKeyByValue(g, inputKey);
    if (!record || !pids.has(record.productId)) { await interaction.editReply({ content: t(lang, 'msg_invalid_key') }); return; }
    if (record.userId && record.userId !== uid) { await interaction.editReply({ content: t(lang, 'msg_key_owned_by_other') }); return; }

    const product = g.products[record.productId];
    if (g.config.killswitchGlobal || product?.killswitch) { await interaction.editReply({ content: t(lang, 'msg_product_disabled') }); return; }

    if (!record.userId) {
      record.userId = uid;
      record.claimedAt = Date.now();
      record.expiresAt = product?.expireDays && product.expireDays > 0 ? Date.now() + product.expireDays * 86400000 : null;
    }
    if (record.expiresAt && Date.now() > record.expiresAt) { await interaction.editReply({ content: t(lang, 'msg_key_expired') }); return; }
    if (!product || !product.script) { await interaction.editReply({ content: t(lang, 'msg_no_script_configured') }); return; }

    record.redeemedAt = record.redeemedAt || Date.now();
    await db.save(gid);

    const deliveryRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`deliver_dm_${record.key}`).setLabel(t(lang, 'btn_deliver_dm')).setEmoji('📩').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`deliver_here_${record.key}`).setLabel(t(lang, 'btn_deliver_here')).setEmoji('💬').setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({ content: t(lang, 'msg_choose_delivery'), components: [deliveryRow] });
  }
}

// ----------------------------------------------------------------
// ROUTEUR D'INTERACTIONS
// ----------------------------------------------------------------
async function routeInteraction(interaction) {
  const uid = interaction.user.id;
  const botOwner = isBotOwner(uid);

  // Serveur désactivé par toi : on bloque tout, sauf pour toi (OWNER_ID).
  if (interaction.guildId && !botOwner && (db.getGlobal().disabledGuildIds || []).includes(interaction.guildId)) {
    if (interaction.isAutocomplete()) { await interaction.respond([]).catch(() => {}); return; }
    if (interaction.isRepliable()) await interaction.reply({ content: '❌ Ce bot est désactivé sur ce serveur. / This bot is disabled on this server.', ephemeral: true }).catch(() => {});
    return;
  }

  // Tes commandes à toi : marchent partout, sans /start.
  if (interaction.isChatInputCommand() && OWNER_CMDS.has(interaction.commandName)) { await handleOwnerCommand(interaction); return; }

  if (!interaction.guildId) {
    if (interaction.isRepliable()) await interaction.reply({ content: 'Utilise cette commande dans un serveur. / Use this in a server.', ephemeral: true });
    return;
  }
  const guild = interaction.guild || await client.guilds.fetch(interaction.guildId);
  const g = db.get(guild.id);
  const L = mk(g.config.language);

  // /start et ses menus/boutons : la seule chose qui marche avant la config.
  if (interaction.isChatInputCommand() && interaction.commandName === 'start') { await handleStartCommand(interaction, guild); return; }
  if ((interaction.isStringSelectMenu() || interaction.isButton()) && interaction.customId.startsWith('start_')) { await handleStartComponent(interaction, guild, g); return; }

  // Tant que /start n'a pas été fait : plus rien ne marche.
  if (!g.setupDone) {
    if (interaction.isAutocomplete()) { await interaction.respond([]); return; }
    await interaction.reply({ content: NOT_CONFIGURED_MSG, ephemeral: true });
    return;
  }

  // Autocomplete produit
  if (interaction.isAutocomplete()) {
    if (!canManage(interaction, guild, g)) { await interaction.respond([]); return; }
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = Object.entries(g.products)
      .filter(([id, p]) => p.name.toLowerCase().includes(focused) || id.includes(focused))
      .slice(0, 24)
      .map(([id, p]) => ({ name: p.name, value: id }));
    if (interaction.commandName === 'killswitch') choices.unshift({ name: L('Tous les produits', 'All products'), value: 'tous' });
    await interaction.respond(choices.slice(0, 25));
    return;
  }

  if (interaction.isChatInputCommand()) {
    // /permissions : uniquement le propriétaire du serveur (ou toi).
    if (interaction.commandName === 'permissions') {
      if (!(botOwner || isGuildOwner(interaction, guild))) {
        await interaction.reply({ content: L('❌ Seul le propriétaire du serveur peut gérer les permissions.', '❌ Only the server owner can manage permissions.'), ephemeral: true });
        return;
      }
    } else if (!canManage(interaction, guild, g)) {
      await interaction.reply({ content: noPermMsg(L), ephemeral: true });
      return;
    }
    await handleChatCommand(interaction, guild, g);
    return;
  }
  if (interaction.isButton()) { await handleButton(interaction, guild, g); return; }
  if (interaction.isStringSelectMenu()) { await handleSelect(interaction, guild, g); return; }
  if (interaction.isModalSubmit()) { await handleModal(interaction, guild, g); return; }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await routeInteraction(interaction);
  } catch (err) {
    if (err && err.code === 40060) {
      // 40060 = "déjà répondu" : une AUTRE copie du bot a répondu avant nous.
      dup.count++; dup.lastAt = Date.now();
      console.warn('🚨 Une autre copie du bot répond aussi (Termux + Render ?). Arrête-en une !');
      return;
    }
    console.error('Erreur interaction :', err);
    if (interaction.isRepliable && interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Une erreur est survenue. / An error occurred.', ephemeral: true }).catch(() => {});
    } else if (interaction.deferred) {
      await interaction.editReply({ content: 'Une erreur est survenue. / An error occurred.' }).catch(() => {});
    }
  }
});

(async () => {
  await db.initDb();

  if (!process.env.DISCORD_TOKEN) console.error("❌ DISCORD_TOKEN manquant : ajoute-le dans les variables d'environnement.");
  client.login(process.env.DISCORD_TOKEN).catch((e) => console.error('❌ Connexion Discord impossible :', e.message));

  // Lance aussi le petit serveur web (vérification HWID + scripts hébergés)
  // dans le même programme, pour qu'ils partagent les mêmes données et que
  // l'hébergement (Render/Railway) reste tout-en-un.
  require('./server');

  // ----------------------------------------------------------------
  // ANTI-MISE EN VEILLE (plan gratuit Render)
  // ----------------------------------------------------------------
  // Render éteint le service après ~15 min sans requête HTTP entrante, ce
  // qui coupe aussi la connexion Discord du bot. On s'auto-appelle toutes
  // les 10 minutes pour que ça n'arrive jamais.
  if (process.env.PUBLIC_URL) {
    setInterval(() => {
      https.get(`${process.env.PUBLIC_URL.replace(/\/$/, '')}/health`, (res) => { res.resume(); }).on('error', () => {});
    }, 10 * 60 * 1000);
  }
})();
