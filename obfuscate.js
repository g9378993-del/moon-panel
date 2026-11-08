'use strict';

// ═══════════════════════════════════════════════════════════════════════════
//  obfuscate.js — Moon Obf v3.0
//  Architecture complètement différente de la v1
//
//  Pipeline :
//    1. String literals  → string.char()
//    2. Integer literals → expressions math
//    3. Junk code injection
//    4. César rotatif    → chiffrement byte-par-byte clé tournante
//    5. Hex-string encode → payload = une longue string hex, pas de {1,2,3}
//    6. Chunk split      → la hex-string est découpée en N morceaux réassemblés
//    7. Decoy header     → faux code Lua en tête pour perdre le reverser
//
//  Compatible Lua 5.1 / 5.2 / 5.3 / 5.4
// ═══════════════════════════════════════════════════════════════════════════

function rng(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function uid() {
  const h = '0123456789abcdef';
  let s = '_';
  for (let i = 0; i < 12; i++) s += h[rng(0, 15)];
  return s;
}

// ── 1. String literals → string.char() ────────────────────────────────────
function obfuscateStrings(src) {
  return src.replace(
    /(["'])((?:(?!\2)[^\\\n]|\\.)*)(\2)/g,
    (_m, _q, inner) => {
      const unescaped = inner
        .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
        .replace(/\\\\/g, '\x01').replace(/\\"/g, '"').replace(/\\'/g, "'")
        .replace(/\x01/g, '\\');
      const bytes = Buffer.from(unescaped, 'utf8');
      if (bytes.length === 0 || bytes.length > 60) return _m;
      return `(string.char(${[...bytes].join(',')}))`;
    }
  );
}

// ── 2. Integer literals → expressions math ────────────────────────────────
function obfuscateNumbers(src) {
  return src.replace(/\b(\d+)\b/g, (_m, raw) => {
    const n = parseInt(raw, 10);
    if (n > 65535 || isNaN(n)) return _m;
    if (n === 0) return '(1-1)';
    if (n === 1) return '(2-1)';
    const a = rng(50, 999);
    const forms = [
      `(${n + a}-${a})`,
      `math.floor(${n * 2}/2)`,
      `(${a + n}-${a})`,
      `math.floor(${n * 3}/3)`,
    ];
    return forms[rng(0, 3)];
  });
}

// ── 3. Junk code injection ─────────────────────────────────────────────────
function injectJunk(src) {
  const junk = [
    () => `local ${uid()}=type(nil)`,
    () => `local ${uid()}=math.floor((1-1))`,
    () => `if false then local ${uid()}=(1-1) end`,
    () => `do local ${uid()}={} end`,
    () => `local ${uid()}=select(("#"))`,
    () => `local ${uid()}=tostring(math.floor((1-1)))`,
    () => `local ${uid()}=pcall(function()return math.floor(${rng(1,999)*2}/2) end)`,
  ];
  return src.split('\n').flatMap(line => {
    const t = line.trim();
    const skip = t === '' || t.startsWith('--') ||
                 t.startsWith('end') || t.startsWith('else') || t.startsWith('until');
    const result = [line];
    if (!skip && Math.random() < 0.35)
      result.push(junk[rng(0, junk.length - 1)]());
    return result;
  }).join('\n');
}

// ── 4. César rotatif ───────────────────────────────────────────────────────
//  encode: (b + (key + i) % 256) % 256
//  decode en Lua: (enc - shift + 256) % 256
function caesarEncode(source) {
  const key   = rng(15, 220);
  const bytes = [...Buffer.from(String(source), 'utf8')];
  const enc   = bytes.map((b, i) => (b + (key + i) % 256) % 256);

  const kv = uid(), ev = uid(), sv = uid(), iv = uid(), shv = uid(), dv = uid();
  return [
    `local ${kv}=${key}`,
    `local ${ev}={${enc.join(',')}}`,
    `local ${sv}={}`,
    `for ${iv}=1,#${ev} do`,
    `local ${shv}=(${kv}+(${iv}-1))%256`,
    `local ${dv}=(${ev}[${iv}]-${shv}+256)%256`,
    `${sv}[${iv}]=string.char(${dv})`,
    `end`,
    `(loadstring or load)(table.concat(${sv}))()`,
  ].join('\n');
}

// ── 5+6. Hex-string encode + chunk split ──────────────────────────────────
//  Au lieu de {104,101,...} on génère "68656c6c6f..."
//  Découpé en N chunks réassemblés dynamiquement
//  Visuellement rien à voir avec un byte array classique
function hexChunkWrap(source) {
  const bytes  = [...Buffer.from(String(source), 'utf8')];
  const hexStr = bytes.map(b => b.toString(16).padStart(2, '0')).join('');

  // Découpe en chunks de taille variable
  const chunkSize = rng(60, 120);
  const chunks = [];
  for (let i = 0; i < hexStr.length; i += chunkSize)
    chunks.push(hexStr.slice(i, i + chunkSize));

  const chunkVars = chunks.map(() => uid());
  const joinVar   = uid();
  const idxVar    = uid();
  const decVar    = uid();
  const bufVar    = uid();

  const chunkLines = chunkVars
    .map((v, i) => `local ${v}="${chunks[i]}"`)
    .join('\n');

  const concatExpr = chunkVars.join('..');

  return [
    chunkLines,
    `local ${joinVar}=${concatExpr}`,
    `local ${bufVar}={}`,
    `for ${idxVar}=1,#${joinVar},2 do`,
    `local ${decVar}=tonumber(${joinVar}:sub(${idxVar},${idxVar}+1),16)`,
    `${bufVar}[#${bufVar}+1]=string.char(${decVar})`,
    `end`,
    `(loadstring or load)(table.concat(${bufVar}))()`,
  ].join('\n');
}

// ── 7. Decoy header ────────────────────────────────────────────────────────
//  Faux code Lua en tête : variable names légitimes, logique inaccessible
//  Distrait un reverser manuel
function decoyHeader() {
  const names = ['config','settings','version','build','init','core','base','env'];
  const lines = [];
  const count = rng(4, 8);
  for (let i = 0; i < count; i++) {
    const v = `${names[rng(0, names.length-1)]}_${uid()}`;
    const forms = [
      `local ${v}={}`,
      `local ${v}=false`,
      `local ${v}=nil`,
      `local ${v}=(function()end)`,
      `local ${v}=math.floor((1-1))`,
    ];
    lines.push(forms[rng(0, forms.length-1)]);
  }
  return lines.join('\n');
}

// ── Pipeline principal ─────────────────────────────────────────────────────
function obfuscateScript(rawSource) {
  let src = String(rawSource);

  // Source-level transforms
  src = obfuscateStrings(src);
  src = obfuscateNumbers(src);
  src = injectJunk(src);

  // Couche de chiffrement
  src = caesarEncode(src);

  // Couche hex+chunks (remplace le byte-array classique)
  src = hexChunkWrap(src);

  // Decoy en tête
  const decoy = decoyHeader();

  return `-- Moon Obf v3 | Protected\n${decoy}\n${src}`;
}

module.exports = { obfuscateScript };
