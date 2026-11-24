# Décisions hors PRD

Chaque décision non couverte par `docs/PRD.md` est notée ici, avec l'option la plus prudente pour les données.

## M1

### D1. Interface servie par un protocole `app://` plutôt que `file://`

En production, la page est chargée depuis `app://macsweep/index.html`. Le gestionnaire de protocole ne sert que les fichiers situés sous le dossier de l'interface compilée (`%2F` et octets nuls refusés) et ajoute la CSP en en-tête. Il lit les fichiers avec `readFile` plutôt que `net.fetch`, pour que le filtre réseau de la session reste fermé à `file://`. C'est la pratique recommandée par Electron : une page `file://` a des droits étendus sur le système de fichiers. Le fusible `GrantFileProtocolExtraPrivileges` est aussi désactivé.

### D2. CSP différente en développement

Vite injecte des scripts et styles en ligne pour le rechargement à chaud et se connecte en WebSocket à `localhost`. En dev seulement, la CSP autorise donc `'unsafe-inline'` et `ws://localhost:*`. La CSP de production n'a ni `unsafe-inline`, ni `unsafe-eval`, et `connect-src 'none'`. Un test unitaire et un test de bout en bout vérifient la version de production.

### D3. Filtre réseau dans la session

Toute requête qui ne vise ni `app://macsweep`, ni le serveur Vite local en dev, ni `data:`/`blob:`/`devtools:` est annulée par `webRequest.onBeforeRequest`. Navigation, nouvelles fenêtres, `<webview>` et demandes de permission (caméra, notifications…) sont refusées.

### D4. Expéditeur IPC vérifié

Chaque handler IPC refuse un message qui ne vient pas du cadre principal de notre page (`app://macsweep`, ou serveur Vite en dev), puis valide ses arguments avant d'agir.

### D5. Interdictions vérifiées par ESLint

ESLint refuse `fs.rm`, `rmSync`, `rmdir`, `unlink`, `rimraf`, `del`, `fs-extra`, ainsi que `child_process.exec` (shell). Seul `src/main/trash-empty.ts` (vidage de la Corbeille, M4) sera exempté. Dans `src/renderer`, tout import de `node:*`, `electron`, `fs`, `path`, `os` ou de `src/main` est refusé.

### D6. DevTools désactivés dans l'app installée

`devTools` n'est actif que hors paquet (`npm start`).

### D7. Tailles en base 1000

Les tailles sont affichées en base 1000 (1 Go = 10⁹ octets), comme le Finder, pour que les chiffres correspondent à ce que macOS affiche.

### D8. Cibles de fabrication macOS seulement

Les makers Windows et Linux du modèle Forge sont retirés. `npm run make` produit un `.dmg` et un `.zip` pour macOS.

### D9. Niveaux « interdit » et « protégé » (validé avec l'utilisateur)

Le PRD place `~/Documents`, `~/Desktop` et `~/Pictures` dans la liste noire absolue, mais autorise la suppression de gros fichiers et de doublons qui s'y trouvent avec une confirmation supplémentaire. `guard.ts` aura donc deux niveaux : **interdit** (jamais) et **protégé** (refusé sauf drapeau `confirmProtected: true`, envoyé seulement après une seconde boîte de dialogue en M5). Jusqu'en M5, « protégé » se comporte comme « interdit ».

### D10. `npm test` inclut les tests de bout en bout

`npm test` enchaîne la vérification des types, Vitest puis Playwright (qui empaquette l'app avant). `npm run test:unit` lance Vitest seul pour une boucle rapide.

### D11. Alerte `npm audit` sur `image-size` acceptée

`npm audit` signale une faille (boucle infinie dans l'analyse des fichiers ICNS) dans `image-size`, utilisé seulement par l'outil de fabrication du `.dmg` (`@electron-forge/maker-dmg` → `appdmg`). Ce paquet n'est pas embarqué dans l'app et ne lit que nos propres icônes au moment de `npm run make`. Aucun correctif n'existe pour l'instant ; on revérifiera en M6.

## M2

### D12. Ordre de vérification de `guard.ts`

Pour chaque chemin, `checkTrashable` vérifie dans l'ordre :

1. L'entrée est une chaîne absolue de moins de 4 096 caractères, sans octet nul et **sans segment `.` ni `..`**. Les chemins issus d'un scan sont toujours canoniques : un `..` signale un appel forgé, il est refusé plutôt que normalisé.
2. Un premier contrôle lexical sur le chemin reçu, qui arrête la liste noire avant tout accès disque.
3. Le contrôle qui fait foi, sur l'emplacement réel de l'élément : dossier parent passé par `realpath`, élément lui-même non suivi. C'est ce chemin qui est rendu et qui sera passé à `shell.trashItem`.
4. Pour un lien symbolique, la cible doit aussi respecter toutes les règles. Un lien qui sort de la racine, vise la liste noire, la racine elle-même ou rien du tout (lien cassé) est refusé.

Les comparaisons ignorent la casse et la forme Unicode (NFC), comme APFS.

### D13. Ce que la liste noire couvre en plus du PRD

- Un dossier qui **contient** un élément de la liste noire est refusé (mettre `~/Library` à la Corbeille emporterait `Keychains`).
- Un dossier qui contient directement `.git` (racine d'un dépôt) est refusé, en plus de tout chemin qui traverse un `.git`.
- `~/.Trash` et son contenu ne passent jamais par `trashItem` : la Corbeille ne se vide que par `trash:empty` (M4).
- `~/Documents`, `~/Desktop` et `~/Pictures` eux-mêmes sont toujours refusés, même avec la confirmation du niveau « protégé » (D9), qui ne vaut que pour leur contenu.
- La racine elle-même est toujours refusée, et une racine égale à `/` empêche l'app de démarrer.

### D14. Racine de test injectable, jamais dans l'app installée

`MACSWEEP_TEST_ROOT` remplace le dossier utilisateur seulement si l'app n'est pas empaquetée **et** si le dossier existe sous `os.tmpdir()`. Une valeur invalide empêche l'app de démarrer, plutôt que de retomber en silence sur le vrai dossier utilisateur. Tous les tests de bout en bout l'utilisent.

### D15. Parcours synchrone dans le worker, annulation par mémoire partagée

Le PRD prévoit `fs/promises`. Le parcours utilise `opendirSync` et `lstatSync` dans le `worker_thread` : l'interface n'est jamais bloquée (autre thread), et c'est plusieurs fois plus rapide que d'attendre chaque `lstat`. Mesure : environ 147 000 entrées par seconde, soit 1 million de fichiers en à peu près 7 s, cache disque chaud. Comme le worker ne lit pas ses messages pendant un parcours synchrone, l'annulation passe par un `SharedArrayBuffer` lu toutes les 256 entrées. Si le worker ne s'est pas arrêté après 500 ms, il est terminé de force : l'annulation prend toujours moins d'une seconde.

### D16. Tailles calculées comme `du`

La taille d'un élément est la somme des blocs alloués (`blocks × 512`), et non la taille logique. Un fichier à plusieurs liens durs n'est compté qu'une fois par scan. Un lien symbolique compte pour sa propre taille, sans jamais être suivi.

### D17. Granularité des éléments

- Caches, logs, DerivedData, archives, Support des appareils, cache Homebrew, Corbeille : chaque entrée directe du dossier est un élément.
- Caches npm/yarn/pnpm, Gradle et Maven : chaque dossier de cache entier est un élément.
- Simulateurs : le dossier `CoreSimulator/Devices/<UDID>` de chaque simulateur indisponible. L'UDID est validé (format UUID) avant d'être utilisé dans un chemin.
- Une entrée qui est un lien symbolique n'est jamais listée comme élément.
- Les dossiers déjà couverts par une autre catégorie (`~/Library/Caches/Yarn`, le cache Homebrew) sont retirés des « Caches utilisateur » pour ne pas compter deux fois les mêmes octets. Le cache de MacSweep lui-même est ignoré.

### D18. Âge d'un dossier = modification la plus récente à l'intérieur

Pour `node_modules` (30 jours) et les installeurs (14 jours), l'âge est calculé à partir de la modification la plus récente de tout le contenu, et non de la date du dossier lui-même, qui ne change que quand on ajoute ou retire une entrée directe. Un `node_modules` touché la semaine dernière reste donc hors de la liste.

### D19. Outils externes

- `brew`, `xcode-select` et `xcrun` sont appelés par leur chemin absolu, avec `execFile`, des arguments fixes, un environnement minimal et un délai de 15 s.
- `xcode-select -p` est vérifié avant `xcrun`, qui ouvrirait sinon une fenêtre d'installation des outils développeur.
- Un outil absent ou en échec masque sa catégorie sans faire échouer le scan.
- Toute source qui sort de la racine (par exemple `brew --cache` configuré ailleurs) est ignorée.

### D20. Un seul scan à la fois

Un second `scan:start` pendant un scan est refusé plutôt que mis en file. Pendant un scan, l'interface remplace « Lancer le scan » par « Annuler ».

### D21. Portée de M2

- Les moteurs « Gros fichiers » et « Doublons » arrivent avec leurs écrans en M5.
- La catégorie `node_modules` est prête, mais reste masquée tant qu'aucun dossier de projets n'est réglé (M5).
- La détection des apps ouvertes (règle 6) se fait à la revue et au nettoyage (M3 et M4).
- Le chargement du worker depuis l'archive `app.asar` de l'app installée sera vérifié en M6 : les tests de bout en bout lancent l'app compilée hors archive.

## M3

### D22. Détection des apps ouvertes (règle 6)

Après chaque scan, le processus principal lit `lsappinfo list` (nom et `bundleID` de chaque app ouverte) et marque les éléments concernés. L'interface les affiche « App ouverte (Nom) : fermez-la d'abord », décochés, avec une case désactivée. Un élément est rattaché à une app quand :

- Caches et Logs : le nom du dossier est le nom de l'app, son `bundleID`, un sous-identifiant (`com.google.Chrome.helper`), ou le premier mot du nom de l'app (`Google` pour Google Chrome).
- DerivedData, Archives et Support des appareils : Xcode est ouvert.
- Simulateurs : l'app Simulator est ouverte.

Le rapprochement penche vers le signalement : un faux positif laisse seulement un élément décoché. Si `lsappinfo` échoue, le résultat est envoyé sans marquage ; l'état des apps sera revérifié au moment du nettoyage (M4).

### D23. La Corbeille n'est jamais cochable dans la revue

Ses éléments sont affichés, mais sans case active : la Corbeille se vide en entier, de façon définitive, par une action à part avec double confirmation (M4).

### D24. Portée de « Tout sélectionner » et « Ne rien sélectionner »

Les deux boutons agissent sur les éléments qui correspondent à la recherche en cours, toutes catégories confondues. Sans recherche, ils agissent sur tout. Les éléments non cochables (app ouverte, Corbeille) ne sont jamais cochés.

### D25. Données séparées pour les tests

Quand `MACSWEEP_TEST_ROOT` est actif (app non empaquetée), l'app utilise un dossier de données temporaire. Les tests ne partagent ainsi ni le verrou d'instance unique, ni, à partir de M4, les réglages et l'historique d'une instance ouverte par l'utilisateur.

### D26. Affichage des chemins

Dans la revue, chaque élément montre son nom en clair et son dossier en dessous, la racine abrégée en `~`. Le chemin complet reste visible au survol.

### D27. Fenêtre vide au premier chargement en développement

Lancée par `npm start`, l'app ouvrait parfois une fenêtre vide : la page et tous ses modules étaient téléchargés depuis le serveur Vite, mais aucun module n'était exécuté, sans la moindre erreur. Un rechargement corrige toujours. Le même code lancé par Playwright s'affiche normalement, et l'app empaquetée (protocole `app://`) n'est pas concernée.

En développement seulement, si `#root` est encore vide 1,5 s après le premier chargement, l'app recharge la page une fois et l'écrit dans le terminal (`[dev] page vide au premier chargement`). En développement toujours, les échecs de chargement, les erreurs HTTP et les erreurs ou avertissements de la console de la page sont recopiés dans le terminal de `npm start`.

La directive `frame-ancestors` est retirée de la balise meta CSP, où les navigateurs l'ignorent ; elle reste dans l'en-tête HTTP du protocole `app://`.

## Périmètre élargi (validé avec l'utilisateur le 24 novembre 2026)

### D28. Un outil de type CleanMyMac, la suppression restant limitée à `~`

L'utilisateur veut voir l'ensemble du Mac et choisir quoi supprimer par catégorie. Ce qui change par rapport au PRD :

- **Affichage** : une vue « Exploration » montre l'occupation de **tout le disque**, en lecture seule. Les liens symboliques ne sont jamais suivis, et les dossiers refusés sont comptés comme ailleurs.
- **Suppression** : inchangée. Seuls les chemins sous le dossier utilisateur peuvent aller à la Corbeille, sans `sudo` (règles 1, 2, 4 et 5 du PRD), à l'exception étroite de D29.
- **Nouveaux modules** : carte du disque (avancée de v1.1), désinstallateur (avancé de v2), gros fichiers sur tout `~`, et catégories supplémentaires.

Nouvelles catégories, toutes sous `~` :

| Catégorie                              | Chemins                                                                                   | Risque                | Cochée par défaut                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------- | ------------------------------------- |
| Mises à jour iOS téléchargées          | `~/Library/iTunes/*Software Updates`                                                      | Faible                | Oui                                   |
| Caches des navigateurs                 | caches Safari, Chrome, Firefox, sortis des caches génériques                              | Faible                | Oui                                   |
| Caches Xcode Previews et CoreSimulator | `~/Library/Developer/Xcode/UserData/Previews`, `~/Library/Developer/CoreSimulator/Caches` | Faible                | Oui                                   |
| Caches pip, cargo, go                  | `~/Library/Caches/pip`, `~/.cargo/registry`, `~/go/pkg/mod`, `~/.cache`                   | Moyen                 | Non                                   |
| Pièces jointes Mail téléchargées       | `~/Library/Containers/com.apple.mail/Data/Library/Mail Downloads`                         | Moyen                 | Non                                   |
| Sauvegardes iPhone et iPad             | `~/Library/Application Support/MobileSync/Backup`                                         | Élevé                 | Non, avec confirmation supplémentaire |
| Image disque Docker                    | `~/Library/Containers/com.docker.docker/Data/vms`                                         | Information seulement | Jamais cochable                       |

Jalons révisés :

1. **M4. Nettoyage** : inchangé (F4, mode simulation, Corbeille, journal, historique).
2. **M5. Gros fichiers, doublons, réglages et nouvelles catégories** : F5 sur tout `~`, F6, F7 et le tableau ci-dessus.
3. **M6. Exploration du disque** : carte navigable de tout le disque, en lecture seule, avec suppression proposée seulement sous `~`.
4. **M7. Désinstallateur** : une app et ses restes (caches, préférences, Application Support, conteneurs, agents de connexion de l'utilisateur), selon D29.
5. **M8. Finition** : l'ancien M6 (Accès complet au disque, mode sombre, icône, `.dmg` signé en ad hoc, README).

### D29. Exception pour désinstaller une app de `/Applications`

`/Applications` reste dans la liste noire, avec une seule exception, réservée au désinstallateur (M7) : un bundle `.app` situé **directement** dans `/Applications` peut aller à la Corbeille si toutes ces conditions sont réunies :

- il appartient à l'utilisateur courant (propriétaire du bundle) et n'est ni une app Apple (`com.apple.*`) ni une app de l'App Store (présence de `Contents/_MASReceipt`) ;
- il n'est pas en cours d'exécution ;
- l'utilisateur confirme explicitement, dans un dialogue qui nomme l'app ;
- tout passe par `shell.trashItem`, sans `sudo`.

Cette exception vit dans `guard.ts`, derrière un drapeau dédié que seul le canal de désinstallation peut transmettre. Elle sera couverte par des tests (app d'un autre propriétaire, app Apple, sous-dossier de `/Applications`, lien symbolique vers une app). Tout le reste de `/Applications` reste refusé.

## M4

### D30. On ne nettoie que ce que MacSweep a trouvé lui-même

Le processus principal garde la liste des éléments du dernier scan (chemin, catégorie, taille). `clean:execute` refuse tout chemin absent de cette liste (`not-scanned`), même s'il passe `guard.ts`. Un appel forgé ne peut donc viser qu'un élément déjà proposé à l'utilisateur. Un élément nettoyé est retiré de la liste. La taille libérée affichée est celle mesurée par le scan.

### D31. Le réglage de simulation l'emporte

La simulation est un réglage enregistré (actif au premier lancement, règle 7). `clean:execute` et `trash:empty` simulent si le réglage **ou** la requête le demande : une requête ne peut pas, seule, désactiver la simulation.

### D32. Corbeille de test

En mode test seulement (`MACSWEEP_TEST_ROOT`, app non empaquetée), les éléments sont déplacés dans `<racine de test>/.Trash` au lieu de la Corbeille macOS, pour qu'un test ne remplisse jamais la vraie Corbeille. L'app utilise toujours `shell.trashItem`. Le critère « remis en place depuis le Finder » sera vérifié à la main en M8, sur l'app installée.

### D33. Revérification des apps ouvertes au nettoyage

La règle 6 est revérifiée au moment du nettoyage, pas seulement après le scan. Si la liste des apps ouvertes est illisible, les éléments des catégories liées à une app (caches, logs, Xcode, simulateurs) sont refusés (`app-check-failed`). Les autres catégories sont traitées normalement.

### D34. Vidage de la Corbeille

- Seule la Corbeille du dossier utilisateur (`~/.Trash`) est vidée, pas celles des autres disques.
- Le mot « VIDER » est vérifié deux fois : dans l'interface (bouton désactivé sinon) et dans le processus principal.
- Une Corbeille qui est un lien symbolique est refusée. À l'intérieur, `fs.rm` supprime les liens sans suivre leur cible.
- Sans Accès complet au disque, la Corbeille est illisible : le rapport le dit, et rien n'est supprimé.
- `src/main/trash-empty.ts` est le seul fichier où ESLint autorise `fs.rm`.

### D35. Historique et journal

- L'historique (electron-store, au plus 500 entrées) n'enregistre que les nettoyages et les vidages réels, jamais les simulations.
- Le journal écrit une ligne JSON par élément déplacé ou supprimé (date, action, chemin d'origine, taille) dans `<données de l'app>/logs/macsweep-AAAA-MM-JJ.jsonl`, soit `~/Library/Application Support/MacSweep/logs/` pour l'app installée.

### D36. Une opération à la fois

Un nettoyage ou un vidage est refusé pendant un scan, et un scan est refusé pendant un nettoyage. Le dialogue de nettoyage ne se ferme pas pendant l'opération.

### D37. Signature de `clean:execute`

Conforme au PRD (`clean:execute(paths, { dryRun })`). Le rapport donne en plus, pour chaque élément traité, sa catégorie (utilisée par l'historique) et, pour chaque échec, la raison du refus.

### D38. Optimisation non retenue pour l'instant

Le PRD suggère de mettre à la Corbeille le dossier parent quand toute une catégorie est cochée. Ce n'est pas fait : chaque élément passe par `guard.ts` un par un, ce qui reste plus sûr. À revoir si la mise à la Corbeille de milliers d'éléments s'avère lente.

## M5

### D39. Gros fichiers : où MacSweep cherche

Les 200 plus gros fichiers de tout le dossier utilisateur, au-dessus du seuil réglé (500 Mo par défaut). Sont exclus :

- `~/Library` : données des apps, couvertes par les catégories ;
- les dossiers cachés (nom commençant par un point) ;
- l'intérieur des **paquets** que macOS montre comme un seul fichier (`.app`, bibliothèques Photos, Musique et TV, projets Final Cut, Logic, GarageBand, machines virtuelles, documents Pages, Numbers et Keynote…), car supprimer un fichier isolé à l'intérieur les abîmerait ;
- la liste noire et les exclusions.

La taille retenue est l'espace réellement occupé (blocs alloués), comme partout ailleurs.

### D40. Doublons

- Les trois passes du PRD : même taille, mêmes 64 premiers Ko (SHA-256), puis SHA-256 complet.
- Les fichiers de moins de 1 Mo (réglable) sont ignorés, ainsi que les dossiers cachés et l'intérieur des paquets.
- Les liens durs sont un seul et même fichier, jamais des copies. Pour un même fichier, on garde le chemin qui vient en premier dans l'ordre alphabétique.
- Dans chaque groupe, le fichier le plus ancien est l'original. Sa case reste désactivée tant que l'utilisateur ne clique pas sur « Déverrouiller ».
- **Garde-fou dans le processus principal** : quelle que soit la requête, la dernière copie restante d'un groupe est refusée (`last-copy`), en simulation comme en nettoyage réel.
- Le total récupérable compte toutes les copies sauf l'original. Il peut surestimer le gain pour des copies APFS (clones), qui partagent leurs blocs : MacSweep ne sait pas les détecter.
- Les dossiers à analyser sont choisis par l'utilisateur ; aucun par défaut.

### D41. Doubles confirmations

Le dialogue de nettoyage ajoute une case à cocher obligatoire :

- pour tout élément situé dans Documents, Bureau ou Images (niveau « protégé » de D9), envoyée comme `confirmProtected` ;
- pour toute catégorie à risque élevé (gros fichiers, doublons, sauvegardes d'appareils), envoyée comme `confirmHighRisk`.

Le processus principal revérifie les deux : sans elles, ces éléments sont refusés (`protected`, `needs-confirmation`).

### D42. Image disque Docker

Affichée pour expliquer où part l'espace, jamais cochable, et refusée par le nettoyeur (`info-only`) : la supprimer effacerait toutes les images et conteneurs. On la gère depuis Docker.

### D43. Réglages

- Valeurs par défaut du PRD : seuil de 500 Mo, installeurs de plus de 14 jours, `node_modules` de plus de 30 jours, doublons à partir de 1 Mo.
- Chaque champ est validé (type, bornes, champs inconnus refusés).
- Chaque dossier choisi (exclusions, projets, doublons) passe par `guard.ts` : il doit exister et se trouver dans le dossier utilisateur. Il est enregistré par son chemin réel.
- Le choix de dossier se fait avec le sélecteur natif de macOS, ouvert sur le dossier utilisateur.
- Les réglages s'appliquent au scan suivant. Les **exclusions** s'appliquent aussi au nettoyage : un élément trouvé avant l'ajout d'une exclusion est refusé (`excluded`).

### D44. Nouvelles catégories et apps ouvertes

Les caches de navigateurs, les caches Xcode et les pièces jointes Mail sont rattachés à leur app pour la règle 6 : Safari, Chrome, Firefox, Edge, Brave et Arc ; Xcode ; Mail. Les caches de navigateurs, `pip` et les autres dossiers déjà couverts par une catégorie sont retirés des caches utilisateur, pour ne pas compter deux fois les mêmes octets.
