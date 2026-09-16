// Petit serveur de vérification HWID.
// C'est CE fichier que ton script Lua doit appeler (via HttpGet/HttpPost
// selon ton executor) pour vérifier qu'une clé + un appareil sont valides.
//
// ⚠️ Pour que ça fonctionne depuis Roblox, ce serveur doit être accessible
// depuis Internet avec une URL publique stable. Sur un téléphone (Termux),
// ce n'est pas fiable (pas d'IP publique fixe, coupures). Héberge-le plutôt
// sur Render.com ou Railway.app (gratuit pour commencer) — dis-moi si tu
// veux le guide pour ça.

const express = require('express');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const KEYS_PATH = path.join(DATA_DIR, 'keys.json');
const PRODUCTS_PATH = path.join(DATA_DIR, 'products.json');
const BLACKLIST_PATH = path.join(DATA_DIR, 'blacklist.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8') || JSON.stringify(fallback)); }
  catch (e) { return fallback; }
}
function saveJson(p, data) { fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

// Sert le script obfusqué : c'est CETTE url que le loader court livré à
// l'acheteur va appeler via game:HttpGet(...). Le nom de fichier est un
// hash aléatoire non-devinable généré à la création du produit.
app.get('/scripts/hosted/:filename', (req, res) => {
  const products = loadJson(PRODUCTS_PATH, {});
  const product = Object.values(products).find((p) => p.hostedFilename === req.params.filename);
  if (!product) return res.status(404).send('-- not found');
  res.type('text/plain').send(product.script || '-- empty');
});

// POST /verify  body: { "key": "XXXX-XXXX-XXXX-XXXX", "hwid": "identifiant-machine" }
app.post('/verify', (req, res) => {
  const { key, hwid } = req.body || {};
  if (!key || !hwid) return res.status(400).json({ valid: false, reason: 'missing_params' });

  const keys = loadJson(KEYS_PATH, []);
  const record = keys.find((k) => k.key === String(key).trim().toUpperCase());
  if (!record) return res.json({ valid: false, reason: 'invalid_key' });
  if (!record.userId) return res.json({ valid: false, reason: 'not_claimed' }); // pas encore réclamée sur Discord

  const blacklist = loadJson(BLACKLIST_PATH, {});
  if (blacklist[record.userId]) return res.json({ valid: false, reason: 'blacklisted' });

  const config = loadJson(CONFIG_PATH, { killswitchGlobal: false });
  const products = loadJson(PRODUCTS_PATH, {});
  const product = products[record.productId];
  if (config.killswitchGlobal || product?.killswitch) return res.json({ valid: false, reason: 'killswitch' });

  if (record.expiresAt && Date.now() > record.expiresAt) return res.json({ valid: false, reason: 'expired' });

  if (!record.hwid) {
    // premier lancement : on lie la clé à cet appareil
    record.hwid = hwid;
    saveJson(KEYS_PATH, keys);
    return res.json({ valid: true, firstBind: true });
  }

  if (record.hwid !== hwid) {
    return res.json({ valid: false, reason: 'hwid_mismatch' });
  }

  return res.json({ valid: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur de vérification HWID lancé sur le port ${PORT}`));
