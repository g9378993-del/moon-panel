// ================================================================
// PATCH FOR index.js - POLSEC COMMANDS INTEGRATION
// ================================================================
// 
// INSTRUCTIONS:
// 1. Open your index.js
// 2. Find each section marker below (e.g., "// AFTER LINE 6:")
// 3. Copy the code and paste it into the specified location
// 4. Save and restart bot
//
// ================================================================

// ====== AFTER LINE 6 (after const { obfuscateScript } = require('./obfuscate');) ======
const { buildPolsecCommands, handlePolSecCommand } = require('./polsec-commands-full');

// ====== REPLACE LINE 54 (SENSITIVE_CMDS set) ======
// OLD:
// const SENSITIVE_CMDS = new Set(['genkey', 'whitelist', 'bulkgen', 'lookupkey', 'lookupuser', 'permissions']);

// NEW:
const SENSITIVE_CMDS = new Set([
  'genkey', 'whitelist', 'bulkgen', 'lookupkey', 'lookupuser', 'permissions',
  'createscript', 'generatekey', 'deletekey', 'resetkeyhwid', 'blacklistuser',
  'unblacklistuser', 'blacklisthwid', 'unblacklisthwid'
]);

// ====== AFTER LINE 418 (end of commands array, BEFORE the REST registration) ======
// Find this section:
/*
  new SlashCommandBuilder().setName('stats').setDescription('...')
  // ... last command builder ...
];  // <--- THIS LINE

// Make the commands array look like this:
*/

const commands = [
  // ... all existing commands from lines 344-420 stay EXACTLY as they are ...
  
  // Just add this ONE line before the closing ]:
  ...buildPolsecCommands(),
];

// ====== AFTER LINE 900 (after the 'help' command handler block) ======
// Find this (around line 903):
/*
  if (cmd === 'help') {
    const embed = new EmbedBuilder()...
    // ... entire help handler ...
    return;
  }
*/

// Add this AFTER the help block closes:

  // -------- PolSec Commands Router --------
  const polsecCmdNames = new Set([
    'createscript', 'generatekey', 'bulkgen', 'deletekey', 'whitelist',
    'lookupkey', 'lookupuser', 'deleteuserkeys', 'resetkeyhwid',
    'sethwidcooldown', 'blacklistuser', 'unblacklistuser', 'blacklisthwid',
    'unblacklisthwid', 'killswitch', 'trial', 'compensate', 'scriptreminder',
    'deletescript', 'linkscript', 'unlinkscript', 'setwebhook', 'setbuyerrole',
    'exportkeys'
  ]);

  if (polsecCmdNames.has(cmd)) {
    await handlePolSecCommand(interaction, guild, g, { db, APP_CONFIG, generateKeyString, t, mk, fmtDate, SENSITIVE_CMDS, canManage });
    return;
  }

// ====== AFTER LINE 1636 (in isAutocomplete block) ======
// Find this section:
/*
  if (interaction.isAutocomplete()) {
    if (!canManage(interaction, guild, g)) { await interaction.respond([]); return; }
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = Object.entries(g.products)...
*/

// REPLACE the entire autocomplete block with:

  if (interaction.isAutocomplete()) {
    if (!canManage(interaction, guild, g)) { await interaction.respond([]); return; }
    const focused = interaction.options.getFocused().toLowerCase();

    // PolSec: script_id autocomplete
    const polsecScriptCmds = new Set([
      'generatekey', 'bulkgen', 'killswitch', 'deletescript', 'linkscript',
      'unlinkscript', 'setwebhook', 'setbuyerrole', 'trial', 'compensate'
    ]);

    if (polsecScriptCmds.has(interaction.commandName)) {
      g.scripts = g.scripts || {};
      const scriptChoices = Object.values(g.scripts)
        .filter((s) => s.name.toLowerCase().includes(focused) || s.id.includes(focused))
        .slice(0, 24)
        .map((s) => ({ name: `${s.name} (${s.id})`, value: s.id }));
      await interaction.respond(scriptChoices.slice(0, 25));
      return;
    }

    // Original: product autocomplete
    const choices = Object.entries(g.products)
      .filter(([id, p]) => p.name.toLowerCase().includes(focused) || id.includes(focused))
      .slice(0, 24)
      .map(([id, p]) => ({ name: p.name, value: id }));
    if (interaction.commandName === 'killswitch') choices.unshift({ name: L('Tous les produits', 'All products'), value: 'tous' });
    await interaction.respond(choices.slice(0, 25));
    return;
  }

// ================================================================
// THAT'S IT! No other changes needed to index.js
// ================================================================
// 
// Summary of changes:
// - 1 require() added (line 6)
// - 1 SENSITIVE_CMDS line replaced (line 54)
// - 1 spread operator added to commands array (line 420)
// - 1 PolSec router block added (after line 900)
// - 1 autocomplete block replaced (line 1636)
//
// Total: ~5 integration points, all non-breaking
// ================================================================
