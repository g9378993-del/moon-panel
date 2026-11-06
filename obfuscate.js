'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  obfuscate.js — Moon Obf v2.0
//  Multi-Layer Lua Obfuscator | Hardened Edition
//
//  Pipeline (innermost → outermost) :
//    1. String literals  → string.char() byte reconstruction
//    2. Integer literals → disguised math expressions
//    3. Junk code        → dead-code injection entre les vraies lignes
//    4. César rotatif    → chiffrement byte-par-byte avec clé tournante
//    5. Byte-wrap outer  → second loader plain autour du loader césar
//
//  Compatible Lua 5.1 / 5.2 / 5.3 / 5.4 (utilise loadstring or load,
//  math.floor au lieu de //, pas d'opérateur ~ bitwise)
// ═══════════════════════════════════════════════════════════════════════════

/** Entier aléatoire [min, max] */
function rng(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Identifiant hex pseudo-aléatoire pour les variables Lua générées */
function uid() {
  const h = '0123456789abcdef';
  let s = '_';
  for (let i = 0; i < 14; i++) s += h[rng(0, 15)];
  return s;
}

// ── Couche 1 : String literals → string.char() ────────────────────────────
//  "hello" → (string.char(104,101,108,108,111))
//  Skips strings vides ou > 60 octets (trop verbeux)
//  Ne touche pas aux multi-line strings Lua [[...]]
function obfuscateStrings(src) {
  return src.replace(
    /(["'])((?:(?!\2)[^\\\n]|\\.)*)(\2)/g,
    (_match, _q, inner, _q2) => {
      // Résoudre les escape sequences basiques
      const unescaped = inner
        .replace(/\\n/g,  '\n')
        .replace(/\\t/g,  '\t')
        .replace(/\\r/g,  '\r')
        .replace(/\\\\/g, '§BSLASH§')
        .replace(/\\"/g,  '"')
        .replace(/\\'/g,  "'")
        .replace(/§BSLASH§/g, '\\');

      const bytes = Buffer.from(unescaped, 'utf8');
      if (bytes.length === 0 || bytes.length > 60) return _match;
      return `(string.char(${[...bytes].join(',')}))`;
    }
  );
}

// ── Couche 2 : Integer literals → expressions math déguisées ──────────────
//  42 → (142-100) ou math.floor(84/2) ou (1042-1000)
function obfuscateNumbers(src) {
  return src.replace(/\b(\d+)\b/g, (_match, raw) => {
    const n = parseInt(raw, 10);
    // Skip les grands nombres et les flottants (déjà des entiers Lua max)
    if (n > 65535 || isNaN(n)) return _match;
    if (n === 0) return '(1-1)';
    if (n === 1) return '(2-1)';

    const a = rng(50, 1000);
    const forms = [
      `(${n + a}-${a})`,
      `math.floor(${n * 2}/2)`,
      `math.floor(${n * 3}/3)`,
      `(${a + n}-${a})`,
    ];
    return forms[rng(0, forms.length - 1)];
  });
}

// ── Couche 3 : Junk code injection ────────────────────────────────────────
//  Insère du code mort entre ~35% des lignes non-vides
function injectJunk(src) {
  const junk = [
    () => `local ${uid()}=type(nil)`,
    () => `local ${uid()}=math.floor((1-1))`,
    () => `if false then local ${uid()}=0 end`,
    () => `do local ${uid()}={} end`,
    () => `local ${uid()}=select(("#"))`,
    () => `local ${uid()}=tostring(${rng(0, 9999)}-${rng(0, 9999)})`,
    () => `local ${uid()}=pcall(function()return ${rng(1, 999)} end)`,
    () => `local ${uid()}=math.floor(math.random()*(1-1))`,
  ];

  return src
    .split('\n')
    .flatMap(line => {
      const trimmed = line.trim();
      const result = [line];
      const skip =
        trimmed === '' ||
        trimmed.startsWith('--') ||
        trimmed.startsWith('end') ||
        trimmed.startsWith('else') ||
        trimmed.startsWith('until');

      if (!skip && Math.random() < 0.35) {
        result.push(junk[rng(0, junk.length - 1)]());
      }
      return result;
    })
    .join('\n');
}

// ── Couche 4 : César rotatif (encryption byte-par-byte) ───────────────────
//  shift[i] = (key + i) % 256   →  encode = (b + shift) % 256
//  Décodeur Lua embarqué : decode = (enc - shift + 256) % 256
//  Fonctionne sur toutes les versions Lua (pas de bit.bxor requis)
function caesarEncode(source) {
  const key  = rng(15, 220);
  const bytes = [...Buffer.from(String(source), 'utf8')];

  // shift_i = (key + i) % 256   (i = 0-based JS index)
  const encoded = bytes.map((b, i) => (b + (key + i) % 256) % 256);

  const kv  = uid();   // variable clé
  const ev  = uid();   // array encodé
  const sv  = uid();   // string result buffer
  const iv  = uid();   // loop index
  const shv = uid();   // shift courant
  const dv  = uid();   // byte décodé

  return [
    `local ${kv}=${key}`,
    `local ${ev}={${encoded.join(',')}}`,
    `local ${sv}={}`,
    `for ${iv}=1,#${ev} do`,
    `local ${shv}=(${kv}+(${iv}-1))%256`,
    `local ${dv}=(${ev}[${iv}]-${shv}+256)%256`,
    `${sv}[${iv}]=string.char(${dv})`,
    `end`,
    `(loadstring or load)(table.concat(${sv}))()`,
  ].join('\n');
}

// ── Couche 5 : Byte-wrap outer ────────────────────────────────────────────
//  Emballe le loader césar dans un second loader plain-byte
//  → deux niveaux de loadstring imbriqués dans l'output final
function byteWrap(source) {
  const bytes = [...Buffer.from(String(source), 'utf8')];

  const bv = uid();
  const sv = uid();
  const iv = uid();

  return [
    `local ${bv}={${bytes.join(',')}}`,
    `local ${sv}={}`,
    `for ${iv}=1,#${bv} do ${sv}[${iv}]=string.char(${bv}[${iv}]) end`,
    `(loadstring or load)(table.concat(${sv}))()`,
  ].join('\n');
}

// ── Pipeline principal ─────────────────────────────────────────────────────
//  Entrée  : source Lua en clair (string)
//  Sortie  : Lua obfusqué 3 couches (string)
function obfuscateScript(rawSource) {
  let src = String(rawSource);

  // Transforms au niveau source (avant encoding)
  src = obfuscateStrings(src);   // strings → string.char()
  src = obfuscateNumbers(src);   // entiers → expressions math
  src = injectJunk(src);         // injection dead code

  // Encoding layers (innermost → outermost)
  src = caesarEncode(src);       // Layer A : chiffrement rotatif
  src = byteWrap(src);           // Layer B : enveloppe byte-array

  return `-- Moon Obf v2 | Protected\n` + src;
}

module.exports = { obfuscateScript };
