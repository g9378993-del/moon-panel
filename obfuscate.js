// Obfuscation "safe" : encode le script octet par octet et l'enveloppe
// dans un petit loader qui le reconstruit et l'exécute au runtime.
// Ça rend le code illisible à l'oeil nu SANS toucher à sa structure
// (donc ça ne peut pas casser le script, contrairement à un renommage de
// variables à l'aveugle). Ce n'est pas une protection inviolable contre
// un désobfuscateur déterminé — pour ça il faudrait un vrai parseur Lua.

function obfuscateScript(rawSource) {
  const bytes = Buffer.from(String(rawSource), 'utf8');
  const byteArray = Array.from(bytes).join(',');
  const watermark = '-- Obfuscated by Moon Obf\n';
  const loader = [
    watermark,
    `local _mo_b={${byteArray}}`,
    'local _mo_s={}',
    'for _mo_i=1,#_mo_b do _mo_s[_mo_i]=string.char(_mo_b[_mo_i]) end',
    'loadstring(table.concat(_mo_s))()',
    '',
  ].join('\n');
  return loader;
}

module.exports = { obfuscateScript };
