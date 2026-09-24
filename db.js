// Stockage PAR SERVEUR. Chaque serveur Discord a son propre "coffre" :
// produits, clés, rôles liés, blacklist, config, panels, permissions.
// Rien n'est partagé entre serveurs : un nouveau serveur démarre à zéro.
//
// Tout est gardé en mémoire (lectures instantanées), écrit en local
// (data/store.json) ET sur MongoDB si MONGODB_URI est configuré.
// Sans Mongo, ça ne survit pas à un redéploiement Render (plan gratuit).

const fs = require('fs');
const path = require('path');
let MongoClient;
try { MongoClient = require('mongodb').MongoClient; } catch (e) { MongoClient = null; }

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const STORE_FILE = path.join(DATA_DIR, 'store.json');

// Anciens fichiers (avant le passage au multi-serveurs), lus une seule fois
// pour la migration vers ton serveur principal (GUILD_ID).
const LEGACY = {
  keys: { file: 'keys.json', fallback: [] },
  products: { file: 'products.json', fallback: {} },
  roleMap: { file: 'roleMap.json', fallback: {} },
  blacklist: { file: 'blacklist.json', fallback: {} },
  config: { file: 'config.json', fallback: {} },
  panels: { file: 'panels.json', fallback: [] },
};

function defaultGlobal() { return { disabledGuildIds: [], legacyMigrated: false }; }

function defaultConfig() {
  return {
    language: 'en',
    visibility: 'private', // 'private' (éphémère) ou 'public' pour les réponses sans clé
    killswitchGlobal: false,
    hwidCooldownHours: 0,
    panelColor: 0x5865F2,
    panelTitle: null,
    panelDescription: null,
    panelFooter: 'Made by aln',
    buttonEmojis: { key_get: '🔑', key_redeem: '📥', view_script: '📜', key_info: '📊', get_buyer_role: '👤', reset_hwid: '🔄' },
  };
}

function defaultGuild(botJoinedAt = null) {
  return {
    botJoinedAt,
    setupDone: false, // tant que /start n'a pas été fait, AUCUNE commande ne marche
    setupAt: null,
    config: defaultConfig(),
    allowedRoles: [],
    allowedUsers: [],
    products: {},
    keys: [],
    roleMap: {},
    blacklist: {},
    panels: [], // { messageId, channelId, createdAt, buttons: [], productIds: [] }
  };
}

function normalizeGuild(data) {
  const base = defaultGuild();
  const d = data || {};
  return { ...base, ...d, config: { ...base.config, ...(d.config || {}) } };
}

const state = { global: defaultGlobal(), guilds: {} };
let collection = null;
let mongoReady = false;

function readLocalStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    state.global = { ...defaultGlobal(), ...(raw.global || {}) };
    for (const [id, g] of Object.entries(raw.guilds || {})) state.guilds[id] = normalizeGuild(g);
  } catch (e) { /* premier démarrage : rien à lire */ }
}
function writeLocalStore() {
  try { fs.writeFileSync(STORE_FILE, JSON.stringify(state)); }
  catch (e) { console.error('Écriture locale impossible :', e.message); }
}

function readLegacyLocal() {
  const out = {};
  for (const [name, { file, fallback }] of Object.entries(LEGACY)) {
    try { out[name] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8') || JSON.stringify(fallback)); }
    catch (e) { out[name] = fallback; }
  }
  return out;
}

// Migration : ce que tu avais AVANT (données globales) est rangé dans ton
// serveur principal (GUILD_ID). Tous les autres serveurs repartent de zéro.
async function migrateLegacy(legacy) {
  if (state.global.legacyMigrated) return;
  const keys = Array.isArray(legacy.keys) ? legacy.keys : [];
  const products = legacy.products || {};
  const roleMap = legacy.roleMap || {};
  const panels = Array.isArray(legacy.panels) ? legacy.panels : [];
  const hasLegacy = keys.length || Object.keys(products).length || Object.keys(roleMap).length || panels.length;

  if (!hasLegacy) { state.global.legacyMigrated = true; await saveGlobal(); return; }

  const homeId = process.env.GUILD_ID;
  if (!homeId) {
    console.warn('⚠️ Anciennes données trouvées mais GUILD_ID est vide : migration reportée (mets GUILD_ID = ton serveur principal).');
    return;
  }
  if (!state.guilds[homeId]) {
    const oldCfg = legacy.config || {};
    const g = defaultGuild();
    const { panelButtons, disabledGuildIds, ...cfg } = oldCfg;
    g.config = { ...g.config, ...cfg };
    g.setupDone = true; // ton serveur principal est déjà configuré
    g.setupAt = Date.now();
    g.products = products;
    g.keys = keys;
    g.roleMap = roleMap;
    g.blacklist = legacy.blacklist || {};
    const legacyButtons = [...new Set([...(panelButtons || ['key_get', 'reset_hwid']), 'key_redeem'])];
    g.panels = panels.map((p) => ({ ...p, buttons: legacyButtons, productIds: Object.keys(products) }));
    state.guilds[homeId] = g;
    await save(homeId);
    if (Array.isArray(disabledGuildIds) && disabledGuildIds.length) {
      state.global.disabledGuildIds = [...new Set([...(state.global.disabledGuildIds || []), ...disabledGuildIds])];
    }
    console.log(`Migration : anciennes données rangées dans le serveur ${homeId}.`);
  }
  state.global.legacyMigrated = true;
  await saveGlobal();
}

async function initDb() {
  const uri = process.env.MONGODB_URI;
  let legacy = null;

  if (uri && MongoClient) {
    try {
      const client = new MongoClient(uri);
      await client.connect();
      collection = client.db('panelbot').collection('store');
      const docs = await collection.find({}).toArray();
      const legacyMongo = {};
      for (const doc of docs) {
        if (doc._id === 'global') state.global = { ...defaultGlobal(), ...doc.data };
        else if (String(doc._id).startsWith('guild:')) state.guilds[String(doc._id).slice(6)] = normalizeGuild(doc.data);
        else if (LEGACY[doc._id]) legacyMongo[doc._id] = doc.data;
      }
      mongoReady = true;
      legacy = { ...readLegacyLocal(), ...legacyMongo };
      console.log('MongoDB connecté — données persistantes activées.');
    } catch (e) {
      console.error('Connexion MongoDB échouée, on reste sur les fichiers locaux :', e.message);
    }
  } else {
    console.log('MongoDB non configuré : stockage local uniquement (non persistant entre déploiements Render).');
  }

  if (!mongoReady) { readLocalStore(); legacy = readLegacyLocal(); }
  await migrateLegacy(legacy);
}

// ---- API ----
function peek(guildId) { return state.guilds[guildId] || null; }
function get(guildId) {
  if (!state.guilds[guildId]) state.guilds[guildId] = defaultGuild();
  return state.guilds[guildId];
}
function all() { return state.guilds; }
function getGlobal() { return state.global; }

async function save(guildId) {
  writeLocalStore();
  if (mongoReady && collection && state.guilds[guildId]) {
    try { await collection.updateOne({ _id: `guild:${guildId}` }, { $set: { data: state.guilds[guildId] } }, { upsert: true }); }
    catch (e) { console.error('Erreur écriture MongoDB :', e.message); }
  }
}
async function saveGlobal() {
  writeLocalStore();
  if (mongoReady && collection) {
    try { await collection.updateOne({ _id: 'global' }, { $set: { data: state.global } }, { upsert: true }); }
    catch (e) { console.error('Erreur écriture MongoDB :', e.message); }
  }
}
// Remet un serveur complètement à zéro (bot ré-ajouté).
async function reset(guildId, botJoinedAt = null) {
  state.guilds[guildId] = defaultGuild(botJoinedAt);
  await save(guildId);
}

module.exports = { initDb, peek, get, all, save, reset, getGlobal, saveGlobal };
