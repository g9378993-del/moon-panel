# PolSec Integration Guide for moon-panel

## Overview
This guide explains how to merge PolSec commands (script management, key system, HWID, blacklist) into your existing moon-panel bot.

---

## STEP 1: Update db.js

### In `defaultGuild()` function (around line 45), expand return:

**BEFORE:**
```javascript
function defaultGuild(botJoinedAt = null) {
  return {
    botJoinedAt,
    setupDone: false,
    setupAt: null,
    config: defaultConfig(),
    allowedRoles: [],
    allowedUsers: [],
    products: {},
    keys: [],
    roleMap: {},
    blacklist: {},
    panels: [],
  };
}
```

**AFTER:**
```javascript
function defaultGuild(botJoinedAt = null) {
  return {
    botJoinedAt,
    setupDone: false,
    setupAt: null,
    config: defaultConfig(),
    allowedRoles: [],
    allowedUsers: [],
    products: {},
    keys: [],
    roleMap: {},
    blacklist: {},
    panels: [],
    // NEW: PolSec fields
    scripts: {},
    scriptRoleMap: {},
    hwidBlacklist: {},
    keyTrials: {},
  };
}
```

---

## STEP 2: Update index.js

### 2a. Add require at top (after line 6):

```javascript
const { polsecCommands, handlePolSecCommands } = require('./polsec-commands');
```

### 2b. Expand commands array (around line 344, after existing commands, before REST registration ~line 420):

Find line: `const commands = [`

At the END of the commands array (before the final `]`), add:

```javascript
  // ... existing commands ...
  
  // PolSec Commands
  ...polsecCommands,
];
```

### 2c. Add PolSec handler to handleChatCommand function (around line 900, after the last existing command handler):

Find the section around line 1095 where `cmd === 'lookupuser'` ends.

After that entire block (after the `return;`), add:

```javascript
  // -------- PolSec Commands --------
  const polsecCmds = new Set(['createscript', 'generatekey', 'bulkgen', 'deletekey', 'whitelist', 
    'resetkeyhwid', 'sethwidcooldown', 'lookupkey', 'blacklistuser', 'unblacklistuser',
    'killswitch', 'scriptreminder', 'linkscript', 'unlinkscript', 'setwebhook', 
    'setbuyerrole', 'deleteuserkeys', 'trial', 'compensate', 'deletescript']);
    
  if (polsecCmds.has(cmd)) {
    await handlePolSecCommands(interaction, guild, g);
    return;
  }
```

### 2d. Update SENSITIVE_CMDS (line 54):

**BEFORE:**
```javascript
const SENSITIVE_CMDS = new Set(['genkey', 'whitelist', 'bulkgen', 'lookupkey', 'lookupuser', 'permissions']);
```

**AFTER:**
```javascript
const SENSITIVE_CMDS = new Set(['genkey', 'whitelist', 'bulkgen', 'lookupkey', 'lookupuser', 'permissions',
  'generatekey', 'deletekey', 'resetkeyhwid', 'blacklistuser', 'unblacklistuser', 'createscript']);
```

---

## STEP 3: Verify obfuscate.js exists

The bot already has `/obfuscate.js`. This is used for script obfuscation (line 299 in index.js).
PolSec commands will reuse this when creating/updating scripts.

To add extra obfuscation layers, edit `obfuscate.js`:

```javascript
function obfuscateScript(rawContent) {
  // Variable renaming: a, b, c, x, y, z
  let obf = rawContent;
  
  // Layer 1: String encoding
  obf = obf.replace(/"([^"]*)"/g, (match, str) => {
    const hex = Buffer.from(str).toString('hex');
    return `tonumber(string.char(${[...hex].map((c,i) => i%2===0 ? '0x'+hex.substr(i,2) : null).filter(Boolean).join(',')}))`; 
  });
  
  // Layer 2: Minify
  obf = obf.replace(/\s+/g, ' ').trim();
  
  return obf;
}
```

---

## STEP 4: Add autocomplete for scripts

Update autocomplete handler (around line 1636 in index.js):

**BEFORE:**
```javascript
  if (interaction.isAutocomplete()) {
    if (!canManage(interaction, guild, g)) { await interaction.respond([]); return; }
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = Object.entries(g.products)
      .filter(([id, p]) => p.name.toLowerCase().includes(focused) || id.includes(focused))
      .slice(0, 24)
      .map(([id, p]) => ({ name: p.name, value: id }));
    if (interaction.commandName === 'killswitch') choices.unshift({ name: L('Tous les produits', 'All products'), value: 'tous' });
    await interaction.respond(choices.slice(0, 25));
    return;
  }
```

**AFTER:**
```javascript
  if (interaction.isAutocomplete()) {
    if (!canManage(interaction, guild, g)) { await interaction.respond([]); return; }
    const focused = interaction.options.getFocused().toLowerCase();
    
    // Handle script_id autocomplete (PolSec commands)
    if (interaction.options._subcommand === 'script_id' || 
        ['generatekey', 'bulkgen', 'killswitch', 'deletescript', 'linkscript', 'unlinkscript', 'trial'].includes(interaction.commandName)) {
      g.scripts = g.scripts || {};
      const scriptChoices = Object.values(g.scripts)
        .filter((s) => s.name.toLowerCase().includes(focused) || s.id.includes(focused))
        .slice(0, 24)
        .map((s) => ({ name: s.name, value: s.id }));
      await interaction.respond(scriptChoices.slice(0, 25));
      return;
    }
    
    // Original product autocomplete
    const choices = Object.entries(g.products)
      .filter(([id, p]) => p.name.toLowerCase().includes(focused) || id.includes(focused))
      .slice(0, 24)
      .map(([id, p]) => ({ name: p.name, value: id }));
    if (interaction.commandName === 'killswitch') choices.unshift({ name: L('Tous les produits', 'All products'), value: 'tous' });
    await interaction.respond(choices.slice(0, 25));
    return;
  }
```

---

## STEP 5: Security - Add webhook validation (optional, in server.js)

Add endpoint for PolSec key validation (in `server.js`):

```javascript
app.post('/verify-key/:scriptId/:key', async (req, res) => {
  const { scriptId, key } = req.params;
  const apiKey = req.headers['authorization']?.replace('Bearer ', '');
  
  // Find guild that owns this script
  const guilds = db.getAllGuilds?.() || [];
  for (const gid in guilds) {
    const g = db.peek(gid);
    if (!g || !g.scripts?.[scriptId]) continue;
    
    const script = g.scripts[scriptId];
    if (script.apiKey !== apiKey) { res.status(401).json({ valid: false, reason: 'invalid_api_key' }); return; }
    
    const record = g.keys?.find((k) => k.key === key && k.scriptId === scriptId);
    if (!record) { res.status(404).json({ valid: false, reason: 'key_not_found' }); return; }
    if (record.hwid && req.body.hwid && record.hwid !== req.body.hwid) {
      res.status(403).json({ valid: false, reason: 'hwid_mismatch' });
      return;
    }
    
    record.redeemedAt = Date.now();
    record.hwid = req.body.hwid;
    await db.save(gid);
    
    res.json({ valid: true, script: script.id });
    return;
  }
  
  res.status(404).json({ valid: false, reason: 'script_not_found' });
});
```

---

## STEP 6: Test

1. Restart bot: `node index.js`
2. Test `/createscript` → should create a new script with API key
3. Test `/generatekey` → should create single key
4. Test `/bulkgen` with count=5 → should create 5 keys
5. Test `/lookupkey` → should show key info
6. Test `/killswitch` → should disable script access

---

## File Structure After Integration

```
moon-panel/
├── index.js (modified - added PolSec handler)
├── db.js (modified - extended defaultGuild)
├── server.js (modified - added webhook validation)
├── obfuscate.js (unchanged, reused)
├── polsec-commands.js (NEW - command definitions)
├── lang.js (unchanged)
└── package.json (unchanged)
```

---

## Troubleshooting

**Commands don't appear:**
- Restart bot after changes
- Check that `polsecCommands` array is properly spread into commands array
- Verify line: `...polsecCommands,` has the spread operator `...`

**Autocomplete not working:**
- Ensure `g.scripts` is initialized: `g.scripts = g.scripts || {}`
- Check that script_id is returned as `value` in choices

**Keys not saving:**
- Verify `await db.save(gid)` is called after each modification
- Check MongoDB connection in logs

**Permission errors:**
- Ensure `canManage()` returns true
- Add user/role with `/permissions add-user` or `/permissions add-role`

---

## Summary of Changes

| File | Change | Lines |
|------|--------|-------|
| db.js | Add script fields to defaultGuild | ~4 fields |
| index.js | Import PolSec commands | +1 line |
| index.js | Add PolSec commands to array | +1 spread |
| index.js | Add PolSec handler to dispatch | +8 lines |
| index.js | Update SENSITIVE_CMDS | +6 cmd names |
| index.js | Update autocomplete logic | +6 lines |
| server.js | Add webhook validation endpoint | +25 lines (optional) |
| NEW | polsec-commands.js | ~400 lines |

**Total additions: ~450 lines, all integrated into existing architecture.**

Delivered.
