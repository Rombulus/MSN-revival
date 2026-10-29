# MSN Revival

MSN Revival est un client de messagerie local au look de MSN Messenger, connecté à **Beeper Desktop** par son API locale officielle. Il rassemble dans une fenêtre à l’ancienne les conversations des réseaux déjà configurés dans Beeper. Le projet est un frontend séparé : il ne modifie pas l’application Beeper.

## Fonctionnalités

- Historique des conversations, recherche, filtres de non lus et contacts regroupés par réseau.
- Chargement des messages précédents en remontant dans la conversation, avec conservation de la position de lecture.
- Nom de l’expéditeur en couleur vive, date et heure complètes à côté du nom, réponses et réactions.
- Envoi de messages texte, pièces jointes et messages vocaux enregistrés depuis l’application.
- Affichage des photos, vidéos, audio, autocollants, GIF, liens et aperçus fournis par Beeper. Certains aperçus, notamment Instagram, dépendent des données disponibles auprès du réseau.
- Indicateurs de non-lus synchronisés avec Beeper lorsque la conversation est affichée jusqu’au dernier message.
- Sons synthétisés, émoticônes et effet Wizz local pour retrouver l’ambiance de Messenger.

L’interface, les logos de réseau et l’icône de l’application sont des ressources du frontend. Le Wizz ne déclenche pas d’événement sur le réseau de messagerie.

## Prérequis

- Node.js 22 ou une version plus récente.
- Beeper Desktop installé et lancé, avec son API locale activée dans **Paramètres → Intégrations**.
- Microsoft Edge est utilisé par le lanceur Windows s’il est installé. Sinon, le navigateur par défaut s’ouvre.

## Démarrage

### Windows

Double-clique sur `Lancer-MSN.cmd`. Le lanceur démarre le serveur local et ouvre MSN Revival dans une fenêtre d’application. Le raccourci du Bureau peut également pointer vers ce lanceur.

### Autres systèmes ou lancement manuel

Depuis le dossier du projet :

```sh
npm start
```

Ouvre ensuite [http://127.0.0.1:4173](http://127.0.0.1:4173). Ouvrir directement `index.html` ne lance que le mode démonstration et ne se connecte pas à Beeper.

## Connexion à Beeper

1. Dans Beeper Desktop, active l’API locale dans **Paramètres → Intégrations**.
2. Dans MSN Revival, sélectionne **Autoriser dans Beeper**.
3. Approuve l’accès sur la page de Beeper. La fenêtre MSN reste ouverte et charge ensuite les conversations.

L’autorisation est conservée après fermeture de MSN Revival, redémarrage du serveur ou redémarrage du PC. Sous Windows, la clé est chiffrée avec DPAPI pour le compte Windows et enregistrée dans `%LOCALAPPDATA%\MSN Revival\beeper-auth.json`. Sur les autres systèmes, le fichier est privé au compte utilisateur (permissions `0600`). La clé reste côté serveur et n’est pas fournie au navigateur. **Déconnecter** efface la clé enregistrée. Si Beeper est temporairement indisponible, MSN Revival conserve l’autorisation et réessaie.

## Développement

Le serveur n’utilise que les modules intégrés à Node.js ; aucune dépendance npm tierce n’est requise.

```sh
npm run check       # Vérifier la syntaxe JavaScript
npm test            # Tests du serveur et des fonctions média
npm run test:browser # Vérification dans un navigateur Edge isolé
```

`server.mjs` fournit le serveur local et relaie les requêtes autorisées à l’API Beeper. `client.js`, `index.html` et `styles.css` construisent l’interface. Les métadonnées et le rendu des médias sont partagés dans `media.mjs` et `media-server.mjs`.

## Limites

- Beeper Desktop doit fonctionner pour que son API locale soit accessible. L’historique qu’il expose peut dépendre de l’indexation des messages et des possibilités du réseau source.
- Les aperçus et la lecture de médias dépendent du contenu renvoyé par Beeper et des codecs du navigateur. L’application ne contourne pas les restrictions d’accès de services tiers.
- Les messages restent soumis aux capacités de chaque réseau. Un Wizz n’est qu’une animation locale.
- `msn-revival-beeper.css` est un essai de thème CSS pour personnaliser Beeper Desktop ; il n’est pas nécessaire au frontend MSN Revival.

## Documentation

Voir [GUIDE.md](GUIDE.md) pour le détail des commandes et de l’interface. Documentation Beeper : [API locale](https://developers.beeper.com/desktop-api/) et [autorisation OAuth](https://developers.beeper.com/desktop-api/auth/).
