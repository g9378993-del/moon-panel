// Petite couche de stockage : garde tout en mémoire pour des lectures
// instantanées, écrit en local (data/*.json) ET sur MongoDB si
// MONGODB_URI est configuré. Sans Mongo, tout marche comme avant mais ne
// survit pas à un redéploiement Render (pas de disque persistant sur le
// plan gratuit). Avec Mongo, tout survit.

const fs = require('fs');
const path = require('path');
let MongoClient;
try { MongoClient = require('mongodb').MongoClient; } catch (e) { MongoClient = null; }

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const NAMESPACES = {
  keys: { file: 'keys.json', fallback: [] },
  products: { file: 'products.json', fallback: {} },
  roleMap: { file: 'roleMap.json', fallback: {} },
  blacklist: { file: 'blacklist.json', fallback: {} },
  config: { file: 'config.json', fallback: {} },
  panels: { file: 'panels.json', fallback: [] },
};

const cache = {};
let collection = null;
let mongoReady = false;

function loadLocalFile(name) {
  const { file, fallback } = NAMESPACES[name];
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8') || JSON.stringify(fallback)); }
  catch (e) { return fallback; }
}
function saveLocalFile(name, value) {
  fs.writeFileSync(path.join(DATA_DIR, NAMESPACES[name].file), JSON.stringify(value, null, 2));
}

async function initDb() {
  for (const name of Object.keys(NAMESPACES)) cache[name] = loadLocalFile(name);

  const uri = process.env.MONGODB_URI;
  if (!uri || !MongoClient) {
    console.log('MongoDB non configuré : stockage local uniquement (non persistant entre déploiements Render).');
    return;
  }
  try {
    const client = new MongoClient(uri);
    await client.connect();
    collection = client.db('panelbot').collection('store');
    for (const name of Object.keys(NAMESPACES)) {
      const doc = await collection.findOne({ _id: name });
      if (doc) cache[name] = doc.data;
      else await collection.insertOne({ _id: name, data: cache[name] });
    }
    mongoReady = true;
    console.log('MongoDB connecté — données persistantes activées.');
  } catch (e) {
    console.error('Connexion MongoDB échouée, on reste sur les fichiers locaux :', e.message);
  }
}

function get(name) { return cache[name]; }

async function set(name, value) {
  cache[name] = value;
  saveLocalFile(name, value);
  if (mongoReady && collection) {
    try {
      await collection.updateOne({ _id: name }, { $set: { data: value } }, { upsert: true });
    } catch (e) {
      console.error('Erreur écriture MongoDB :', e.message);
    }
  }
}

module.exports = { initDb, get, set };
