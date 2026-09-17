require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
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
const APP_CONFIG = { KEY_LENGTH: 16, EMBED_COLOR: 0x5865F2, BOT_NAME: 'Script Panel' };

// ----------------------------------------------------------------
// STOCKAGE
// ----------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const KEYS_PATH = path.join(DATA_DIR, 'keys.json');
const PRODUCTS_PATH = path.join(DATA_DIR, 'products.json');
const ROLEMAP_PATH = path.join(DATA_DIR, 'roleMap.json');
const BLACKLIST_PATH = path.join(DATA_DIR, 'blacklist.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  killswitchGlobal: false,
  hwidCooldownHours: 0,
  panelColor: 0x5865F2,
  panelTitle: null,
  panelDescription: null,
  panelFooter: 'Made by aln',
  language: 'en',
  panelButtons: ['key_get', 'reset_hwid'], // le bouton clé/script est toujours présent en plus
};

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8') || JSON.stringify(fallback)); }
  catch (e) { return fallback; }
}
function saveJson(p, data) { fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

function loadKeys() { return loadJson(KEYS_PATH, []); }
function saveKeys(d) { saveJson(KEYS_PATH, d); }
function loadProducts() { return loadJson(PRODUCTS_PATH, {}); }
function saveProducts(d) { saveJson(PRODUCTS_PATH, d); }
function loadRoleMap() { return loadJson(ROLEMAP_PATH, {}); }
function saveRoleMap(d) { saveJson(ROLEMAP_PATH, d); }
function loadBlacklist() { return loadJson(BLACKLIST_PATH, {}); }
function saveBlacklist(d) { saveJson(BLACKLIST_PATH, d); }
function loadConfig() { return { ...DEFAULT_CONFIG, ...loadJson(CONFIG_PATH, {}) }; }
function saveConfig(d) { saveJson(CONFIG_PATH, d); }

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'produit';
}
function generateKeyString() {
  return crypto.randomBytes(APP_CONFIG.KEY_LENGTH).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
}
function findKeyByValue(keys, value) { return keys.find((k) => k.key === value); }
function findKeysByUser(keys, userId) { return keys.filter((k) => k.userId === userId); }
function issuedCountForProduct(keys, productId) { return keys.filter((k) => k.productId === productId).length; }
function fmtDate(ts) { return ts ? new Date(ts).toLocaleString('fr-FR') : '—'; }

// ----------------------------------------------------------------
// CLIENT DISCORD
// ----------------------------------------------------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel, Partials.GuildMember],
});

const pendingProducts = new Map();

// ----------------------------------------------------------------
// EMBEDS / COMPOSANTS
// ----------------------------------------------------------------
function buildPanelEmbed() {
  const products = loadProducts();
  const config = loadConfig();
  const list = Object.values(products).map((p) => `• **${p.name}**${p.killswitch ? ' 🔒 (désactivé)' : ''}`).join('\n') || 'Aucun produit configuré.';
  return new EmbedBuilder()
    .setColor(config.panelColor ?? APP_CONFIG.EMBED_COLOR)
    .setTitle(config.panelTitle || `🔐 ${APP_CONFIG.BOT_NAME}`)
    .setDescription(config.panelDescription || 'Utilise les boutons pour récupérer tes clés ou en utiliser une.')
    .addFields({ name: 'Produits disponibles', value: list })
    .setFooter({ text: config.panelFooter || 'Made by aln' });
}

function buildPanelButtons() {
  const config = loadConfig();
  const lang = config.language;
  const row1 = new ActionRowBuilder();
  const row2 = new ActionRowBuilder();

  if (config.panelButtons.includes('key_get')) {
    row1.addComponents(new ButtonBuilder().setCustomId('key_get').setLabel(t(lang, 'btn_get_keys')).setEmoji('🔑').setStyle(ButtonStyle.Primary));
  }

  const redeemLabel = t(lang, 'btn_get_script');
  row1.addComponents(new ButtonBuilder().setCustomId('key_redeem').setLabel(redeemLabel).setEmoji('📥').setStyle(ButtonStyle.Success));

  if (config.panelButtons.includes('view_script')) {
    row1.addComponents(new ButtonBuilder().setCustomId('view_script').setLabel(t(lang, 'btn_view_script')).setEmoji('📜').setStyle(ButtonStyle.Primary));
  }

  if (config.panelButtons.includes('key_info')) {
    row2.addComponents(new ButtonBuilder().setCustomId('key_info').setLabel(t(lang, 'btn_key_info')).setEmoji('📊').setStyle(ButtonStyle.Secondary));
  }

  if (config.panelButtons.includes('get_buyer_role')) {
    row2.addComponents(new ButtonBuilder().setCustomId('get_buyer_role').setLabel(t(lang, 'btn_get_buyer_role')).setEmoji('👤').setStyle(ButtonStyle.Secondary));
  }

  if (config.panelButtons.includes('reset_hwid')) {
    row2.addComponents(new ButtonBuilder().setCustomId('reset_hwid').setLabel(t(lang, 'btn_reset_hwid')).setEmoji('🔄').setStyle(ButtonStyle.Danger));
  }

  const rows = [row1];
  if (row2.components.length > 0) rows.push(row2);
  return rows;
}

// ----------------------------------------------------------------
// GÉNÉRATION DE CLÉS
// ----------------------------------------------------------------
function issueKeyForUser(userId, productId, { bypassStock = false } = {}) {
  const products = loadProducts();
  const product = products[productId];
  if (!product) return { error: "Ce produit n'existe plus." };

  const keys = loadKeys();
  const existing = keys.find((k) => k.userId === userId && k.productId === productId);
  if (existing) return { key: existing.key, alreadyExisted: true };

  if (!bypassStock && product.stock && product.stock > 0 && issuedCountForProduct(keys, productId) >= product.stock) {
    return { error: 'Stock épuisé pour ce produit.' };
  }

  const now = Date.now();
  const expiresAt = product.expireDays && product.expireDays > 0 ? now + product.expireDays * 86400000 : null;
  const record = { key: generateKeyString(), productId, userId, hwid: null, hwidResetAt: null, createdAt: now, claimedAt: now, expiresAt, redeemedAt: null };
  keys.push(record);
  saveKeys(keys);
  return { key: record.key, alreadyExisted: false };
}

function bulkGenerate(productId, quantity, { bypassStock = false } = {}) {
  const products = loadProducts();
  const product = products[productId];
  if (!product) return { error: "Ce produit n'existe plus." };

  const keys = loadKeys();
  if (!bypassStock && product.stock && product.stock > 0) {
    const remaining = product.stock - issuedCountForProduct(keys, productId);
    if (quantity > remaining) return { error: `Stock insuffisant (il reste ${remaining} place(s)).` };
  }

  const now = Date.now();
  const generated = [];
  for (let i = 0; i < quantity; i++) {
    const record = { key: generateKeyString(), productId, userId: null, hwid: null, hwidResetAt: null, createdAt: now, claimedAt: null, expiresAt: null, redeemedAt: null };
    keys.push(record);
    generated.push(record.key);
  }
  saveKeys(keys);
  return { keys: generated };
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

function buildHostedLoader(record, product) {
  const base = process.env.PUBLIC_URL || null;
  if (!base) {
    return [
      '-- ⚠️ PUBLIC_URL n\'est pas configuré côté serveur, demande à aln de finir la config.',
      `script_key = "${record.key}"`,
    ].join('\n');
  }
  return [
    `script_key = "${record.key}"`,
    '',
    `loadstring(game:HttpGet("${base.replace(/\/$/, '')}/scripts/hosted/${product.hostedFilename}?key=${record.key}"))()`,
  ].join('\n');
}

async function sendScriptInChunks(sendFn, scriptContent) {
  const chunks = scriptContent.match(/[\s\S]{1,1900}/g) || [];
  for (const chunk of chunks) await sendFn(`\`\`\`lua\n${chunk}\n\`\`\``);
}

// ----------------------------------------------------------------
// SLASH COMMANDS
// ----------------------------------------------------------------
const commands = [
  new SlashCommandBuilder().setName('panel').setDescription('Affiche le panel de distribution'),
  new SlashCommandBuilder().setName('help').setDescription('Affiche l\'aide et les commandes disponibles'),

  new SlashCommandBuilder()
    .setName('addproduct')
    .setDescription('(Admin) Crée un nouveau produit/script (obfusqué automatiquement)')
    .addStringOption((o) => o.setName('nom').setDescription('Nom du produit').setRequired(true))
    .addIntegerOption((o) => o.setName('stock').setDescription('Nombre max de clés (0 = illimité)').setRequired(false))
    .addIntegerOption((o) => o.setName('expiration_jours').setDescription("Durée de validité en jours (0 = jamais)").setRequired(false)),

  new SlashCommandBuilder().setName('listproducts').setDescription('Liste les produits configurés'),

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
    .setDescription('(Admin) Langue utilisée pour les messages vus par les acheteurs')
    .addStringOption((o) => o.setName('langue').setDescription('Langue').setRequired(true)
      .addChoices(
        { name: 'English', value: 'en' },
        { name: 'Français', value: 'fr' },
        { name: 'Español (= anglais pour l\'instant)', value: 'es' },
        { name: 'Português (= anglais pour l\'instant)', value: 'pt' },
        { name: 'Deutsch (= anglais pour l\'instant)', value: 'de' },
      )),

  new SlashCommandBuilder()
    .setName('addbutton')
    .setDescription('(Admin) Ajoute un bouton optionnel au panel')
    .addStringOption((o) => o.setName('bouton').setDescription('Le bouton').setRequired(true)
      .addChoices(
        { name: 'Obtenir mes clés', value: 'key_get' },
        { name: 'View Script (déjà possédée)', value: 'view_script' },
        { name: 'Key Info', value: 'key_info' },
        { name: 'Get Buyer Role', value: 'get_buyer_role' },
        { name: 'Reset HWID', value: 'reset_hwid' },
      )),

  new SlashCommandBuilder()
    .setName('removebutton')
    .setDescription('(Admin) Retire un bouton optionnel du panel')
    .addStringOption((o) => o.setName('bouton').setDescription('Le bouton').setRequired(true)
      .addChoices(
        { name: 'Obtenir mes clés', value: 'key_get' },
        { name: 'View Script (déjà possédée)', value: 'view_script' },
        { name: 'Key Info', value: 'key_info' },
        { name: 'Get Buyer Role', value: 'get_buyer_role' },
        { name: 'Reset HWID', value: 'reset_hwid' },
      )),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
      console.log('Commandes slash enregistrées (guild).');
    } else {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log('Commandes slash enregistrées (global).');
    }
  } catch (err) {
    console.error('Erreur enregistrement des commandes :', err);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  await registerCommands();
});

// ----------------------------------------------------------------
// AUTO-GÉNÉRATION QUAND UN RÔLE LIÉ EST ATTRIBUÉ
// ----------------------------------------------------------------
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const blacklist = loadBlacklist();
  if (blacklist[newMember.id]) return;

  const roleMap = loadRoleMap();
  const newRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));

  for (const [, role] of newRoles) {
    const productId = roleMap[role.id];
    if (!productId) continue;
    const result = issueKeyForUser(newMember.id, productId);
    if (result.error || result.alreadyExisted) continue;
    const products = loadProducts();
    await dmUser(newMember.user, {
      embeds: [
        new EmbedBuilder()
          .setColor(APP_CONFIG.EMBED_COLOR)
          .setTitle('🔑 Nouvelle clé générée')
          .setDescription(`Produit : **${products[productId]?.name || productId}**\n\`\`\`${result.key}\`\`\`\nUtilise le panel du serveur pour recevoir le script.`),
      ],
    });
  }
});

// ----------------------------------------------------------------
// INTERACTIONS
// ----------------------------------------------------------------
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // --- Autocomplete produit ---
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused().toLowerCase();
      const products = loadProducts();
      const choices = Object.entries(products)
        .filter(([id, p]) => p.name.toLowerCase().includes(focused) || id.includes(focused))
        .slice(0, 24)
        .map(([id, p]) => ({ name: p.name, value: id }));
      if (interaction.commandName === 'killswitch') choices.unshift({ name: 'Tous les produits', value: 'tous' });
      await interaction.respond(choices.slice(0, 25));
      return;
    }

    const isAdmin = interaction.user.id === process.env.OWNER_ID;

    // --- Slash commands ---
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.commandName;

      if (cmd === 'panel') {
        await interaction.deferReply();
        await interaction.editReply({ embeds: [buildPanelEmbed()], components: buildPanelButtons() });
        return;
      }

      if (cmd === 'listproducts') {
        await interaction.deferReply({ ephemeral: true });
        const products = loadProducts();
        const keys = loadKeys();
        const entries = Object.entries(products);
        if (entries.length === 0) { await interaction.editReply({ content: 'Aucun produit configuré.' }); return; }
        const embed = new EmbedBuilder().setColor(APP_CONFIG.EMBED_COLOR).setTitle('📦 Produits');
        for (const [id, p] of entries) {
          const issued = issuedCountForProduct(keys, id);
          const stockStr = p.stock && p.stock > 0  ? `${issued}/${p.stock}` : `${issued}/∞`;
          const expStr = p.expireDays && p.expireDays > 0  ? `${p.expireDays}j` : 'jamais';
          embed.addFields({ name: `${p.name} (${id})${p.killswitch ? ' 🔒' : ''}`, value: `Stock: ${stockStr} | Expiration: ${expStr}` });
        }
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (cmd === 'help') {
        await interaction.deferReply({ ephemeral: true });
        const config = loadConfig();
        const lang = config.language;
        const embed = new EmbedBuilder().setColor(APP_CONFIG.EMBED_COLOR).setTitle(t(lang, 'help_title'));
        embed.addFields({
          name: t(lang, 'help_user_section'),
          value: '`/panel` — affiche le panneau\n`/help` — cette aide',
        });
        if (isAdmin) {
          embed.addFields({
            name: t(lang, 'help_admin_section'),
            value: [
              '**Produits** : `/addproduct` `/listproducts` `/removeproduct` `/setrole`',
              '**Clés** : `/genkey` `/whitelist` `/bulkgen` `/revokekey` `/deletekey` `/deleteuserkeys` `/lookupkey` `/lookupuser`',
              '**Sécurité** : `/resetkeyhwid` `/sethwidcooldown` `/killswitch` `/blacklist` `/unblacklist`',
              '**Apparence** : `/setcolor` `/settitle` `/setdescription` `/setfooter` `/addbutton` `/removebutton`',
              '**Autre** : `/language` `/stats`',
            ].join('\n'),
          });
        }
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (!isAdmin) { await interaction.reply({ content: '❌ Réservé aux administrateurs.', ephemeral: true }); return; }

      // /addproduct ouvre une fenêtre : doit être la toute première réponse
      if (cmd === 'addproduct') {
        const name = interaction.options.getString('nom');
        const stock = interaction.options.getInteger('stock') || 0;
        const expireDays = interaction.options.getInteger('expiration_jours') || 0;
        const id = slugify(name);
        pendingProducts.set(interaction.user.id, { id, name, stock, expireDays });
        const modal = new ModalBuilder().setCustomId('modal_addproduct').setTitle(`Script pour ${name}`.slice(0, 45));
        const scriptInput = new TextInputBuilder().setCustomId('script_content').setLabel('Lien Pastebin/Pastefy (raw) ou code').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('https://pastefy.app/xxxx/raw ou colle le code directement');
        modal.addComponents(new ActionRowBuilder().addComponents(scriptInput));
        await interaction.showModal(modal);
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      if (cmd === 'removeproduct') {
        const id = interaction.options.getString('produit');
        const products = loadProducts();
        if (!products[id]) { await interaction.editReply({ content: '❌ Produit introuvable.' }); return; }
        delete products[id];
        saveProducts(products);
        const roleMap = loadRoleMap();
        for (const roleId of Object.keys(roleMap)) if (roleMap[roleId] === id) delete roleMap[roleId];
        saveRoleMap(roleMap);
        await interaction.editReply({ content: '✅ Produit supprimé.' });
        return;
      }

      if (cmd === 'setrole') {
        const role = interaction.options.getRole('role');
        const productId = interaction.options.getString('produit');
        const products = loadProducts();
        if (!products[productId]) { await interaction.editReply({ content: '❌ Produit introuvable.' }); return; }
        const roleMap = loadRoleMap();
        roleMap[role.id] = productId;
        saveRoleMap(roleMap);
        await interaction.editReply({ content: `✅ <@&${role.id}> déclenche maintenant une clé pour **${products[productId].name}**.` });
        return;
      }

      if (cmd === 'genkey') {
        const target = interaction.options.getUser('utilisateur');
        const productId = interaction.options.getString('produit');
        const blacklist = loadBlacklist();
        if (blacklist[target.id]) { await interaction.editReply({ content: '❌ Cet utilisateur est blacklist.' }); return; }
        const result = issueKeyForUser(target.id, productId, { bypassStock: true });
        if (result.error) { await interaction.editReply({ content: `❌ ${result.error}` }); return; }
        await interaction.editReply({ content: `✅ Clé pour <@${target.id}> : \`${result.key}\`` });
        return;
      }

      if (cmd === 'whitelist') {
        const target = interaction.options.getUser('utilisateur');
        const productId = interaction.options.getString('produit');
        const blacklist = loadBlacklist();
        if (blacklist[target.id]) { await interaction.editReply({ content: '❌ Cet utilisateur est blacklist.' }); return; }
        const roleMap = loadRoleMap();
        const linkedRoleId = Object.entries(roleMap).find(([, pid]) => pid === productId)?.[0];
        if (linkedRoleId) {
          try {
            const member = await interaction.guild.members.fetch(target.id);
            if (member.roles.cache.has(linkedRoleId)) {
              await interaction.editReply({ content: `ℹ️ <@${target.id}> a déjà ce rôle. Utilise \`/genkey\` pour forcer une nouvelle clé.` });
              return;
            }
            await member.roles.add(linkedRoleId);
            await interaction.editReply({ content: `✅ Rôle <@&${linkedRoleId}> donné à <@${target.id}> — sa clé sera générée et envoyée automatiquement.` });
          } catch (e) {
            await interaction.editReply({ content: "❌ Impossible d'ajouter le rôle (permission Gérer les rôles / hiérarchie)." });
          }
          return;
        }
        const result = issueKeyForUser(target.id, productId, { bypassStock: true });
        if (result.error) { await interaction.editReply({ content: `❌ ${result.error}` }); return; }
        await interaction.editReply({ content: `✅ Clé pour <@${target.id}> : \`${result.key}\` (aucun rôle lié, clé attribuée directement).` });
        return;
      }

      if (cmd === 'bulkgen') {
        const productId = interaction.options.getString('produit');
        const quantity = interaction.options.getInteger('quantite');
        if (quantity < 1 || quantity > 100) { await interaction.editReply({ content: '❌ Quantité entre 1 et 100.' }); return; }
        const result = bulkGenerate(productId, quantity, { bypassStock: true });
        if (result.error) { await interaction.editReply({ content: `❌ ${result.error}` }); return; }
        await interaction.editReply({ content: `✅ ${quantity} clé(s) générée(s) :\n\`\`\`${result.keys.join('\n')}\`\`\`` });
        return;
      }

      if (cmd === 'revokekey' || cmd === 'deletekey') {
        const value = interaction.options.getString('cle').trim().toUpperCase();
        const keys = loadKeys();
        const idx = keys.findIndex((k) => k.key === value);
        if (idx === -1) { await interaction.editReply({ content: '❌ Clé introuvable.' }); return; }
        keys.splice(idx, 1);
        saveKeys(keys);
        await interaction.editReply({ content: '✅ Clé supprimée.' });
        return;
      }

      if (cmd === 'deleteuserkeys') {
        const target = interaction.options.getUser('utilisateur');
        const keys = loadKeys();
        const remaining = keys.filter((k) => k.userId !== target.id);
        const removedCount = keys.length - remaining.length;
        saveKeys(remaining);
        await interaction.editReply({ content: `✅ ${removedCount} clé(s) supprimée(s) pour <@${target.id}>.` });
        return;
      }

      if (cmd === 'lookupkey') {
        const value = interaction.options.getString('cle').trim().toUpperCase();
        const keys = loadKeys();
        const record = findKeyByValue(keys, value);
        if (!record) { await interaction.editReply({ content: '❌ Clé introuvable.' }); return; }
        const products = loadProducts();
        const embed = new EmbedBuilder().setColor(APP_CONFIG.EMBED_COLOR).setTitle(`🔎 ${record.key}`)
          .addFields(
            { name: 'Produit', value: products[record.productId]?.name || record.productId, inline: true },
            { name: 'Propriétaire', value: record.userId ? `<@${record.userId}>` : 'Non réclamée', inline: true },
            { name: 'HWID', value: record.hwid || 'Aucun', inline: true },
            { name: 'Créée', value: fmtDate(record.createdAt), inline: true },
            { name: 'Réclamée', value: fmtDate(record.claimedAt), inline: true },
            { name: 'Expire', value: record.expiresAt ? fmtDate(record.expiresAt) : 'Jamais', inline: true },
            { name: 'Utilisée', value: fmtDate(record.redeemedAt), inline: true }
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (cmd === 'lookupuser') {
        const target = interaction.options.getUser('utilisateur');
        const keys = loadKeys();
        const userKeys = findKeysByUser(keys, target.id);
        const blacklist = loadBlacklist();
        if (userKeys.length === 0) { await interaction.editReply({ content: `${target.tag} n'a aucune clé.${blacklist[target.id] ? ' (Blacklist)' : ''}` }); return; }
        const products = loadProducts();
        const embed = new EmbedBuilder().setColor(APP_CONFIG.EMBED_COLOR).setTitle(`👤 Clés de ${target.tag}`);
        for (const k of userKeys) {
          embed.addFields({ name: products[k.productId]?.name || k.productId, value: `\`${k.key}\` — ${k.redeemedAt ? 'utilisée' : 'non utilisée'}` });
        }
        if (blacklist[target.id]) embed.setDescription(`⚠️ Blacklist : ${blacklist[target.id].reason}`);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (cmd === 'resetkeyhwid') {
        const value = interaction.options.getString('cle').trim().toUpperCase();
        const keys = loadKeys();
        const record = findKeyByValue(keys, value);
        if (!record) { await interaction.editReply({ content: '❌ Clé introuvable.' }); return; }
        record.hwid = null;
        record.hwidResetAt = Date.now();
        saveKeys(keys);
        await interaction.editReply({ content: `✅ HWID réinitialisé pour \`${record.key}\`.` });
        return;
      }

      if (cmd === 'sethwidcooldown') {
        const hours = interaction.options.getInteger('heures');
        const config = loadConfig();
        config.hwidCooldownHours = hours;
        saveConfig(config);
        await interaction.editReply({ content: `✅ Délai de reset HWID : ${hours}h.` });
        return;
      }

      if (cmd === 'killswitch') {
        const productId = interaction.options.getString('produit');
        const state = interaction.options.getString('etat') === 'on';
        if (productId === 'tous') {
          const config = loadConfig();
          config.killswitchGlobal = state;
          saveConfig(config);
          await interaction.editReply({ content: `✅ Killswitch global : ${state ? 'activé (tout bloqué)' : 'désactivé'}.` });
          return;
        }
        const products = loadProducts();
        if (!products[productId]) { await interaction.editReply({ content: '❌ Produit introuvable.' }); return; }
        products[productId].killswitch = state;
        saveProducts(products);
        await interaction.editReply({ content: `✅ ${products[productId].name} : ${state ? 'accès bloqué' : 'accès rétabli'}.` });
        return;
      }

      if (cmd === 'blacklist') {
        const target = interaction.options.getUser('utilisateur');
        const reason = interaction.options.getString('raison') || 'Non spécifiée';
        const blacklist = loadBlacklist();
        blacklist[target.id] = { reason, bannedAt: Date.now() };
        saveBlacklist(blacklist);
        await interaction.editReply({ content: `✅ <@${target.id}> blacklist. Raison : ${reason}` });
        return;
      }

      if (cmd === 'unblacklist') {
        const target = interaction.options.getUser('utilisateur');
        const blacklist = loadBlacklist();
        delete blacklist[target.id];
        saveBlacklist(blacklist);
        await interaction.editReply({ content: `✅ <@${target.id}> retiré de la liste noire.` });
        return;
      }

      if (cmd === 'stats') {
        const products = loadProducts();
        const keys = loadKeys();
        const blacklist = loadBlacklist();
        const totalRedeemed = keys.filter((k) => k.redeemedAt).length;
        const embed = new EmbedBuilder().setColor(APP_CONFIG.EMBED_COLOR).setTitle('📊 Statistiques')
          .addFields(
            { name: 'Produits', value: `${Object.keys(products).length}`, inline: true },
            { name: 'Clés générées', value: `${keys.length}`, inline: true },
            { name: 'Clés utilisées', value: `${totalRedeemed}`, inline: true },
            { name: 'Blacklist', value: `${Object.keys(blacklist).length}`, inline: true }
          );
        for (const [id, p] of Object.entries(products)) {
          embed.addFields({ name: p.name, value: `${issuedCountForProduct(keys, id)} clé(s)`, inline: false });
        }
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (cmd === 'setcolor') {
        const raw = interaction.options.getString('couleur').trim().replace('#', '');
        if (!/^[0-9A-Fa-f]{6}$/.test(raw)) { await interaction.editReply({ content: '❌ Format invalide. Exemple : #ff0000' }); return; }
        const config = loadConfig();
        config.panelColor = parseInt(raw, 16);
        saveConfig(config);
        await interaction.editReply({ content: `✅ Couleur du panel changée en #${raw}.` });
        return;
      }

      if (cmd === 'settitle') {
        const config = loadConfig();
        config.panelTitle = interaction.options.getString('titre');
        saveConfig(config);
        await interaction.editReply({ content: '✅ Titre du panel mis à jour.' });
        return;
      }

      if (cmd === 'setdescription') {
        const config = loadConfig();
        config.panelDescription = interaction.options.getString('texte');
        saveConfig(config);
        await interaction.editReply({ content: '✅ Description du panel mise à jour.' });
        return;
      }

      if (cmd === 'setfooter') {
        const config = loadConfig();
        config.panelFooter = interaction.options.getString('texte');
        saveConfig(config);
        await interaction.editReply({ content: '✅ Pied de page du panel mis à jour.' });
        return;
      }

      if (cmd === 'language') {
        const langChoice = interaction.options.getString('langue');
        const config = loadConfig();
        config.language = langChoice;
        saveConfig(config);
        const note = ['es', 'pt', 'de'].includes(langChoice) ? ' (traduction pas encore faite, affichera l\'anglais)' : '';
        await interaction.editReply({ content: `✅ Langue des acheteurs : ${langChoice}${note}.` });
        return;
      }

      if (cmd === 'addbutton') {
        const btn = interaction.options.getString('bouton');
        const config = loadConfig();
        if (!config.panelButtons.includes(btn)) config.panelButtons.push(btn);
        saveConfig(config);
        await interaction.editReply({ content: `✅ Bouton ajouté au panel. Relance \`/panel\` pour voir le résultat.` });
        return;
      }

      if (cmd === 'removebutton') {
        const btn = interaction.options.getString('bouton');
        const config = loadConfig();
        config.panelButtons = config.panelButtons.filter((b) => b !== btn);
        saveConfig(config);
        await interaction.editReply({ content: `✅ Bouton retiré du panel. Relance \`/panel\` pour voir le résultat.` });
        return;
      }
    }

    // --- Boutons ---
    if (interaction.isButton()) {
      const blacklist = loadBlacklist();
      const config = loadConfig();
      const lang = config.language;

      // key_redeem doit ouvrir une fenêtre : réponse immédiate sans defer
      if (interaction.customId === 'key_redeem') {
        if (blacklist[interaction.user.id]) { await interaction.reply({ content: t(lang, 'msg_blacklisted'), ephemeral: true }); return; }
        const modal = new ModalBuilder().setCustomId('modal_redeem').setTitle(t(lang, 'modal_redeem_title'));
        const keyInput = new TextInputBuilder().setCustomId('key_value').setLabel(t(lang, 'modal_redeem_label')).setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === 'reset_hwid') {
        if (blacklist[interaction.user.id]) { await interaction.reply({ content: t(lang, 'msg_blacklisted'), ephemeral: true }); return; }
        const modal = new ModalBuilder().setCustomId('modal_hwid_reset').setTitle(t(lang, 'modal_hwid_title'));
        const keyInput = new TextInputBuilder().setCustomId('key_value').setLabel(t(lang, 'modal_hwid_label')).setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === 'key_get') {
        await interaction.deferReply({ ephemeral: true });
        if (blacklist[interaction.user.id]) { await interaction.editReply({ content: t(lang, 'msg_blacklisted') }); return; }
        const roleMap = loadRoleMap();
        const member = interaction.member;
        const products = loadProducts();
        const lines = [];
        for (const [roleId, productId] of Object.entries(roleMap)) {
          if (!member.roles.cache.has(roleId)) continue;
          const result = issueKeyForUser(member.id, productId);
          if (result.error) { lines.push(`❌ ${products[productId]?.name || productId} : ${result.error}`); continue; }
          lines.push(`🔑 ${products[productId]?.name || productId} : \`${result.key}\``);
        }
        if (lines.length === 0) { await interaction.editReply({ content: t(lang, 'msg_no_product_access') }); return; }
        const sent = await dmUser(interaction.user, `Tes clés :\n${lines.join('\n')}`);
        await interaction.editReply({ content: sent ? t(lang, 'msg_keys_sent_dm') : t(lang, 'msg_dm_failed') });
        return;
      }

      if (interaction.customId === 'view_script') {
        await interaction.deferReply({ ephemeral: true });
        if (blacklist[interaction.user.id]) { await interaction.editReply({ content: t(lang, 'msg_blacklisted') }); return; }
        const keys = loadKeys();
        const owned = findKeysByUser(keys, interaction.user.id);
        if (owned.length === 0) { await interaction.editReply({ content: t(lang, 'msg_no_key_owned') }); return; }

        if (owned.length === 1) {
          const deliveryRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`deliver_dm_${owned[0].key}`).setLabel(t(lang, 'btn_deliver_dm')).setEmoji('📩').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`deliver_here_${owned[0].key}`).setLabel(t(lang, 'btn_deliver_here')).setEmoji('💬').setStyle(ButtonStyle.Secondary)
          );
          await interaction.editReply({ content: t(lang, 'msg_choose_delivery'), components: [deliveryRow] });
          return;
        }

        const products = loadProducts();
        const select = new StringSelectMenuBuilder().setCustomId('select_view_script').setPlaceholder(t(lang, 'select_product_placeholder'))
          .addOptions(owned.slice(0, 25).map((k) => ({ label: products[k.productId]?.name || k.productId, value: k.key })));
        await interaction.editReply({ components: [new ActionRowBuilder().addComponents(select)] });
        return;
      }

      if (interaction.customId === 'key_info') {
        await interaction.deferReply({ ephemeral: true });
        if (blacklist[interaction.user.id]) { await interaction.editReply({ content: t(lang, 'msg_blacklisted') }); return; }
        const keys = loadKeys();
        const owned = findKeysByUser(keys, interaction.user.id);
        if (owned.length === 0) { await interaction.editReply({ content: t(lang, 'msg_no_key_owned') }); return; }
        const products = loadProducts();
        const embed = new EmbedBuilder().setColor(APP_CONFIG.EMBED_COLOR).setTitle(t(lang, 'key_info_title'));
        for (const k of owned) {
          embed.addFields({
            name: products[k.productId]?.name || k.productId,
            value: `HWID: ${k.hwid ? '✅' : '—'} | Expire: ${k.expiresAt ? fmtDate(k.expiresAt) : 'Jamais'} | ${k.redeemedAt ? 'Utilisée' : 'Non utilisée'}`,
          });
        }
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (interaction.customId === 'get_buyer_role') {
        await interaction.deferReply({ ephemeral: true });
        if (blacklist[interaction.user.id]) { await interaction.editReply({ content: t(lang, 'msg_blacklisted') }); return; }
        const roleMap = loadRoleMap();
        const entries = Object.entries(roleMap);
        if (entries.length === 0) { await interaction.editReply({ content: t(lang, 'msg_no_role_configured') }); return; }

        if (entries.length === 1) {
          const [roleId] = entries[0];
          if (interaction.member.roles.cache.has(roleId)) { await interaction.editReply({ content: t(lang, 'msg_role_already') }); return; }
          await interaction.member.roles.add(roleId);
          await interaction.editReply({ content: t(lang, 'msg_role_granted') });
          return;
        }

        const products = loadProducts();
        const select = new StringSelectMenuBuilder().setCustomId('select_buyer_role').setPlaceholder(t(lang, 'select_product_placeholder'))
          .addOptions(entries.slice(0, 25).map(([roleId, productId]) => ({ label: products[productId]?.name || productId, value: roleId })));
        await interaction.editReply({ components: [new ActionRowBuilder().addComponents(select)] });
        return;
      }

      // deliver_dm_<clé> / deliver_here_<clé> : choix fait par l'acheteur
      // après avoir validé sa clé dans le modal de redeem.
      if (interaction.customId.startsWith('deliver_dm_') || interaction.customId.startsWith('deliver_here_')) {
        await interaction.deferUpdate();
        const viaDm = interaction.customId.startsWith('deliver_dm_');
        const keyValue = interaction.customId.replace(viaDm ? 'deliver_dm_' : 'deliver_here_', '');

        const keys = loadKeys();
        const record = findKeyByValue(keys, keyValue);
        const blacklistNow = loadBlacklist();

        if (!record || record.userId !== interaction.user.id) { await interaction.editReply({ content: t(lang, 'msg_invalid_key'), components: [] }); return; }
        if (blacklistNow[interaction.user.id]) { await interaction.editReply({ content: t(lang, 'msg_blacklisted'), components: [] }); return; }

        const products = loadProducts();
        const product = products[record.productId];
        if (!product) { await interaction.editReply({ content: t(lang, 'msg_no_script_configured'), components: [] }); return; }
        if (config.killswitchGlobal || product.killswitch) { await interaction.editReply({ content: t(lang, 'msg_product_disabled'), components: [] }); return; }
        if (record.expiresAt && Date.now() > record.expiresAt) { await interaction.editReply({ content: t(lang, 'msg_key_expired'), components: [] }); return; }

        const loaderSnippet = buildHostedLoader(record, product);

        if (viaDm) {
          const sent = await dmUser(interaction.user, `\`\`\`lua\n${loaderSnippet}\n\`\`\``);
          await interaction.editReply({ content: sent ? t(lang, 'msg_script_sent_dm') : t(lang, 'msg_dm_failed'), components: [] });
        } else {
          await interaction.editReply({ content: `\`\`\`lua\n${loaderSnippet}\n\`\`\``, components: [] });
        }
        return;
      }
    }

    // --- Menus déroulants (choix d'un produit parmi plusieurs) ---
    if (interaction.isStringSelectMenu()) {
      const blacklist = loadBlacklist();
      const config = loadConfig();
      const lang = config.language;
      if (blacklist[interaction.user.id]) { await interaction.update({ content: t(lang, 'msg_blacklisted'), components: [] }); return; }

      if (interaction.customId === 'select_view_script') {
        const keyValue = interaction.values[0];
        const deliveryRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`deliver_dm_${keyValue}`).setLabel(t(lang, 'btn_deliver_dm')).setEmoji('📩').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`deliver_here_${keyValue}`).setLabel(t(lang, 'btn_deliver_here')).setEmoji('💬').setStyle(ButtonStyle.Secondary)
        );
        await interaction.update({ content: t(lang, 'msg_choose_delivery'), components: [deliveryRow] });
        return;
      }

      if (interaction.customId === 'select_buyer_role') {
        const roleId = interaction.values[0];
        if (interaction.member.roles.cache.has(roleId)) { await interaction.update({ content: t(lang, 'msg_role_already'), components: [] }); return; }
        try {
          await interaction.member.roles.add(roleId);
          await interaction.update({ content: t(lang, 'msg_role_granted'), components: [] });
        } catch (e) {
          await interaction.update({ content: "❌ Impossible d'ajouter le rôle.", components: [] });
        }
        return;
      }
    }

    // --- Modals ---
    if (interaction.isModalSubmit()) {
      await interaction.deferReply({ ephemeral: true });
      const config = loadConfig();
      const lang = config.language;

      if (interaction.customId === 'modal_addproduct') {
        const pending = pendingProducts.get(interaction.user.id);
        pendingProducts.delete(interaction.user.id);
        if (!pending) { await interaction.editReply({ content: '❌ Session expirée, relance /addproduct.' }); return; }

        const input = interaction.fields.getTextInputValue('script_content').trim();
        let rawContent = input;
        if (/^https?:\/\//i.test(input)) {
          try {
            rawContent = await fetchUrl(input);
          } catch (e) {
            await interaction.editReply({ content: `❌ Impossible de récupérer le lien (${e.message}). Vérifie que c'est bien un lien "raw".` });
            return;
          }
        }

        const obfuscated = obfuscateScript(rawContent);
        const hostedFilename = `${crypto.randomBytes(24).toString('hex')}.lua`;
        const products = loadProducts();
        products[pending.id] = {
          name: pending.name, script: obfuscated, rawScript: rawContent, hostedFilename,
          stock: pending.stock, expireDays: pending.expireDays, killswitch: false,
        };
        saveProducts(products);
        await interaction.editReply({ content: `✅ Produit **${pending.name}** créé (id: \`${pending.id}\`) — script obfusqué automatiquement (Moon Obf).` });
        return;
      }

      if (interaction.customId === 'modal_hwid_reset') {
        const inputKey = interaction.fields.getTextInputValue('key_value').trim().toUpperCase();
        const keys = loadKeys();
        const record = findKeyByValue(keys, inputKey);
        if (!record || record.userId !== interaction.user.id) { await interaction.editReply({ content: t(lang, 'msg_no_hwid_key') }); return; }

        const cooldownMs = (config.hwidCooldownHours || 0) * 3600000;
        if (cooldownMs > 0 && record.hwidResetAt && Date.now() - record.hwidResetAt < cooldownMs) {
          const remainingH = Math.ceil((cooldownMs - (Date.now() - record.hwidResetAt)) / 3600000);
          await interaction.editReply({ content: t(lang, 'msg_hwid_cooldown', { hours: remainingH }) });
          return;
        }

        record.hwid = null;
        record.hwidResetAt = Date.now();
        saveKeys(keys);
        await interaction.editReply({ content: t(lang, 'msg_hwid_reset_success') });
        return;
      }

      if (interaction.customId === 'modal_redeem') {
        const blacklist = loadBlacklist();
        if (blacklist[interaction.user.id]) { await interaction.editReply({ content: t(lang, 'msg_blacklisted') }); return; }

        const inputKey = interaction.fields.getTextInputValue('key_value').trim().toUpperCase();
        const keys = loadKeys();
        const record = findKeyByValue(keys, inputKey);

        if (!record) { await interaction.editReply({ content: t(lang, 'msg_invalid_key') }); return; }
        if (record.userId && record.userId !== interaction.user.id) { await interaction.editReply({ content: t(lang, 'msg_key_owned_by_other') }); return; }

        const products = loadProducts();
        const product = products[record.productId];
        if (config.killswitchGlobal || product?.killswitch) { await interaction.editReply({ content: t(lang, 'msg_product_disabled') }); return; }

        if (!record.userId) {
          record.userId = interaction.user.id;
          record.claimedAt = Date.now();
          record.expiresAt = product?.expireDays && product.expireDays > 0  ? Date.now() + product.expireDays * 86400000 : null;
        }

        if (record.expiresAt && Date.now() > record.expiresAt) { await interaction.editReply({ content: t(lang, 'msg_key_expired') }); return; }
        if (!product || !product.script) { await interaction.editReply({ content: t(lang, 'msg_no_script_configured') }); return; }

        record.redeemedAt = record.redeemedAt || Date.now();
        saveKeys(keys);

        const deliveryRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`deliver_dm_${record.key}`).setLabel(t(lang, 'btn_deliver_dm')).setEmoji('📩').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`deliver_here_${record.key}`).setLabel(t(lang, 'btn_deliver_here')).setEmoji('💬').setStyle(ButtonStyle.Secondary)
        );
        await interaction.editReply({ content: t(lang, 'msg_choose_delivery'), components: [deliveryRow] });
        return;
      }
    }
  } catch (err) {
    console.error('Erreur interaction :', err);
    if (interaction.isRepliable && interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Une erreur est survenue.', ephemeral: true }).catch(() => {});
    } else if (interaction.deferred) {
      await interaction.editReply({ content: 'Une erreur est survenue.' }).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

// Lance aussi le petit serveur web (vérification HWID + scripts hébergés)
// dans le même programme, pour qu'ils partagent les mêmes données et que
// l'hébergement (Render/Railway) reste tout-en-un.
require('./server');
