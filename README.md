# MSN Revival

Client local inspiré de MSN Messenger, connecté aux conversations de Beeper Desktop par son API officielle. Interface Windows classique, avatars, historique, envoi et synchronisation des messages.

## Lancer

Double-clique sur **Lancer-MSN.cmd**, ou lance `npm start` puis ouvre `http://127.0.0.1:4173`. Node.js 22 ou plus récent est requis. L’ouverture directe de `index.html` sert uniquement à la démonstration.

## Connecter Beeper Desktop

1. Lance Beeper Desktop et ouvre **Paramètres → Intégrations**.
2. Active l’API locale.
3. Dans MSN Revival, clique **Autoriser dans Beeper**, puis approuve l’accès sur la page de Beeper. La connexion manuelle par clé est aussi disponible dans les réglages.

Une seule autorisation suffit : MSN conserve la connexion après fermeture, redémarrage du serveur ou du PC. Sous Windows, la clé est chiffrée avec DPAPI pour ton compte Windows dans `%LOCALAPPDATA%\MSN Revival\beeper-auth.json`. Elle reste côté serveur, hors du dépôt ; le navigateur reçoit seulement un cookie. Sur les autres systèmes, le fichier est privé à l’utilisateur (permissions 0600).

La validation Beeper s’ouvre dans une fenêtre séparée : MSN reste ouvert et charge automatiquement les conversations après accord. Si Beeper est fermé ou temporairement inaccessible, la clé est conservée et MSN réessaie sans nouvelle autorisation. **Déconnecter** efface volontairement la connexion enregistrée ; une clé révoquée dans Beeper nécessite une nouvelle autorisation. Voir [GUIDE.md](GUIDE.md) pour les fonctions disponibles, les limites et les vérifications.

Les sons sont recréés avec Web Audio et n’utilisent pas les fichiers audio Microsoft d’origine.

## Thème MSN Revival pour Beeper Desktop

Le fichier `msn-revival-beeper.css` conserve l’essai de thème CSS natif réalisé précédemment. Il ne sert pas au client MSN séparé.

Pour le charger dans Beeper : **Paramètres → Apparence → Custom CSS → Reload CSS**. Le mécanisme officiel de Beeper permet de restyler couleurs, panneaux, bulles et composeur, mais ne permet pas de réorganiser la fenêtre en nouvelle interface MSN ni d’ajouter les deux cartes décoratives de la capture.
