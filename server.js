// Petit serveur de vérification HWID + livraison du script hébergé.
// C'est CE fichier que ton script Lua doit appeler (via HttpGet) pour
// vérifier qu'une clé + un appareil sont valides, et récupérer le script
// obfusqué. Utilise le même stockage (db.js) que le bot Discord, donc les
// données sont toujours à jour, qu'elles viennent de MongoDB ou des
// fichiers locaux.

const express = require('express');
const https = require('https');
const db = require('./db');

const app = express();
app.use(express.json());
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render est derrière un proxy : nécessaire pour avoir la vraie IP du joueur, pas celle de Render.

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.type('text/plain').send('ok'));

// Alerte optionnelle sur un webhook Discord (variable LOG_WEBHOOK_URL) quand
// une clé est utilisée depuis un autre appareil. Une alerte max toutes les
// 10 minutes par clé, pour ne pas spammer ton salon.
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;
const lastAlert = new Map();
function alertWebhook(text) {
  const url = process.env.LOG_WEBHOOK_URL;
  if (!url) return;
  try {
    const body = JSON.stringify({ content: text.slice(0, 1900) });
    const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (r) => r.resume());
    req.on('error', () => {});
    req.end(body);
  } catch (e) { /* on ignore : l'alerte est un bonus, jamais bloquante */ }
}

// Petit rate-limit maison (pas de dépendance en plus) : par IP, sur la
// route de livraison uniquement. Ça n'empêche pas un vrai brute-force (la
// clé fait 128 bits, c'est déjà hors de portée), mais ça bloque le
// spam/scraping et les boucles de scripts mal codées qui rappellent en
// continu.
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX = 60; // 60 requêtes / IP / fenêtre (un lancement = 2 requêtes)
const hits = new Map();
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [ip, arr] of hits) {
    const kept = arr.filter((t) => t > cutoff);
    if (kept.length) hits.set(ip, kept); else hits.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => t > now - RATE_LIMIT_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (arr.length > RATE_LIMIT_MAX) {
    res.set('Retry-After', String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)));
    return res.type('text/plain').status(429).send('-- access denied: too many requests, try again later');
  }
  next();
}

// Chaque serveur Discord a ses propres produits et clés (voir db.js). Ici on
// cherche donc dans tous les serveurs : le nom de fichier hébergé et la clé
// sont uniques (aléatoires), il n'y a pas d'ambiguïté possible.
function findByFilename(filename) {
  for (const [gid, g] of Object.entries(db.all())) {
    for (const [productId, product] of Object.entries(g.products || {})) {
      if (product.hostedFilename === filename) return { gid, g, productId, product };
    }
  }
  return null;
}
function findByKey(keyValue) {
  for (const [gid, g] of Object.entries(db.all())) {
    const record = (g.keys || []).find((k) => k.key === keyValue);
    if (record) {
      const product = (g.products || {})[record.productId];
      if (product) return { gid, g, record, productId: record.productId, product };
    }
  }
  return null;
}

// Petit "démarreur" Lua : calcule le HWID côté joueur puis charge le vrai
// script. C'est ce qui permet au loader donné aux acheteurs de rester court
// (2 lignes) au lieu de contenir tout ce code.
function buildBootstrap(url) {
  return [
    'local function h()',
    '  local ok, id = pcall(function()',
    '    if gethwid then return gethwid() end',
    '    if get_hwid then return get_hwid() end',
    '    if syn and syn.crypto and syn.crypto.hwid then return syn.crypto.hwid() end',
    '    return game:GetService("RbxAnalyticsService"):GetClientId()',
    '  end)',
    '  if ok and id and tostring(id) ~= "" then return tostring(id) end',
    '  return "unknown"',
    'end',
    `loadstring(game:HttpGet("${url}" .. game:GetService("HttpService"):UrlEncode(h())))()`,
    '',
  ].join('\n');
}

// GET /l/:key  → loader court : renvoie le démarreur Lua ci-dessus.
app.get('/l/:key', rateLimit, (req, res) => {
  const keyValue = String(req.params.key || '').trim().toUpperCase();
  const found = findByKey(keyValue);
  res.set('Cache-Control', 'no-store');
  if (!found) return res.type('text/plain').send('-- access denied: invalid key');
  const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const url = `${base}/scripts/hosted/${found.product.hostedFilename}?key=${found.record.key}&hwid=`;
  res.type('text/plain').send(buildBootstrap(url));
});

// GET /scripts/hosted/:filename?key=XXXX&hwid=YYYY
// Sert le script obfusqué UNIQUEMENT si la clé est valide, non expirée,
// non killswitchée et son propriétaire n'est pas blacklist (dans le serveur
// où la clé a été émise). Sinon, refuse.
//
// Verrouillage HWID : au premier appel avec un hwid exploitable (différent
// de "unknown"/vide), on le mémorise sur la clé. Aux appels suivants, si le
// hwid reçu ne correspond pas à celui mémorisé, on refuse. `/resetkeyhwid`
// (admin) ou le bouton "Reset HWID" (self-service, avec cooldown) effacent
// ce verrou pour changer d'appareil.
app.get('/scripts/hosted/:filename', rateLimit, async (req, res) => {
  const hit = findByFilename(req.params.filename);
  if (!hit) return res.type('text/plain').send('-- not found');
  const { gid, g, productId, product } = hit;

  const keyValue = String(req.query.key || '').trim().toUpperCase();
  const record = (g.keys || []).find((k) => k.key === keyValue && k.productId === productId);
  if (!record) return res.type('text/plain').send('-- access denied: invalid key');

  if (record.userId && (g.blacklist || {})[record.userId]) return res.type('text/plain').send('-- access denied: blacklisted');

  if ((g.config || {}).killswitchGlobal || product.killswitch) return res.type('text/plain').send('-- access denied: disabled');

  if (record.expiresAt && Date.now() > record.expiresAt) return res.type('text/plain').send('-- access denied: expired');

  const incomingHwid = String(req.query.hwid || '').trim();
  const hasUsableHwid = incomingHwid && incomingHwid.toLowerCase() !== 'unknown';
  if (hasUsableHwid) {
    if (!record.hwid) {
      // Premier appel exploitable : on verrouille la clé à cet appareil.
      record.hwid = incomingHwid;
      await db.save(gid);
    } else if (record.hwid !== incomingHwid) {
      const last = lastAlert.get(record.key) || 0;
      if (Date.now() - last > ALERT_COOLDOWN_MS) {
        lastAlert.set(record.key, Date.now());
        alertWebhook(`⚠️ HWID différent pour la clé \`${record.key}\` (${product.name || productId})${record.userId ? ` — propriétaire <@${record.userId}>` : ''}. Clé peut-être partagée.`);
      }
      return res.type('text/plain').send('-- access denied: hwid mismatch (this key is locked to another device)');
    }
  }

  // Livraison réussie : on compte le lancement (visible dans /lookupkey et /stats).
  record.useCount = (record.useCount || 0) + 1;
  record.lastUsedAt = Date.now();
  try { await db.save(gid); } catch (e) { console.error('Sauvegarde du lancement impossible :', e.message); }

  res.set('Cache-Control', 'no-store');
  res.type('text/plain').send(product.script || '-- empty');
});

const PORT = process.env.PORT || 3000;
function start() {
  app.listen(PORT, () => console.log(`Serveur de vérification HWID lancé sur le port ${PORT}`));
}
// Lancé par index.js (db déjà initialisée) ou seul via "npm run verify-server".
if (require.main === module) db.initDb().then(start); else start();
