# Instructions : Push sur GitHub

## 📋 Fichiers à avoir

Assure-toi que tu as les 4 fichiers dans `/mnt/user-data/outputs/` :
1. ✅ `construction_commands.js`
2. ✅ `db.js`
3. ✅ `index_patches.md`
4. ✅ `README_CONSTRUCTION_COMMANDS.md`

---

## 🔧 Étapes d'intégration locale

### 1. Clone le repo (si pas déjà fait)
```bash
git clone <url-du-repo>
cd <nom-du-repo>
```

### 2. Copie les fichiers

**Copie ces fichiers à la racine du bot :**
```bash
# Depuis ton dossier local du bot :
cp <chemin>/construction_commands.js .
cp <chemin>/db.js .
```

**Copie les docs dans un dossier `docs/` :**
```bash
mkdir -p docs
cp <chemin>/index_patches.md docs/
cp <chemin>/README_CONSTRUCTION_COMMANDS.md docs/
```

Résultat :
```
mon-bot/
├── construction_commands.js      ← NOUVEAU
├── db.js                          ← MODIFIÉ
├── index.js                       ← À PATCHER
├── ...autres fichiers...
├── docs/
│   ├── index_patches.md           ← DOCUMENTATION
│   └── README_CONSTRUCTION_COMMANDS.md
└── .gitignore
```

### 3. Applique les patches dans `index.js`

Ouvre `index.js` et applique les 4 patches de `docs/index_patches.md` :

#### Patch 1 : Import (ligne ~15)
Ajoute après `const perms = require('./perms');` :
```javascript
const constructionCmds = require('./construction_commands');
```

#### Patch 2 : Commands (ligne ~440)
Remplace :
```javascript
commands.push(...economy.commands, ...perms.commands, ...trade.commands, ...bf.commands);
```
Par :
```javascript
commands.push(...economy.commands, ...perms.commands, ...constructionCmds.commands, ...trade.commands, ...bf.commands);
```

#### Patch 3 : Router (avant ligne ~1195)
Ajoute avant `if (interaction.commandName === 'ask') {` :
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

#### Patch 4 : Boutons (avant `catch` dans `routeSelect()`)
Ajoute avant le bloc `} catch (err)` de `routeSelect()` :
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

### 4. Teste localement
```bash
npm install  # si dépendances manquent (normalement non)
npm start
```

Attends que le bot soit en ligne, puis teste les 4 commandes :
```
/buildmode
/createchannel nom:test-salon
/deletechannel salon:#test-salon
/copychannels server_id:123...
```

Tous les tests ✅ ? Passe à l'étape 5.

---

## 📤 Push sur GitHub

### 5. Git status
```bash
git status
```

Tu devrais voir :
```
new file:   construction_commands.js
modified:   db.js
modified:   index.js
new file:   docs/index_patches.md
new file:   docs/README_CONSTRUCTION_COMMANDS.md
```

### 6. Add files
```bash
git add construction_commands.js db.js index.js
git add docs/
```

Ou tout en une :
```bash
git add .
```

Vérifies :
```bash
git status
```

Tous les fichiers doivent être en vert (staged).

### 7. Commit
```bash
git commit -m "feat: add construction commands module (buildmode, createchannel, deletechannel, copychannels)"
```

**Bonne pratique** :
- En français si ton repo est en français
- Format : `feat:`, `fix:`, `docs:`, `refactor:`, etc.

Alternative si tu veux plus de détails :
```bash
git commit -m "feat: add construction commands module

- /buildmode: toggle server construction mode
- /createchannel: create new channels (text/voice)
- /deletechannel: delete channels with confirmation
- /copychannels: copy all channels from another server

Also updated db.js with new constructionMode flag."
```

### 8. Push
```bash
git push
```

Ou si tu es sur une branche :
```bash
git push origin <branch-name>
```

### 9. Vérifies sur GitHub

Va sur https://github.com/ton-pseudo/ton-repo

Clique sur "Commits" ou la branche — tu devrais voir ton commit.

---

## ✅ Vérifications finales

- [ ] `git push` sans erreur ✅
- [ ] Commit visible sur GitHub ✅
- [ ] Fichiers listés dans le commit ✅
- [ ] `construction_commands.js` présent ✅
- [ ] `db.js` modifié (constructionMode visible) ✅
- [ ] `index.js` patché (4 sections modifiées) ✅
- [ ] `docs/` contient les 2 fichiers ✅

---

## 🚀 Après le push

### Pour quelqu'un qui clone ton repo
1. Clone le repo
2. Copie les fichiers comme toi
3. Applique les patches de `docs/index_patches.md`
4. Redémarre le bot
5. Les 4 commandes sont actives

### Alternatives (si tu veux simplifier pour les autres)

**Option 1** : Crée une branche `feature/construction-commands` au lieu de push sur `main`
```bash
git checkout -b feature/construction-commands
git push origin feature/construction-commands
```
Puis crée une Pull Request sur GitHub.

**Option 2** : Crée un script d'intégration automatique (plus complexe, pas couvert ici).

---

## 🐛 Troubleshooting

### "fatal: not a git repository"
```bash
git init
git remote add origin <url-du-repo>
git fetch
git checkout main  # ou master
```

### "error: Your local changes to <file> would be overwritten by merge"
```bash
git stash  # sauvegarde tes changements
git pull
git stash pop  # restaure
```

### "Permission denied (publickey)"
Ajoute ta clé SSH à GitHub :
https://github.com/settings/keys

Ou utilise HTTPS :
```bash
git remote set-url origin https://github.com/user/repo.git
```

### "conflict in index.js" au merge
C'est normal si quelqu'un a modifié `index.js` en même temps.

Résous manuellement (les 4 patches sont clairement marqués) :
```bash
# Ouvre index.js
# Cherche les marques de conflit : <<<<, ====, >>>>
# Garde tes changements et les nôtres
git add index.js
git commit -m "merge: resolve conflicts in index.js"
git push
```

---

## 📚 Ressources Git

- [Git documentation](https://git-scm.com/doc)
- [GitHub Quick Start](https://docs.github.com/en/get-started/quickstart)
- [Git commits — Conventional Commits](https://www.conventionalcommits.org/)

---

## ✨ Done!

Fichiers pushés, documentation à jour, commandes prêtes pour le monde. 🪶
