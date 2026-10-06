# ⚡ Construction Commands — Quick Start

## 📋 TLDR

4 commandes Discord pour gérer les salons. 3 fichiers à modifier/copier. 26 lignes à ajouter.

## 📁 Quoi Faire

### 1. Copie (2 fichiers)
```bash
cp construction_commands.js /mon-bot/
cp db.js /mon-bot/
```

### 2. Patcher index.js (4 patches)
```javascript
// Patch 1 — ligne 15
const constructionCmds = require('./construction_commands');

// Patch 2 — ligne 440
commands.push(...economy.commands, ...perms.commands, 
  ...constructionCmds.commands, ...trade.commands, ...bf.commands);

// Patch 3 — avant "if (interaction.commandName === 'ask')" (~1195)
if (constructionCmds.isConstructionCommand(interaction.commandName)) {
  if (!perms.canUseCommand(interaction.member, g, interaction.commandName)) {
    await interaction.reply({ content: "❌ Tu n'as pas la permission.", ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: ['buildmode', 'copychannels'].includes(interaction.commandName) });
  await constructionCmds.handleCommand(interaction, client, g, db);
  return;
}

// Patch 4 — avant "} catch (err)" dans routeSelect (~1050)
if (interaction.customId.startsWith('delete_confirm_')) {
  const channelId = interaction.customId.split('_')[2];
  const channel = interaction.guild.channels.cache.get(channelId);
  if (channel && channel.deletable) {
    await channel.delete('Suppression confirmée').catch(() => {});
    await interaction.update({ content: '✅ Salon supprimé.', embeds: [], components: [] });
  } else {
    await interaction.update({ content: '❌ Impossible.', embeds: [], components: [] });
  }
  return;
}
if (interaction.customId.startsWith('delete_cancel_')) {
  await interaction.update({ content: '❌ Annulé.', embeds: [], components: [] });
  return;
}
```

### 3. Test
```bash
npm start
/buildmode → toggle OK
/createchannel nom:test → salon créé OK
/deletechannel salon:#test → buttons OK
/copychannels server_id:ID → copie OK
```

### 4. Push
```bash
git add .
git commit -m "feat: add construction commands"
git push
```

## 🎮 Les 4 Commandes

| Commande | Permission | Usage |
|----------|-----------|-------|
| `/buildmode` | Admin | Active/désactive mode construction |
| `/createchannel` | ManageChannels | `/createchannel nom:salon type:text` |
| `/deletechannel` | ManageChannels | `/deletechannel salon:#mon-salon` |
| `/copychannels` | Admin | `/copychannels server_id:123...` |

## 📂 Fichiers

**À copier** :
- `construction_commands.js` (root)
- `db.js` (root, remplace l'ancien)

**À patcher** :
- `index.js` (4 sections, ~26 lignes)

**Documentation** (optionnel) :
- `/docs/00_SUMMARY.md` — vue d'ensemble
- `/docs/README_CONSTRUCTION_COMMANDS.md` — docs des commandes
- `/docs/index_patches.md` — numéros de ligne précis
- `/docs/index_PATCHED_sections.js` — exemple des patches
- `/docs/GITHUB_PUSH_INSTRUCTIONS.md` — git steps
- `/docs/INTEGRATION_GUIDE.md` — guide complet

## 🔗 Liens

- **Detailed**: 00_SUMMARY.md
- **How to patch**: index_patches.md  
- **How to push**: GITHUB_PUSH_INSTRUCTIONS.md
- **Command docs**: README_CONSTRUCTION_COMMANDS.md

## ✅ Checklist

- [ ] `construction_commands.js` copié
- [ ] `db.js` remplacé
- [ ] Patch 1 (import)
- [ ] Patch 2 (commands list)
- [ ] Patch 3 (routeInteraction)
- [ ] Patch 4 (routeSelect buttons)
- [ ] `npm start` — no errors
- [ ] `/buildmode` works
- [ ] `/createchannel` works
- [ ] `/deletechannel` works
- [ ] `/copychannels` works
- [ ] `git push` done

## 🐛 Common Mistakes

| Erreur | Fix |
|--------|-----|
| "Cannot find module" | Vérifie le path de copie, redis la copie |
| "constructionMode is undefined" | Remplace complètement db.js |
| Commandes n'apparaissent pas | Redémarre le bot |
| Boutons ne marchent pas | Vérifies patch 4 avant le `catch` |
| SyntaxError index.js | Vérifie l'indentation et les accolades |

## 💾 Repository Structure

```
mon-bot/
├── construction_commands.js      ← NOUVEAU
├── db.js                         ← MODIFIÉ (+ 1 ligne)
├── index.js                      ← PATCHADO (+ 26 lignes)
├── docs/                         ← OPTIONAL
│   ├── 00_SUMMARY.md
│   ├── README_CONSTRUCTION_COMMANDS.md
│   ├── index_patches.md
│   ├── index_PATCHED_sections.js
│   ├── GITHUB_PUSH_INSTRUCTIONS.md
│   └── INTEGRATION_GUIDE.md
└── ... autres fichiers ...
```

## 🚀 Time

- Integration: 15-30 minutes
- Testing: 5 minutes
- Git: 2 minutes
- Total: 30 minutes, prêt pour production

---

**Besoin de plus de détails?** Lis `/docs/00_SUMMARY.md`.  
**Besoin des numéros de ligne?** Lis `/docs/index_patches.md`.  
**Besoin d'aide avec git?** Lis `/docs/GITHUB_PUSH_INSTRUCTIONS.md`.

**C'est bon. 🪶**
