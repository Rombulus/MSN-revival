# MSN Revival connecté à Beeper

## Ouvrir le client

Double-clique sur **Lancer-MSN.cmd**. Node.js 22 ou plus récent doit être installé. Le lanceur démarre un serveur sur `127.0.0.1:4173` et ouvre une fenêtre sans barre d’adresse avec Microsoft Edge si disponible. Tu peux aussi utiliser `npm start` puis ouvrir `http://127.0.0.1:4173` dans un navigateur.

## Connecter les vraies conversations

1. Garde Beeper Desktop ouvert. Dans **Paramètres → Intégrations**, active son API locale.
2. Dans MSN Revival, clique sur **Autoriser dans Beeper**.
3. Sur la page locale de Beeper, approuve l’accès de **MSN Revival**. Tu reviens ensuite au client MSN.

La fenêtre affiche alors les conversations accessibles par Beeper. **Contacts** ou `Ctrl+K` permet de rechercher une conversation. Le champ **À :** permet aussi de changer de destinataire. Les messages sont actualisés toutes les quatre secondes lorsque la fenêtre est visible. L’historique plus ancien se charge par le bouton au-dessus des messages.

La liste Contacts reprend une présentation MSN compacte : groupes repliables, noms triés, conversation sélectionnée sur fond bleu clair et logo du réseau à gauche de chaque nom. Les étiquettes Beeper servent de groupes ; les favoris sont regroupés en tête. Les conversations sans étiquette apparaissent dans Contacts ou Groupes. Les nombres entre parenthèses sont des totaux de conversations, sans statut de présence inventé. La recherche porte sur le nom, le réseau et le groupe, et accepte les noms sans accents.

Les deux cadres de photos sont carrés : interlocuteur en haut, ton profil du réseau de la conversation en bas. Si ce réseau ne fournit pas ta photo, le client essaie ton autre profil personnel disponible dans Beeper. Une silhouette remplace les photos absentes. Pour un groupe, la photo du groupe apparaît en haut.

L’autorisation reste en mémoire dans le serveur local et le navigateur reçoit seulement un cookie de session. Aucun token n’est écrit par ce client sur disque. Après l’arrêt du serveur, reconnecte-toi. Le bouton **Déconnecter** dans les réglages retire l’accès de la session. L’autorisation de l’application peut aussi être révoquée depuis Beeper.

## Ce qui fonctionne

Conversations multi-réseaux, historique, envoi de texte et fichiers, brouillons par conversation pendant la session, portraits, recherche, pagination, sons synthétisés et animation locale du Wizz.

Les photos reçues s’affichent en vignettes. Un clic ouvre la visionneuse, avec zoom, navigation entre photos et téléchargement. Les vidéos et messages audio utilisent les lecteurs du navigateur et permettent d’avancer dans le média. La synchronisation conserve les lecteurs en cours de lecture.

Les liens sont cliquables et les aperçus fournis par Beeper apparaissent sous les messages. Les liens Instagram peuvent afficher leur vignette, titre et description quand Beeper les expose. Si le réseau ne fournit pas d’aperçu ou si un Reel demande une authentification, le bouton ouvre Instagram. Le client ne contourne pas les restrictions d’accès et ne récupère pas les publications privées par extraction de pages.

Pour envoyer une pièce jointe, utilise **Envoyer fichiers** ou le bouton d’image dans la barre de saisie, puis clique **Envoyer**. Un seul fichier est joint à la fois, avec une limite locale de 100 Mo. La préparation affiche sa progression. Les restrictions propres à chaque réseau restent applicables. Les formats photo/vidéo/audio lisibles dépendent des codecs du navigateur ; le téléchargement reste disponible si un format ne peut pas être lu.

Au-dessus du texte, le micro démarre un enregistrement (autorisation du navigateur nécessaire). Clique de nouveau pour arrêter, ou utilise **Annuler**. Le vocal peut être réécouté puis envoyé explicitement avec **Envoyer**, comme pièce jointe audio. Il est limité à cinq minutes. Changer de conversation annule l’enregistrement en cours pour éviter de l’envoyer au mauvais destinataire. Le bouton d’emoji ouvre une petite sélection insérable dans le texte.

Le Wizz ne secoue que ta fenêtre : les réseaux actuels ne transmettent pas l’ancien événement MSN. Les icônes et personnages sont des dessins vectoriels recréés pour ce projet, et les sons sont synthétisés.

## Vérifications

`npm run check` vérifie la syntaxe. `npm test` vérifie OAuth, les sessions, les portraits, le proxy média, les lectures partielles, les liens et les uploads avec un serveur simulé. `npm run test:browser` vérifie aussi les photos agrandies, le choix d’une pièce jointe, les liens Instagram et la continuité de lecture audio/vidéo dans un Edge isolé. Le clip de test est généré localement. Ces tests ne contactent ni tes conversations ni tes destinataires réels.

Documentation officielle : [API locale](https://developers.beeper.com/desktop-api/) et [autorisation OAuth](https://developers.beeper.com/desktop-api/auth/).
