/**
 * POLSEC COMMANDS - FULL IMPLEMENTATION
 * Script Management, Key System, HWID, Whitelist, Security
 * 
 * This file contains:
 * 1. SlashCommandBuilder definitions
 * 2. Complete handler functions
 * 3. Database structure extensions
 * 
 * Integration: Splice into index.js handleChatCommand dispatch
 */

const {
  EmbedBuilder, SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder
} = require('discord.js');
const crypto = require('crypto');

// ================================================================
// POLSEC SLASH COMMANDS (add to commands array in index.js)
// ================================================================

function buildPolsecCommands() {
  return [
    // === SETUP & CONFIG ===
    new SlashCommandBuilder()
      .setName('createscript')
      .setDescription('(Admin) Create new script project — returns API and public keys'),

    new SlashCommandBuilder()
      .setName('linkscript')
      .setDescription('(Admin) Link script to server and role')
      .addStringOption((o) => o.setName('script_id').setDescription('Script ID').setRequired(true).setAutocomplete(true))
      .addRoleOption((o) => o.setName('role').setDescription('Role to link').setRequired(true)),

    new SlashCommandBuilder()
      .setName('unlinkscript')
      .setDescription('(Admin) Unlink script from server')
      .addStringOption((o) => o.setName('script_id').setDescription('Script ID').setRequired(true).setAutocomplete(true)),

    new SlashCommandBuilder()
      .setName('setwebhook')
      .setDescription('(Admin) Update webhook URL for script')
      .addStringOption((o) => o.setName('script_id').setDescription('Script ID').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('webhook_url').setDescription('Webhook URL').setRequired(true)),

    new SlashCommandBuilder()
      .setName('setbuyerrole')
      .setDescription('(Admin) Set role for key buyers')
      .addStringOption((o) => o.setName('script_id').setDescription('Script ID').setRequired(true).setAutocomplete(true))
      .addRoleOption((o) => o.setName('role').setDescription('Buyer role').setRequired(true)),

    // === KEY MANAGEMENT ===
    new SlashCommandBuilder()
      .setName('generatekey')
      .setDescription('(Admin) Generate single key')
      .addStringOption((o) => o.setName('script_id').setDescription('Script ID').setRequired(true).setAutocomplete(true)),

    new SlashCommandBuilder()
      .setName('bulkgen')
      .setDescription('(Admin) Bulk generate keys')
      .addStringOption((o) => o.setName('script_id').setDescription('Script ID').setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('count').setDescription('Number of keys (1-100)').setRequired(true)),

    new SlashCommandBuilder()
      .setName('deletekey')
      .setDescription('(Admin) Delete key')
      .addStringOption((o) => o.setName('key').setDescription('Key to delete').setRequired(true)),

    new SlashCommandBuilder()
      .setName('whitelist')
      .setDescription('(Admin) Whitelist user (auto-generates key)')
      .addUserOption((o) => o.setName('user').setDescription('User to whitelist').setRequired(true))
      .addStringOption((o) => o.setName('script_id').setDescription('Script ID').setRequired(true).setAutocomplete(true)),

    new SlashCommandBuilder()
      .setName('lookupkey')
      .setDescription('(Admin) Get key details')
      .addStringOption((o) => o.setName('key').setDescription('Key to lookup').setRequired(true)),

    new SlashCommandBuilder()
      .setName('lookupuser')
      .setDescription('(Admin) Get all user keys')
      .addUserOption((o) => o.setName('user').setDescription('User to lookup').setRequired(true)),

    new SlashCommandBuilder()
      .setName('deleteuserkeys')
      .setDescription('(Admin) Delete all keys for user')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),

    // === SECURITY & HWID ===
    new SlashCommandBuilder()
      .setName('resetkeyhwid')
      .setDescription('(Admin) Reset HWID on key')
      .addStringOption((o) => o.setName('key').setDescription('Key').setRequired(true)),

    new SlashCommandBuilder()
      .setName('sethwidcooldown')
      .setDescription('(Admin) Set HWID reset cooldown hours')
      .addIntegerOption((o) => o.setName('hours').setDescription('Hours (0=disabled)').setRequired(true)),

    new SlashCommandBuilder()
      .setName('blacklistuser')
      .setDescription('(Admin) Blacklist user')
      .addUserOption((o) => o.setName('user').setDescription('User to blacklist').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
      .setName('unblacklistuser')
      .setDescription('(Admin) Unblacklist user')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),

    new SlashCommandBuilder()
      .setName('blacklisthwid')
      .setDescription('(Admin) Blacklist HWID')
      .addStringOption((o) => o.setName('hwid').setDescription('HWID').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false)),

    new SlashCommandBuilder()
      .setName('unblacklisthwid')
      .setDescription('(Admin) Unblacklist HWID')
      .addStringOption((o) => o.setName('hwid').setDescription('HWID').setRequired(true)),

    // === SCRIPT CONTROL ===
    new SlashCommandBuilder()
      .setName('killswitch')
      .setDescription('(Admin) Disable/enable script')
      .addStringOption((o) => o.setName('script_id').setDescription('Script ID').setRequired(true).setAutocomplete(true))
      .addBooleanOption((o) => o.setName('disable').setDescription('true=disable, false=enable').setRequired(true)),

    new SlashCommandBuilder()
      .setName('trial')
      .setDescription('(Admin) Enable/disable trial mode')
      .addStringOption((o) => o.setName('script_id').setDescription('Script ID').setRequired(true).setAutocomplete(true))
      .addBooleanOption((o) => o.setName('enable').setDescription('Enable/disable').setRequired(true))
      .addIntegerOption((o) => o.setName('duration_hours').setDescription('Trial duration hours').setRequired(false)),

    new SlashCommandBuilder()
      .setName('compensate')
      .setDescription('(Admin) Add time to key')
      .addStringOption((o) => o.setName('key').setDescription('Key').setRequired(true))
      .addIntegerOption((o) => o.setName('hours').setDescription('Hours to add').setRequired(true)),

    new SlashCommandBuilder()
      .setName('scriptreminder')
      .setDescription('(Admin) List all scripts'),

    new SlashCommandBuilder()
      .setName('deletescript')
      .setDescription('(Admin) Delete script project')
      .addStringOption((o) => o.setName('script_id').setDescription('Script ID').setRequired(true).setAutocomplete(true)),

    new SlashCommandBuilder()
      .setName('exportkeys')
      .setDescription('(Admin) Export keys as CSV')
      .addStringOption((o) => o.setName('script_id').setDescription('Script ID (optional)').setRequired(false).setAutocomplete(true)),
  ];
}

// ================================================================
// HANDLER FUNCTION (add to handleChatCommand in index.js)
// ================================================================

async function handlePolSecCommand(interaction, guild, g, {
  db, APP_CONFIG, generateKeyString, t, mk, fmtDate, SENSITIVE_CMDS, canManage
}) {
  const cmd = interaction.commandName;
  const lang = g.config.language;
  const L = mk(lang);
  const gid = guild.id;
  const uid = interaction.user.id;

  const reply = async (content) => {
    try {
      if (interaction.replied) return await interaction.followUp({ content, ephemeral: SENSITIVE_CMDS.has(cmd) });
      return await interaction.editReply({ content });
    } catch (e) {
      console.error(`Error replying to ${cmd}:`, e.message);
      return null;
    }
  };

  const replyEmbed = async (embed) => {
    try {
      if (interaction.replied) return await interaction.followUp({ embeds: [embed], ephemeral: SENSITIVE_CMDS.has(cmd) });
      return await interaction.editReply({ embeds: [embed] });
    } catch (e) {
      console.error(`Error replying embed to ${cmd}:`, e.message);
      return null;
    }
  };

  // Defer with ephemeral for sensitive commands only
  if (!interaction.deferred) {
    await interaction.deferReply({ ephemeral: SENSITIVE_CMDS.has(cmd) });
  }

  try {
    // Initialize fields
    g.scripts = g.scripts || {};
    g.scriptRoleMap = g.scriptRoleMap || {};
    g.hwidBlacklist = g.hwidBlacklist || {};
    g.keys = g.keys || [];
    g.blacklist = g.blacklist || {};

    // ====== createscript ======
    if (cmd === 'createscript') {
      const apiKey = crypto.randomBytes(32).toString('hex');
      const publicKey = crypto.randomBytes(16).toString('hex');
      const scriptId = `scr-${crypto.randomBytes(6).toString('hex')}`;

      g.scripts[scriptId] = {
        id: scriptId,
        name: `Script ${Date.now()}`,
        apiKey,
        publicKey,
        createdAt: Date.now(),
        webhook: null,
        buyerRole: null,
        killswitch: false,
        trialEnabled: false,
        trialHours: 24,
      };
      await db.save(gid);

      const embed = new EmbedBuilder()
        .setColor(APP_CONFIG.EMBED_COLOR)
        .setTitle('✅ Script Created')
        .setDescription(`**ID:** \`${scriptId}\`\n**API Key:** \`${apiKey}\`\n**Public Key:** \`${publicKey}\``)
        .setFooter({ text: 'Save these keys securely' });

      await replyEmbed(embed);
      return;
    }

    // ====== generatekey ======
    if (cmd === 'generatekey') {
      const scriptId = interaction.options.getString('script_id');
      if (!g.scripts[scriptId]) { await reply('❌ Script not found.'); return; }

      const key = generateKeyString();
      g.keys.push({
        key, scriptId, userId: null, hwid: null, hwidResetAt: null,
        createdAt: Date.now(), claimedAt: null, expiresAt: null,
        redeemedAt: null, useCount: 0, lastUsedAt: null
      });
      await db.save(gid);

      await reply(`✅ Key generated:\n\`${key}\``);
      return;
    }

    // ====== bulkgen ======
    if (cmd === 'bulkgen') {
      const scriptId = interaction.options.getString('script_id');
      const count = interaction.options.getInteger('count');

      if (!g.scripts[scriptId]) { await reply('❌ Script not found.'); return; }
      if (count < 1 || count > 100) { await reply('❌ Count must be 1-100.'); return; }

      const keys = [];
      for (let i = 0; i < count; i++) {
        const key = generateKeyString();
        g.keys.push({
          key, scriptId, userId: null, hwid: null, hwidResetAt: null,
          createdAt: Date.now(), claimedAt: null, expiresAt: null,
          redeemedAt: null, useCount: 0, lastUsedAt: null
        });
        keys.push(key);
      }
      await db.save(gid);

      await reply(`✅ Generated ${count} keys:\n\`\`\`${keys.join('\n')}\`\`\``);
      return;
    }

    // ====== deletekey ======
    if (cmd === 'deletekey') {
      const keyVal = interaction.options.getString('key').trim().toUpperCase();
      const idx = g.keys.findIndex((k) => k.key === keyVal);
      if (idx === -1) { await reply('❌ Key not found.'); return; }

      g.keys.splice(idx, 1);
      await db.save(gid);
      await reply('✅ Key deleted.');
      return;
    }

    // ====== whitelist ======
    if (cmd === 'whitelist') {
      const target = interaction.options.getUser('user');
      const scriptId = interaction.options.getString('script_id');

      if (!g.scripts[scriptId]) { await reply('❌ Script not found.'); return; }
      if (g.blacklist[target.id]) { await reply(`❌ <@${target.id}> is blacklisted.`); return; }

      const roleId = g.scriptRoleMap[scriptId];
      if (roleId) {
        try {
          const member = await guild.members.fetch(target.id);
          if (!member.roles.cache.has(roleId)) {
            await member.roles.add(roleId);
          }
        } catch (e) {
          await reply(`❌ Failed to add role: ${e.message}`);
          return;
        }
      }

      const key = generateKeyString();
      g.keys.push({
        key, scriptId, userId: target.id, hwid: null, hwidResetAt: null,
        createdAt: Date.now(), claimedAt: Date.now(), expiresAt: null,
        redeemedAt: null, useCount: 0, lastUsedAt: null
      });
      await db.save(gid);

      const scriptName = g.scripts[scriptId]?.name || scriptId;
      
      // Find panel channel
      let panelChannel = null;
      if (g.panels && g.panels.length > 0) {
        const panel = g.panels[0];
        if (panel.channelId) {
          try {
            panelChannel = await interaction.client.channels.fetch(panel.channelId);
          } catch (e) { /* channel not found */ }
        }
      }
      
      // PUBLIC message in current channel (visible to everyone)
      try {
        const channel = await interaction.client.channels.fetch(interaction.channelId);
        await channel.send({
          embeds: [new EmbedBuilder()
            .setColor(APP_CONFIG.EMBED_COLOR)
            .setTitle('✅ Whitelist')
            .setDescription(`<@${target.id}> You have been whitelisted!\nAccess the script through the panel: ${panelChannel ? `<#${panelChannel.id}>` : 'Check pinned panel'}`)
          ]
        });
      } catch (e) {
        console.error('Failed to send public whitelist message:', e.message);
      }
      
      // PRIVATE reply with key
      await reply(`✅ <@${target.id}> whitelisted!\n🔑 Key: \`${key}\``);
      return;
    }

    // ====== lookupkey ======
    if (cmd === 'lookupkey') {
      const keyVal = interaction.options.getString('key').trim().toUpperCase();
      const record = g.keys.find((k) => k.key === keyVal);
      if (!record) { await reply('❌ Key not found.'); return; }

      const embed = new EmbedBuilder()
        .setColor(APP_CONFIG.EMBED_COLOR)
        .setTitle(`🔎 ${record.key}`)
        .addFields(
          { name: 'Script', value: `\`${record.scriptId}\``, inline: true },
          { name: 'Owner', value: record.userId ? `<@${record.userId}>` : 'Unclaimed', inline: true },
          { name: 'HWID', value: record.hwid || 'None', inline: true },
          { name: 'Created', value: fmtDate(record.createdAt, lang), inline: true },
          { name: 'Claimed', value: record.claimedAt ? fmtDate(record.claimedAt, lang) : 'Never', inline: true },
          { name: 'Used', value: record.redeemedAt ? fmtDate(record.redeemedAt, lang) : 'Never', inline: true },
          { name: 'Uses', value: `${record.useCount || 0}`, inline: true },
          { name: 'Last Use', value: record.lastUsedAt ? fmtDate(record.lastUsedAt, lang) : 'Never', inline: true },
        );
      await replyEmbed(embed);
      return;
    }

    // ====== lookupuser ======
    if (cmd === 'lookupuser') {
      const target = interaction.options.getUser('user');
      const userKeys = g.keys.filter((k) => k.userId === target.id);

      if (userKeys.length === 0) {
        await reply(`❌ <@${target.id}> has no keys.${g.blacklist[target.id] ? ' (Blacklisted)' : ''}`);
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(APP_CONFIG.EMBED_COLOR)
        .setTitle(`👤 Keys of ${target.tag}`);

      for (const k of userKeys.slice(0, 20)) {
        embed.addFields({
          name: k.scriptId,
          value: `\`${k.key}\` — ${k.redeemedAt ? '✅ Used' : '⏳ Unused'}`,
          inline: false
        });
      }

      if (g.blacklist[target.id]) {
        embed.setDescription(`⚠️ **Blacklisted:** ${g.blacklist[target.id].reason}`);
      }

      await replyEmbed(embed);
      return;
    }

    // ====== deleteuserkeys ======
    if (cmd === 'deleteuserkeys') {
      const target = interaction.options.getUser('user');
      const before = g.keys.length;
      g.keys = g.keys.filter((k) => k.userId !== target.id);
      const removed = before - g.keys.length;

      await db.save(gid);
      await reply(`✅ Deleted ${removed} key(s) from <@${target.id}>.`);
      return;
    }

    // ====== resetkeyhwid ======
    if (cmd === 'resetkeyhwid') {
      const keyVal = interaction.options.getString('key').trim().toUpperCase();
      const record = g.keys.find((k) => k.key === keyVal);
      if (!record) { await reply('❌ Key not found.'); return; }

      record.hwid = null;
      record.hwidResetAt = Date.now();
      await db.save(gid);
      await reply('✅ HWID reset.');
      return;
    }

    // ====== sethwidcooldown ======
    if (cmd === 'sethwidcooldown') {
      const hours = interaction.options.getInteger('hours');
      g.config = g.config || {};
      g.config.hwidCooldownHours = hours;
      await db.save(gid);

      const msg = hours === 0 ? '✅ HWID cooldown disabled.' : `✅ HWID cooldown set to ${hours}h.`;
      await reply(msg);
      return;
    }

    // ====== blacklistuser ======
    if (cmd === 'blacklistuser') {
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason given';

      g.blacklist[target.id] = { reason, at: Date.now() };
      await db.save(gid);
      await reply(`✅ <@${target.id}> blacklisted: *${reason}*`);
      return;
    }

    // ====== unblacklistuser ======
    if (cmd === 'unblacklistuser') {
      const target = interaction.options.getUser('user');
      delete g.blacklist[target.id];
      await db.save(gid);
      await reply(`✅ <@${target.id}> removed from blacklist.`);
      return;
    }

    // ====== blacklisthwid ======
    if (cmd === 'blacklisthwid') {
      const hwid = interaction.options.getString('hwid');
      const reason = interaction.options.getString('reason') || 'No reason given';

      g.hwidBlacklist[hwid] = { reason, at: Date.now() };
      await db.save(gid);
      await reply(`✅ HWID \`${hwid}\` blacklisted: *${reason}*`);
      return;
    }

    // ====== unblacklisthwid ======
    if (cmd === 'unblacklisthwid') {
      const hwid = interaction.options.getString('hwid');
      delete g.hwidBlacklist[hwid];
      await db.save(gid);
      await reply(`✅ HWID \`${hwid}\` removed from blacklist.`);
      return;
    }

    // ====== killswitch ======
    if (cmd === 'killswitch') {
      const scriptId = interaction.options.getString('script_id');
      const disable = interaction.options.getBoolean('disable');

      if (!g.scripts[scriptId]) { await reply('❌ Script not found.'); return; }

      g.scripts[scriptId].killswitch = disable;
      await db.save(gid);

      const msg = disable 
        ? `✅ Script \`${scriptId}\` **disabled** (🔒)`
        : `✅ Script \`${scriptId}\` **enabled** (✅)`;
      await reply(msg);
      return;
    }

    // ====== trial ======
    if (cmd === 'trial') {
      const scriptId = interaction.options.getString('script_id');
      const enable = interaction.options.getBoolean('enable');
      const duration = interaction.options.getInteger('duration_hours') || 24;

      if (!g.scripts[scriptId]) { await reply('❌ Script not found.'); return; }

      g.scripts[scriptId].trialEnabled = enable;
      if (enable) g.scripts[scriptId].trialHours = duration;
      await db.save(gid);

      const msg = enable
        ? `✅ Trial mode **enabled** (${duration}h)`
        : `✅ Trial mode **disabled**`;
      await reply(msg);
      return;
    }

    // ====== compensate ======
    if (cmd === 'compensate') {
      const keyVal = interaction.options.getString('key').trim().toUpperCase();
      const hours = interaction.options.getInteger('hours');
      const record = g.keys.find((k) => k.key === keyVal);

      if (!record) { await reply('❌ Key not found.'); return; }

      if (!record.expiresAt) record.expiresAt = Date.now() + (hours * 3600000);
      else record.expiresAt += (hours * 3600000);

      await db.save(gid);
      await reply(`✅ Added ${hours}h to \`${keyVal}\``);
      return;
    }

    // ====== scriptreminder ======
    if (cmd === 'scriptreminder') {
      const scripts = Object.values(g.scripts).slice(0, 20);
      if (scripts.length === 0) { await reply('No scripts.'); return; }

      const list = scripts.map((s) => {
        const status = s.killswitch ? '🔒 DISABLED' : '✅ ENABLED';
        const trial = s.trialEnabled ? ` (🧪 ${s.trialHours}h trial)` : '';
        return `• \`${s.id}\` — ${status}${trial}`;
      }).join('\n');

      await reply(`📋 **Scripts** (${scripts.length}):\n${list}`);
      return;
    }

    // ====== deletescript ======
    if (cmd === 'deletescript') {
      const scriptId = interaction.options.getString('script_id');
      if (!g.scripts[scriptId]) { await reply('❌ Script not found.'); return; }

      delete g.scripts[scriptId];
      delete g.scriptRoleMap[scriptId];
      g.keys = g.keys.filter((k) => k.scriptId !== scriptId);

      await db.save(gid);
      await reply(`✅ Script \`${scriptId}\` deleted.`);
      return;
    }

    // ====== linkscript ======
    if (cmd === 'linkscript') {
      const scriptId = interaction.options.getString('script_id');
      const role = interaction.options.getRole('role');

      if (!g.scripts[scriptId]) { await reply('❌ Script not found.'); return; }

      g.scriptRoleMap[scriptId] = role.id;
      await db.save(gid);
      await reply(`✅ Script \`${scriptId}\` linked to <@&${role.id}>`);
      return;
    }

    // ====== unlinkscript ======
    if (cmd === 'unlinkscript') {
      const scriptId = interaction.options.getString('script_id');
      if (!g.scripts[scriptId]) { await reply('❌ Script not found.'); return; }

      delete g.scriptRoleMap[scriptId];
      await db.save(gid);
      await reply(`✅ Script \`${scriptId}\` unlinked.`);
      return;
    }

    // ====== setwebhook ======
    if (cmd === 'setwebhook') {
      const scriptId = interaction.options.getString('script_id');
      const webhookUrl = interaction.options.getString('webhook_url');

      if (!g.scripts[scriptId]) { await reply('❌ Script not found.'); return; }
      if (!webhookUrl.startsWith('http')) { await reply('❌ Invalid URL.'); return; }

      g.scripts[scriptId].webhook = webhookUrl;
      await db.save(gid);
      await reply(`✅ Webhook updated for \`${scriptId}\``);
      return;
    }

    // ====== setbuyerrole ======
    if (cmd === 'setbuyerrole') {
      const scriptId = interaction.options.getString('script_id');
      const role = interaction.options.getRole('role');

      if (!g.scripts[scriptId]) { await reply('❌ Script not found.'); return; }

      g.scripts[scriptId].buyerRole = role.id;
      await db.save(gid);
      await reply(`✅ Buyer role set to <@&${role.id}> for \`${scriptId}\``);
      return;
    }

    // ====== exportkeys ======
    if (cmd === 'exportkeys') {
      const scriptId = interaction.options.getString('script_id');
      let keys = g.keys;

      if (scriptId) {
        if (!g.scripts[scriptId]) { await reply('❌ Script not found.'); return; }
        keys = keys.filter((k) => k.scriptId === scriptId);
      }

      const csv = 'Key,Script,Owner,HWID,Created,Used,Status\n' + keys.map((k) => {
        const status = k.redeemedAt ? 'USED' : 'UNUSED';
        return `${k.key},${k.scriptId},${k.userId || 'N/A'},${k.hwid || 'N/A'},${fmtDate(k.createdAt, lang)},${fmtDate(k.redeemedAt, lang)},${status}`;
      }).join('\n');

      const filename = `keys-export-${Date.now()}.csv`;
      // Store CSV in memory or send as text
      await reply(`\`\`\`\n${csv}\n\`\`\``);
      return;
    }

  } catch (error) {
    console.error(`PolSec command error (${cmd}):`, error);
    await reply(`❌ Command failed: ${error.message}`);
  }
}

// ================================================================
// EXPORTS
// ================================================================

module.exports = {
  buildPolsecCommands,
  handlePolSecCommand,
};
