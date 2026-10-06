# Patches pour index.js

## PATCH 1 : Ajouter l'import (après ligne 15)

**Ligne actuelle 15:**
```javascript
const trade = require('./trade');
```

**À ajouter après ligne 15:**
```javascript
const constructionCmds = require('./construction_commands');
```

**Résultat complet (lignes 14-17):**
```javascript
const perms = require('./perms');
const constructionCmds = require('./construction_commands');
const trade = require('./trade');
const bf = require('./brainrot-finder');
```

---

## PATCH 2 : Ajouter les commandes à la liste (ligne 440)

**Ligne actuelle 440:**
```javascript
commands.push(...economy.commands, ...perms.commands, ...trade.commands, ...bf.commands);
```

**À remplacer par:**
```javascript
commands.push(...economy.commands, ...perms.commands, ...constructionCmds.commands, ...trade.commands, ...bf.commands);
```

---

## PATCH 3 : Router les commandes (dans routeInteraction, avant ligne 1195)

**Contexte avant (lignes 1190-1205):**
```javascript
  if (bf.isBFCommand(interaction.commandName)) { await bf.handleCommand(interaction); return; }
  if (economy.isEconomyCommand(interaction.commandName)) { await economy.handleCommand(interaction); return; }
  if (trade.isTradeCommand(interaction.commandName)) { await trade.handleCommand(interaction); return; }

  if (interaction.commandName === 'ask') {
```

**À insérer AVANT la ligne `if (interaction.commandName === 'ask')`:**
```javascript
  if (constructionCmds.isConstructionCommand(interaction.commandName)) {
    if (!perms.canUseCommand(interaction.member, g, interaction.commandName)) {
      await interaction.reply({ content: "❌ Tu n'as pas la permission d'utiliser cette commande (Administrateur, Gérer le serveur, ou un rôle autorisé via `/staffrole`).", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: ['buildmode', 'copychannels'].includes(interaction.commandName) });
    await constructionCmds.handleCommand(interaction, client, g, db);
    return;
  }

```

**Résultat complet (lignes 1190-1210):**
```javascript
  if (bf.isBFCommand(interaction.commandName)) { await bf.handleCommand(interaction); return; }
  if (economy.isEconomyCommand(interaction.commandName)) { await economy.handleCommand(interaction); return; }
  if (trade.isTradeCommand(interaction.commandName)) { await trade.handleCommand(interaction); return; }

  if (constructionCmds.isConstructionCommand(interaction.commandName)) {
    if (!perms.canUseCommand(interaction.member, g, interaction.commandName)) {
      await interaction.reply({ content: "❌ Tu n'as pas la permission d'utiliser cette commande (Administrateur, Gérer le serveur, ou un rôle autorisé via `/staffrole`).", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: ['buildmode', 'copychannels'].includes(interaction.commandName) });
    await constructionCmds.handleCommand(interaction, client, g, db);
    return;
  }

  if (interaction.commandName === 'ask') {
```

---

## PATCH 4 : Ajouter les handlers de boutons dans routeSelect (avant le catch, ~ligne 1050)

**Chercher la fonction `async function routeSelect(interaction)` et avant le bloc `catch`, ajouter:**

```javascript
  // Confirmation de suppression de salon
  if (interaction.customId.startsWith('delete_confirm_')) {
    const channelId = interaction.customId.split('_')[2];
    const channel = interaction.guild.channels.cache.get(channelId);
    if (channel && channel.deletable) {
      await channel.delete('Suppression confirmée par ' + interaction.user.tag).catch(() => {});
      await interaction.update({ content: '✅ Salon supprimé.', embeds: [], components: [] });
    } else {
      await interaction.update({ content: '❌ Impossible de supprimer le salon.', embeds: [], components: [] });
    }
    return;
  }
  if (interaction.customId.startsWith('delete_cancel_')) {
    await interaction.update({ content: '❌ Suppression annulée.', embeds: [], components: [] });
    return;
  }
```

**Placement exact:** Dans `routeSelect()`, à la fin avant `} catch (err)` (ligne ~1050).

---

## Checklist

- [ ] PATCH 1 : ligne 15, ajouter import `construction_commands`
- [ ] PATCH 2 : ligne 440, ajouter `...constructionCmds.commands`
- [ ] PATCH 3 : avant ligne 1195 (`if (interaction.commandName === 'ask')`), router les commandes
- [ ] PATCH 4 : dans `routeSelect()` avant `catch`, ajouter handlers boutons
- [ ] Copier `construction_commands.js` à la racine du bot
- [ ] Copier `db.js` modifié par-dessus l'ancien
- [ ] Tester les 4 commandes
- [ ] Push sur GitHub

---

## Alternative : Intégration manuelle complète

Si les numéros de ligne ont changé depuis la capture, voici la logique :

1. **Import** : ajoute `const constructionCmds = require('./construction_commands');` après les autres requires (`perms`, avant `trade`)
2. **Commands** : ajoute `...constructionCmds.commands` dans la liste `commands.push()`
3. **Router** : ajoute le bloc `if (constructionCmds.isConstructionCommand())` dans `routeInteraction()`, entre `if (trade.isTradeCommand())` et `if (interaction.commandName === 'ask')`
4. **Boutons** : ajoute les deux handlers (`delete_confirm_`, `delete_cancel_`) dans `routeSelect()` avant le `catch`

C'est tout. Le reste est automatique.
