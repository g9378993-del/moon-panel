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

function defaultGlobal() { return { disabledGuildIds: [], legacyMigrated: false, guildLog: [] }; }

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

const status = { uriSet: false, mongoConnected: false, connectError: null, lastSaveError: null, lastSaveAt: null };

async function connectMongo(uri) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
      await client.connect();
      return client;
    } catch (e) {
      status.connectError = e.message;
      console.error(`Connexion MongoDB échouée (essai ${attempt}/3) :`, e.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return null;
}

async function initDb() {
  const uri = process.env.MONGODB_URI;
  let legacy = null;
  status.uriSet = !!uri;

  if (uri && !MongoClient) status.connectError = "le paquet 'mongodb' n'est pas installé";
  if (uri && MongoClient) {
    const client = await connectMongo(uri);
    if (client) {
      try {
        collection = client.db('panelbot').collection('store');
        const docs = await collection.find({}).toArray();
        const legacyMongo = {};
        for (const doc of docs) {
          if (doc._id === 'global') state.global = { ...defaultGlobal(), ...doc.data };
          else if (String(doc._id).startsWith('guild:')) state.guilds[String(doc._id).slice(6)] = normalizeGuild(doc.data);
          else if (LEGACY[doc._id]) legacyMongo[doc._id] = doc.data;
        }
        mongoReady = true;
        status.mongoConnected = true;
        status.connectError = null;
        legacy = { ...readLegacyLocal(), ...legacyMongo };
        console.log(`MongoDB connecté — données persistantes activées (${Object.keys(state.guilds).length} serveur(s) chargé(s)).`);
      } catch (e) {
        status.connectError = e.message;
        console.error('Lecture MongoDB impossible :', e.message);
      }
    }
    if (!mongoReady) console.error('⚠️ MongoDB inaccessible : le bot tourne SANS stockage persistant, les données seront perdues au redémarrage.');
  } else if (!uri) {
    console.log('MongoDB non configuré (MONGODB_URI absent) : stockage local uniquement, NON persistant sur Render.');
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
function getStatus() { return { ...status, persistent: mongoReady }; }
function getGlobal() { return state.global; }

async function mongoWrite(id, data) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await collection.updateOne({ _id: id }, { $set: { data } }, { upsert: true });
      status.lastSaveError = null;
      status.lastSaveAt = Date.now();
      return;
    } catch (e) {
      status.lastSaveError = e.message;
      console.error(`Erreur écriture MongoDB (essai ${attempt}/2) :`, e.message);
    }
  }
}
async function save(guildId) {
  writeLocalStore();
  if (mongoReady && collection && state.guilds[guildId]) await mongoWrite(`guild:${guildId}`, state.guilds[guildId]);
}
async function saveGlobal() {
  writeLocalStore();
  if (mongoReady && collection) await mongoWrite('global', state.global);
}
// Remet un serveur complètement à zéro (bot ré-ajouté).
async function reset(guildId, botJoinedAt = null) {
  state.guilds[guildId] = defaultGuild(botJoinedAt);
  await save(guildId);
}

module.exports = { initDb, peek, get, all, save, reset, getGlobal, saveGlobal, getStatus };
