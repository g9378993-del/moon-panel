# Bot d'économie Discord — Guide pas à pas

Ce bot recrée le système vu dans tes captures : coins, messages, temps vocal,
leaderboard, shop, transfert, ajout/retrait de coins (admin).

Tu n'as jamais fait ça ? Suis les étapes dans l'ordre, ça prend 15-20 min.

## 1. Créer l'application du bot sur Discord

1. Va sur https://discord.com/developers/applications
2. Clique **New Application**, donne-lui un nom (ex: Full Red).
3. Dans le menu de gauche, va dans l'onglet **Bot**.
4. Clique **Reset Token** puis **Copy** → c'est ton `DISCORD_TOKEN`.
   ⚠️ Ne le montre à personne, ne le colle jamais dans un chat ou sur GitHub.
5. Toujours dans l'onglet Bot, active ces 3 options (sous "Privileged Gateway Intents") :
   - **Presence Intent**
   - **Server Members Intent**
   - **Message Content Intent**
6. Dans l'onglet **General Information**, copie l'**Application ID** →
   c'est ton `CLIENT_ID`.

## 2. Inviter le bot sur ton serveur

1. Onglet **OAuth2 > URL Generator**.
2. Dans "Scopes", coche `bot` et `applications.commands`.
3. Dans "Bot Permissions", coche : Send Messages, Embed Links, Read Message
   History, Use Slash Commands, Manage Roles (si tu veux le shop qui donne
   des rôles).
4. Copie l'URL générée en bas, colle-la dans ton navigateur, choisis ton
   serveur, valide.

## 3. Installer Node.js (une seule fois sur ton PC)

Télécharge et installe la version LTS ici : https://nodejs.org
Vérifie ensuite dans un terminal :
```
node -v
```
Tu dois voir une version (ex: v20.x).

## 4. Configurer le projet

1. Ouvre un terminal dans le dossier `fullred-bot`.
2. Installe les dépendances :
   ```
   npm install
   ```
3. Renomme `.env.example` en `.env`.
4. Ouvre `.env` et remplis :
   - `DISCORD_TOKEN` = le token copié à l'étape 1
   - `CLIENT_ID` = l'Application ID copié à l'étape 1
   - `GUILD_ID` = l'ID de ton serveur (clic droit sur le serveur dans
     Discord > Copier l'ID — active d'abord le mode développeur dans
     Paramètres > Avancés)

## 5. Lancer le bot

Dans le terminal, toujours dans le dossier du projet :
```
node index.js
```
Tu dois voir `Connecté en tant que ...`. Le bot est en ligne tant que ce
terminal reste ouvert.

Sur ton serveur Discord, tape `/dashboard` dans un salon → le panneau
apparaît avec les boutons (Coins, Messages, Voice Time, Leaderboard, Shop,
Transfer, Add/Remove Coins réservés aux admins).

## 6. Le faire tourner 24/7

Tant que ton PC/terminal est éteint, le bot est hors ligne. Pour qu'il
tourne en permanence, héberge-le sur un service comme Railway, Render,
ou un petit VPS — je peux t'expliquer si tu veux.

## Personnalisation

Tout se modifie dans l'objet `CONFIG` en haut du fichier `index.js` :
récompenses, cooldown, items du shop, couleur des embeds, nom du bot.
