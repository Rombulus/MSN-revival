# MSN Revival

Client local inspiré de MSN Messenger, connecté aux conversations de Beeper Desktop par son API officielle. Interface Windows classique, avatars, historique, envoi et synchronisation des messages.

## Lancer

Double-clique sur **Lancer-MSN.cmd**, ou lance `npm start` puis ouvre `http://127.0.0.1:4173`. Node.js 22 ou plus récent est requis. L’ouverture directe de `index.html` sert uniquement à la démonstration.

## Connecter Beeper Desktop

1. Lance Beeper Desktop et ouvre **Paramètres → Intégrations**.
2. Active l’API locale.
3. Dans MSN Revival, clique **Autoriser dans Beeper**, puis approuve l’accès sur la page de Beeper. La connexion manuelle par clé est aussi disponible dans les réglages.

Le serveur local garde l’autorisation en mémoire. Le navigateur reçoit seulement un cookie de session ; aucun token n’est écrit par ce client sur disque. Toutes les requêtes restent locales. Voir [GUIDE.md](GUIDE.md) pour les fonctions disponibles, les limites et les vérifications.

Les sons sont recréés avec Web Audio et n’utilisent pas les fichiers audio Microsoft d’origine.

## Thème MSN Revival pour Beeper Desktop

Le fichier `msn-revival-beeper.css` conserve l’essai de thème CSS natif réalisé précédemment. Il ne sert pas au client MSN séparé.

Pour le charger dans Beeper : **Paramètres → Apparence → Custom CSS → Reload CSS**. Le mécanisme officiel de Beeper permet de restyler couleurs, panneaux, bulles et composeur, mais ne permet pas de réorganiser la fenêtre en nouvelle interface MSN ni d’ajouter les deux cartes décoratives de la capture.
