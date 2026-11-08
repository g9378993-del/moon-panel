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
