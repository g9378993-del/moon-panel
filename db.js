// Stockage PAR SERVEUR (chaque serveur a sa propre config, ses warns, etc.).
// Même principe que Moon Bot : MongoDB si MONGODB_URI est configuré, sinon
// fichier local (non persistant entre redéploiements Render).

const fs = require('fs');
const path = require('path');
let MongoClient;
try { MongoClient = require('mongodb').MongoClient; } catch (e) { MongoClient = null; }

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const STORE_FILE = path.join(DATA_DIR, 'store.json');

function defaultGuild() {
  return {
    staffRoles: [],
    modLogChannelId: null,
    constructionMode: false,
    nextCaseId: 1,
    cases: [],
    automod: {
      antiLink: { enabled: false },
      antiSpam: { enabled: true, maxMessages: 6, perSeconds: 7, timeoutMinutes: 10 },
      antiMention: { enabled: true, maxMentions: 5, timeoutMinutes: 10 },
      badWords: { enabled: false, words: [] },
      profanity: { enabled: true },
      antiRaid: { enabled: true, joinThreshold: 6, windowSeconds: 20, minAccountAgeDays: 3, action: 'timeout' },
      antialts: { enabled: false, minAccountAgeDays: 7, action: 'kick' },
    },
    warnThresholds: [
      { count: 3, action: 'timeout', minutes: 60 },
      { count: 5, action: 'timeout', minutes: 1440 },
      { count: 7, action: 'ban', minutes: null },
    ],
    lockedChannels: {},
    aiChannels: [],
    aiEnabled: true,
    aiLanguage: null,
    aiPersona: null,
    cmdPerms: {},
    tickets: {
      enabled: false,
      categoryId: null,
      supportRoleId: null,
      panelChannelId: null,
      panelMessageId: null,
      welcomeMessage: null,
      counter: 1,
      open: {},
    },
  };
}
function defaultUser() {
  return {
    language: null,
  };
}
// ── AJOUT : état global (journal des serveurs, etc.) ───────────────────────
function defaultGlobal() {
  return {
    guildLog: [],  // { id, name, ownerId, addedAt, removedAt }
  };
}

function normalizeGuild(data) {
  const base = defaultGuild();
  const d = data || {};
  return {
    ...base, ...d,
    automod: {
      antiLink: { ...base.automod.antiLink, ...(d.automod?.antiLink || {}) },
      antiSpam: { ...base.automod.antiSpam, ...(d.automod?.antiSpam || {}) },
      antiMention: { ...base.automod.antiMention, ...(d.automod?.antiMention || {}) },
      badWords: { ...base.automod.badWords, ...(d.automod?.badWords || {}) },
      profanity: { ...base.automod.profanity, ...(d.automod?.profanity || {}) },
      antiRaid: { ...base.automod.antiRaid, ...(d.automod?.antiRaid || {}) },
      antialts: { ...base.automod.antialts, ...(d.automod?.antialts || {}) },
    },
    tickets: {
      ...base.tickets,
      ...(d.tickets || {}),
      open: { ...(d.tickets?.open || {}) },
    },
  };
}

// ── state inclut maintenant global ────────────────────────────────────────
const state = { guilds: {}, users: {}, global: null };
let collection = null;
let mongoReady = false;
const status = { uriSet: false, mongoConnected: false, connectError: null, lastSaveError: null };

function readLocalStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    for (const [id, g] of Object.entries(raw.guilds || {})) state.guilds[id] = normalizeGuild(g);
    for (const [id, u] of Object.entries(raw.users || {})) state.users[id] = { ...defaultUser(), ...u };
    // ── AJOUT : chargement global ──────────────────────────────────────────
    state.global = { ...defaultGlobal(), ...(raw.global || {}) };
  } catch (e) { /* premier démarrage : rien à lire */ }
}
function writeLocalStore() {
  try { fs.writeFileSync(STORE_FILE, JSON.stringify(state)); }
  catch (e) { console.error('Écriture locale impossible :', e.message); }
}

async function connectMongo(uri) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      return client;
    } catch (e) {
      status.connectError = e.message;
      console.error(`Connexion MongoDB échouée (essai ${attempt}/2) :`, e.message);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}

async function initDb() {
  const uri = process.env.MONGODB_URI;
  status.uriSet = !!uri;

  if (uri && !MongoClient) status.connectError = "le paquet 'mongodb' n'est pas installé";
  if (uri && MongoClient) {
    const client = await connectMongo(uri);
    if (client) {
      try {
        collection = client.db('modbot').collection('store');
        const docs = await collection.find({}).toArray();
        for (const doc of docs) {
          const id = String(doc._id);
          if      (id.startsWith('guild:')) state.guilds[id.slice(6)] = normalizeGuild(doc.data);
          else if (id.startsWith('user:'))  state.users[id.slice(5)]  = { ...defaultUser(), ...doc.data };
          // ── AJOUT : chargement global depuis MongoDB ───────────────────
          else if (id === 'global')         state.global = { ...defaultGlobal(), ...doc.data };
        }
        mongoReady = true;
        status.mongoConnected = true;
        status.connectError = null;
        console.log(`MongoDB connecté — données persistantes activées (${Object.keys(state.guilds).length} serveur(s) chargé(s)).`);
      } catch (e) {
        status.connectError = e.message;
        console.error('Lecture MongoDB impossible :', e.message);
      }
    }
    if (!mongoReady) console.error('⚠️ MongoDB inaccessible : le bot tourne SANS stockage persistant.');
  } else {
    console.log('MongoDB non configuré (MONGODB_URI absent) : stockage local uniquement, NON persistant sur Render.');
  }
  if (!mongoReady) readLocalStore();
  // Garantit que state.global est toujours initialisé même sans fichier local
  if (!state.global) state.global = defaultGlobal();
}

function peek(guildId)    { return state.guilds[guildId] || null; }
function get(guildId) {
  if (!state.guilds[guildId]) state.guilds[guildId] = defaultGuild();
  return state.guilds[guildId];
}
function peekUser(userId) { return state.users[userId] || null; }
function getUser(userId) {
  if (!state.users[userId]) state.users[userId] = defaultUser();
  return state.users[userId];
}
// ── AJOUT : getGlobal / saveGlobal ────────────────────────────────────────
function getGlobal() {
  if (!state.global) state.global = defaultGlobal();
  return state.global;
}
async function saveGlobal() {
  writeLocalStore();
  if (mongoReady && collection) await mongoWrite('global', state.global);
}

function getStatus() { return { ...status, persistent: mongoReady }; }

async function mongoWrite(id, data) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await collection.updateOne({ _id: id }, { $set: { data } }, { upsert: true });
      status.lastSaveError = null;
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
async function saveUser(userId) {
  writeLocalStore();
  if (mongoReady && collection && state.users[userId]) await mongoWrite(`user:${userId}`, state.users[userId]);
}

function addCase(g, { type, userId, moderatorId, reason, extra }) {
  const record = { id: g.nextCaseId++, type, userId, moderatorId, reason: reason || 'Aucune raison fournie', extra: extra || null, createdAt: Date.now() };
  g.cases.push(record);
  if (g.cases.length > 2000) g.cases = g.cases.slice(-2000);
  return record;
}

module.exports = { initDb, peek, get, save, getStatus, addCase, defaultGuild, peekUser, getUser, saveUser, getGlobal, saveGlobal };
