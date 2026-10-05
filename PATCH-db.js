// ================================================================
// PATCH FOR db.js - POLSEC SCHEMA DEFAULTS
// ================================================================
//
// INSTRUCTIONS:
// 1. Open your db.js
// 2. Find the defaultGuild() function (should be around line 25-50)
// 3. Find the return statement that has { products, keys, roleMap, ... }
// 4. Add these fields to that return object
//
// ================================================================

// ====== ADD THESE FIELDS TO defaultGuild() return object ======
//
// Current structure:
/*
  return {
    products: {},
    keys: {},
    roleMap: {},
    // ... etc ...
  };
*/

// Add these new fields BEFORE the closing }:

    // PolSec integration fields
    scripts: {},              // scriptId: { id, name, apiKey, publicKey, createdAt, webhook, buyerRole, killswitch, trialEnabled, trialHours }
    scriptRoleMap: {},        // scriptId -> roleId (link to buyer role)
    hwidBlacklist: {},        // hwid -> { reason, at } (global HWID blacklist)
    keyTrials: {},            // key -> { scriptId, trialEndsAt } (track active trials)

// ================================================================
// COMPLETE DEFAULTGUILD() EXAMPLE (if you want to see full structure):
// ================================================================
/*
function defaultGuild() {
  return {
    products: {},
    keys: {},
    roleMap: {},
    blacklist: [],
    config: { lang: 'en', prefix: '/', disableCommands: [] },
    panels: {},
    allowedRoles: [],
    allowedUsers: [],
    // PolSec integration fields
    scripts: {},
    scriptRoleMap: {},
    hwidBlacklist: {},
    keyTrials: {},
  };
}
*/

// ================================================================
// That's it. No other changes needed to db.js
// ================================================================
