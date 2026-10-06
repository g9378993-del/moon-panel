# Construction Commands Module

Module de gestion complète des salons Discord pour le bot.

## 📦 Contenu

- `construction_commands.js` — Module avec 4 commandes slash
- `db.js` — Base de données modifiée (avec flag `constructionMode`)
- `index_patches.md` — Guide d'intégration précis
- Ce README

## 🚀 Intégration Rapide

### Étape 1 : Fichiers à copier
1. Copie `construction_commands.js` à la racine du bot (même niveau que `index.js`)
2. Remplace `db.js` par le nouveau `db.js` fourni

### Étape 2 : Patches index.js

Ouvre `index.js` et applique les 4 patches de `index_patches.md` :

**PATCH 1 (ligne ~15)** : Ajouter l'import
```javascript
const constructionCmds = require('./construction_commands');
```

**PATCH 2 (ligne ~440)** : Ajouter aux commandes
```javascript
commands.push(...economy.commands, ...perms.commands, ...constructionCmds.commands, ...trade.commands, ...bf.commands);
```

**PATCH 3 (avant ligne ~1195)** : Router dans `routeInteraction()`
```javascript
if (constructionCmds.isConstructionCommand(interaction.commandName)) {
  if (!perms.canUseCommand(interaction.member, g, interaction.commandName)) {
    await interaction.reply({ content: "❌ Tu n'as pas la permission d'utiliser cette commande.", ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: ['buildmode', 'copychannels'].includes(interaction.commandName) });
  await constructionCmds.handleCommand(interaction, client, g, db);
  return;
}
```

**PATCH 4 (dans `routeSelect()`, avant `catch`)** : Handlers pour les boutons
```javascript
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

### Étape 3 : Redémarrer le bot
```bash
npm start
# ou sur Render : redeploy
```

Les commandes devraient apparaître dans Discord dans les 1-5 secondes (sync automatique).

---

## 🎮 Commandes

### `/buildmode`
**Permission** : Admin uniquement  
**Description** : Active/désactive le mode construction du serveur  
**Usage** :
```
/buildmode
```
**Résultat** : Toggle `g.constructionMode` + embed de confirmation

---

### `/createchannel`
**Permission** : Gérer les salons  
**Description** : Crée un nouveau salon (texte ou vocal)  
**Options** :
- `nom` (requis) : Nom du salon (auto-formaté en lowercase)
- `type` (optionnel) : `text` ou `voice` (défaut: text)
- `categorie` (optionnel) : Catégorie parent
- `description` (optionnel) : Topic du salon (texte seulement)

**Exemples** :
```
/createchannel nom:général type:text description:Zone de discussion générale
/createchannel nom:vocal-gamer type:voice categorie:#jeux
/createchannel nom:logs
```

**Résultat** : Salon créé + embed de confirmation avec détails

---

### `/deletechannel`
**Permission** : Gérer les salons  
**Description** : Supprime un salon après confirmation  
**Options** :
- `salon` (requis) : Le salon à supprimer

**Usage** :
```
/deletechannel salon:#mon-salon
```

**Résultat** : 
1. Embed d'avertissement avec 2 boutons : **✅ Confirmer** / **❌ Annuler**
2. Timeout 30 secondes
3. Si confirmé : salon supprimé + message `✅ Salon supprimé`
4. Si annulé : message `❌ Suppression annulée`

---

### `/copychannels`
**Permission** : Admin uniquement  
**Description** : Copie TOUS les salons d'un autre serveur  
**Options** :
- `server_id` (requis) : ID du serveur source
- `with_messages` (optionnel) : Copier les permissions ? true/false (défaut: true)

**Usage** :
```
/copychannels server_id:123456789012345678 with_messages:true
```

**Résultat** :
- ⏳ Message "Copie en cours..."
- Puis embed final avec :
  - Nombre de salons créés ✅
  - Nombre d'erreurs ❌
  - Liste des erreurs (si quelques-unes)
  - Serveur source et cible

**Ce qui est copié** :
- ✅ Nom du salon
- ✅ Type (texte ou vocal)
- ✅ Description/topic
- ✅ Catégorie parent
- ✅ Permissions (optionnel) — exclut les rôles managés du bot
- ❌ Historique (les messages ne sont jamais copiés)
- ❌ Rôles de bots managés (auto-exclus)

**Détails techniques** :
- Crée les catégories au fur et à mesure
- Mappe les rôles par nom sur le serveur cible
- Si un rôle source n'existe pas en cible, l'autorisation est skippée
- Affiche les erreurs (max 5) dans l'embed final

---

## 🛠 Structure Technique

### Construction Commands Module (`construction_commands.js`)

**Exports** :
```javascript
{
  commands: [SlashCommandBuilder, ...],  // 4 commandes à ajouter
  isConstructionCommand(cmdName): boolean,
  handleCommand(interaction, client, g, db): Promise
}
```

**Handlers** :
- `handleBuildMode()` — toggle flag + save DB
- `handleCreateChannel()` — crée salon avec validation
- `handleDeleteChannel()` — affiche buttons de confirmation
- `handleCopyChannels()` — copie serveur complet

### Database (`db.js`)

**Nouveau flag** :
```javascript
constructionMode: false  // dans defaultGuild()
```

Tous les autres champs restent identiques.

---

## ⚠️ Permissions Discord Requises

Le bot doit avoir les permissions suivantes sur le serveur :
- `Manage Channels` — créer/supprimer salons
- `Manage Roles` — gérer permissions des salons
- `View Channels` — accéder aux salons

Si ces permissions manquent, les commandes afficheront ❌ erreur explicite.

---

## 🐛 Troubleshooting

### Les commandes n'apparaissent pas
- Redémarre le bot
- Attends 30-60 secondes (sync Discord)
- Aide → Commandes slash → cherche "buildmode"

### "Je n'ai pas la permission"
- Vérifie que tu es Admin (ou que le staff role est configuré)
- Assure-toi que le bot a `Manage Channels` et `Manage Roles`
- Redémarre le bot

### Erreur lors de la copie de salons
- Vérifie que le bot est sur le serveur SOURCE et CIBLE
- L'ID du serveur doit être correct
- Les rôles n'existent pas en cible ? Ils sont auto-skippés
- Regarde les erreurs listées dans l'embed final

### Le bouton de confirmation ne marche pas
- Assure-toi que `routeSelect()` inclut les handlers `delete_confirm_` et `delete_cancel_`
- Vérifie que `interaction.isButton()` fonctionne
- Redémarre le bot

---

## 📝 Notes

- **Sauvegardes** : Tous les changements de config (buildmode) sont sauvés en DB + fichier local
- **Ephémeral** : `/buildmode` et `/copychannels` répondent en privé (ephemeral)
- **Timeout** : Confirmation suppression expire en 30 secondes
- **Erreurs** : Toutes catchées et affichées à l'utilisateur (pas de crash)
- **Performance** : Copie de serveur peut prendre quelques secondes (progressif)

---

## 🔗 GitHub

1. Copie ces fichiers au repo :
   ```
   construction_commands.js
   db.js
   README_CONSTRUCTION_COMMANDS.md
   index_patches.md
   ```

2. Applique les 4 patches de `index_patches.md` dans `index.js`

3. Push :
   ```bash
   git add .
   git commit -m "feat: add construction commands (buildmode, createchannel, deletechannel, copychannels)"
   git push
   ```

---

## ✅ Checklist d'intégration

- [ ] `construction_commands.js` copié à la racine
- [ ] `db.js` remplacé
- [ ] Import ajouté (ligne ~15)
- [ ] Commands pushées (ligne ~440)
- [ ] Router ajouté dans `routeInteraction()` (~1195)
- [ ] Handlers boutons ajoutés dans `routeSelect()` (~1050)
- [ ] Bot redémarré
- [ ] Test `/buildmode` → toggle OK
- [ ] Test `/createchannel nom:test-salon` → salon créé OK
- [ ] Test `/deletechannel salon:#test-salon` → confirmation OK
- [ ] Test `/copychannels server_id:123...` → copie OK
- [ ] Push sur GitHub

C'est bon. Talons tranchants. ✨
