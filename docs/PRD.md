# PRD – MacSweep, nettoyeur de Mac (Electron)

Nov 24, 2026 · @Chakib

## Résumé et objectifs

MacSweep est une app de bureau macOS construite avec Electron. Elle scanne le Mac, montre ce qui occupe l'espace disque et retire les fichiers encombrants en toute sécurité, en les plaçant dans la Corbeille. Elle tourne en local, sans compte, sans réseau et sans licence Apple Developer.

**Objectifs de la version 1.0**

1. Libérer de l'espace : identifier au moins 90 % de l'espace récupérable dans les catégories couvertes, comparé à un scan manuel avec `du`.
2. Zéro perte de données : aucun fichier n'est supprimé sans validation explicite, et tout passe par la Corbeille par défaut.
3. Rapidité : un scan complet du dossier utilisateur (environ 200 Go) en moins de 60 secondes sur un MacBook Air M3.
4. Transparence : pour chaque élément, l'app indique le chemin, la taille, la date de dernière modification et pourquoi il est jugé supprimable.

**Hors objectifs** : optimisation de la RAM, antivirus, désinstallation d'apps avec leurs fichiers résiduels (prévue en v2), synchronisation cloud.

## Utilisateur cible et périmètre

L'utilisateur principal est un développeur ou un étudiant sur un Mac Apple Silicon avec un SSD de 256 à 512 Go qui se remplit vite. Il installe Xcode, Node, Homebrew et des simulateurs, et veut savoir précisément ce qu'il supprime.

| Élément | v1.0 | Plus tard |
| --- | --- | --- |
| Scan par catégories prédéfinies | Oui |  |
| Explorateur des gros fichiers | Oui |  |
| Détection de doublons | Oui |  |
| Mise à la Corbeille avec revue | Oui |  |
| Liste d'exclusions | Oui |  |
| Historique des nettoyages | Oui |  |
| Carte visuelle du disque (treemap) |  | v1.1 |
| Désinstallation complète d'apps |  | v2 |
| Nettoyage planifié automatique |  | v2 |
| Prise en charge de Windows et Linux |  | Non prévu |

## Fonctionnalités détaillées

L'app scanne des catégories prédéfinies. Chacune a un niveau de risque qui détermine si elle est cochée par défaut dans l'écran de revue.

### F1. Catégories de scan

| Catégorie | Chemins scannés | Risque | Cochée par défaut |
| --- | --- | --- | --- |
| Caches utilisateur | `~/Library/Caches/*` | Faible | Oui |
| Logs utilisateur | `~/Library/Logs/*` | Faible | Oui |
| Xcode DerivedData | `~/Library/Developer/Xcode/DerivedData/*` | Faible | Oui |
| Archives Xcode | `~/Library/Developer/Xcode/Archives/*` | Moyen | Non |
| Simulateurs iOS inutilisés | via `xcrun simctl list` (état "unavailable") | Faible | Oui |
| Support des appareils iOS | `~/Library/Developer/Xcode/iOS DeviceSupport/*` | Moyen | Non |
| Caches npm, yarn, pnpm | `~/.npm/_cacache`, `~/Library/Caches/Yarn`, `~/Library/pnpm/store` | Faible | Oui |
| Cache Homebrew | sortie de `brew --cache` | Faible | Oui |
| Caches Gradle et Maven | `~/.gradle/caches`, `~/.m2/repository` | Moyen | Non |
| Dossiers `node_modules` | dans les dossiers de projets choisis, non modifiés depuis plus de 30 jours | Moyen | Non |
| Installeurs téléchargés | `~/Downloads/*.dmg`, `*.pkg`, `*.zip` de plus de 14 jours | Moyen | Non |
| Gros fichiers | tout le dossier utilisateur, seuil réglable (500 Mo par défaut) | Élevé | Non |
| Doublons | dossiers choisis par l'utilisateur | Élevé | Non |
| Corbeille | `~/.Trash` | Faible | Non (vidage définitif) |

Une catégorie dont l'outil n'est pas installé (Xcode, Homebrew) est masquée sans erreur.

### F2. Tableau de bord

- Espace disque total, utilisé et libre, lu avec `statfs` ou `df`.
- Bouton « Lancer le scan », avec progression en direct par catégorie : fichiers parcourus, taille trouvée, dossier en cours.
- Bouton d'annulation qui arrête le scan en moins d'une seconde.
- Résultat : liste des catégories triées par taille, avec un graphique en barres.

### F3. Revue avant nettoyage

- Chaque catégorie se déplie en liste d'éléments : chemin, taille, date de modification, case à cocher.
- Recherche, tri par taille ou par date, sélection de tout ou de rien.
- « Afficher dans le Finder » pour chaque élément (`shell.showItemInFolder`).
- Total sélectionné affiché en permanence en bas de l'écran.
- Liste virtualisée : 100 000 lignes restent fluides.

### F4. Nettoyage

- Une fenêtre de confirmation récapitule le nombre d'éléments, la taille et la destination (Corbeille).
- Déplacement vers la Corbeille avec `shell.trashItem`, élément par élément, avec barre de progression.
- Un échec (fichier verrouillé, permission refusée) est sauté et listé dans un rapport final.
- Seul le vidage de la Corbeille est définitif. Il demande une seconde confirmation où l'utilisateur doit taper « VIDER ».

### F5. Gros fichiers

- Les 200 plus gros fichiers du dossier utilisateur, au-dessus du seuil.
- Filtres par type : vidéos, images disque, archives, autres.

### F6. Doublons

- Algorithme en trois passes : regroupement par taille, puis hash partiel des premiers 64 Ko, puis hash SHA-256 complet.
- Les fichiers de moins de 1 Mo sont ignorés par défaut.
- Dans chaque groupe, le fichier le plus ancien est gardé et ne peut pas être coché sans action explicite.

### F7. Réglages et historique

- Liste d'exclusions : chemins que l'app ne touche jamais.
- Seuil des gros fichiers, âge minimal des téléchargements et des `node_modules`, dossiers de projets à scanner.
- Historique : date, catégories, taille libérée, stocké dans un fichier JSON local.

## Règles de sécurité

La sécurité passe avant l'espace libéré : en cas de doute, l'app ne touche pas au fichier. Ces règles sont appliquées dans le processus principal, pas seulement dans l'interface.

1. **Liste blanche de racines** : l'app ne supprime que des chemins situés sous le dossier utilisateur (`os.homedir()`).
2. **Liste noire absolue**, jamais touchée même si l'utilisateur la coche : `/System`, `/usr`, `/bin`, `/sbin`, `/Library`, `/Applications`, `~/Documents`, `~/Desktop`, `~/Pictures`, `~/Library/Mobile Documents` (iCloud), `~/Library/Keychains`, `~/Library/Mail`, `~/Library/Messages`, `~/Library/Photos`, `~/.ssh`, `~/.gnupg`, et tout dossier `.git`. Les gros fichiers et les doublons peuvent être signalés dans Documents ou Bureau, mais leur suppression demande une confirmation supplémentaire.
3. **Validation du chemin** avant toute action : `fs.realpath` pour résoudre les liens symboliques, puis vérification que le chemin résolu respecte les règles 1 et 2. Les liens symboliques ne sont jamais suivis pendant le scan.
4. **Corbeille par défaut** : aucun `fs.rm` dans le code, sauf pour vider la Corbeille après double confirmation.
5. **Pas d'élévation de privilèges** : pas de `sudo`, pas d'AppleScript avec droits administrateur.
6. **Apps ouvertes** : un cache appartenant à une app en cours d'exécution (détectée avec `ps` ou `lsappinfo`) est signalé « app ouverte, fermez-la d'abord » et décoché.
7. **Mode simulation** : une option « Dry run » affiche ce qui serait supprimé sans rien déplacer. Elle est activée par défaut au premier lancement.
8. **Journal** : chaque déplacement est écrit dans `~/Library/Application Support/MacSweep/logs/` (chemin d'origine, taille, date).

## Architecture technique

L'app suit le modèle sécurisé d'Electron : le processus principal fait tout le travail sur le disque, l'interface n'a aucun accès direct à Node, et les deux communiquent via un pont IPC typé.

| Couche | Choix |
| --- | --- |
| Langage | TypeScript (mode strict) |
| Outillage | Electron Forge avec le template Vite + TypeScript |
| Interface | React 18, Tailwind CSS, `@tanstack/react-virtual` pour les longues listes |
| Graphiques | Recharts |
| Scan | Node `fs/promises` (`opendir`, `lstat`) dans un `worker_threads` pour ne pas bloquer l'app |
| Hash des doublons | `crypto` (SHA-256), en flux |
| Stockage local | `electron-store` (réglages, exclusions, historique) |
| Tests | Vitest (logique de scan et de sécurité), Playwright pour Electron (parcours de bout en bout) |
| Qualité | ESLint, Prettier |

**Réglages de sécurité Electron** : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, Content Security Policy stricte, aucun contenu distant chargé.

**Canaux IPC**

- `scan:start(options)` renvoie un identifiant de scan ; `scan:progress` et `scan:done` sont des événements poussés vers l'interface ; `scan:cancel(id)`.
- `clean:execute(paths, { dryRun })` renvoie un rapport `{ moved, failed, bytesFreed }`.
- `trash:empty()` après double confirmation.
- `fs:reveal(path)`, `disk:info()`, `settings:get` et `settings:set`, `history:list()`.

**Structure du projet**

```
macsweep/
  src/
    main/
      index.ts            fenêtre, menus, cycle de vie
      ipc.ts              enregistrement des canaux
      scanner/
        worker.ts         parcours du disque (worker_threads)
        categories.ts     définition des catégories
        duplicates.ts     détection des doublons
      safety/
        guard.ts          validation des chemins (règles 1 à 3)
      cleaner.ts          mise à la Corbeille et rapport
      store.ts            réglages et historique
    preload/
      index.ts            contextBridge, API typée window.macsweep
    renderer/
      App.tsx
      pages/              Dashboard, Review, LargeFiles, Duplicates, Settings, History
      components/
    shared/
      types.ts            types partagés main / renderer
  tests/
```

## UI/UX : écrans et flux

Le parcours principal tient en quatre étapes : scanner, revoir, confirmer, voir le rapport.

1. **Premier lancement** : écran d'accueil qui explique l'Accès complet au disque, avec un bouton qui ouvre directement le bon panneau des Réglages Système. L'utilisateur peut continuer sans cet accès, en mode limité.
2. **Tableau de bord** : jauge d'espace disque, bouton de scan, puis cartes de catégories avec taille et niveau de risque.
3. **Revue** : liste dépliable par catégorie, cases à cocher, total sélectionné dans une barre fixe en bas, bouton « Nettoyer ».
4. **Confirmation puis rapport** : récapitulatif, progression, puis espace libéré et liste des échecs.

**Navigation** : barre latérale avec Tableau de bord, Gros fichiers, Doublons, Historique, Réglages.

**Style** : interface sobre inspirée de macOS, barre de titre intégrée (`titleBarStyle: 'hiddenInset'`), police système, mode clair et sombre selon le système (`nativeTheme`). Code couleur des risques : vert (faible), orange (moyen), rouge (élevé), toujours accompagné d'un libellé texte.

**Accessibilité** : navigation complète au clavier, libellés ARIA sur les cases et boutons, contraste AA.

## Exigences non fonctionnelles, permissions et distribution

L'app fonctionne entièrement hors ligne et sans licence Apple Developer : elle est signée en ad hoc et utilisée sur ton propre Mac.

| Exigence | Cible |
| --- | --- |
| Plateforme | macOS 13 et plus, Apple Silicon (arm64) en priorité |
| Durée d'un scan complet | moins de 60 s pour environ 200 Go et 1 million de fichiers |
| Mémoire pendant un scan | moins de 400 Mo |
| Réactivité de l'interface | jamais bloquée plus de 100 ms pendant un scan |
| Réseau | aucune requête sortante, aucune télémétrie |
| Langue | français par défaut, textes regroupés dans un fichier pour ajouter l'anglais |

**Accès complet au disque** : sans cet accès, certains dossiers de `~/Library` renvoient `EPERM`. L'app détecte ce cas en tentant de lire un dossier protégé (par exemple `~/Library/Safari`), affiche un bandeau explicatif et ouvre `x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`. Les dossiers refusés sont comptés et affichés, jamais ignorés en silence.

**Distribution sans licence à 99 $**

- Développement : `npm start`, aucune signature nécessaire.
- Version installée : `npm run make` produit un `.app` et un `.dmg` signés en ad hoc (`codesign --sign -`), suffisant sur Apple Silicon pour ton propre Mac.
- Après chaque nouvelle compilation, la signature change : macOS peut redemander l'Accès complet au disque. C'est normal.
- Pour partager l'app avec quelqu'un d'autre, Gatekeeper affichera un avertissement. La personne devra faire clic droit puis « Ouvrir », ou lancer `xattr -dr com.apple.quarantine MacSweep.app`. La notarisation, qui supprime cet avertissement, est la seule chose qui exige le compte payant.

## Jalons, critères d'acceptation et risques

Le développement se fait en six jalons, chacun livrable et testable avant de passer au suivant.

1. **M1. Socle** : projet Electron Forge + Vite + React + TypeScript, fenêtre, pont IPC typé, réglages de sécurité Electron, tests qui passent.
2. **M2. Moteur de scan et sécurité** : worker de scan, catégories F1, module `guard.ts` couvert par des tests unitaires (liens symboliques, liste noire, chemins hors du dossier utilisateur).
3. **M3. Tableau de bord et revue** : écrans F2 et F3, progression en direct, annulation, liste virtualisée.
4. **M4. Nettoyage** : F4 avec mode simulation, Corbeille, rapport, journal, historique.
5. **M5. Gros fichiers, doublons, réglages** : F5, F6, F7.
6. **M6. Finition** : Accès complet au disque, mode sombre, icône, `.dmg` signé en ad hoc, README.

**Critères d'acceptation de la v1.0**

- [ ] Un fichier situé dans la liste noire ne peut pas être mis à la Corbeille, même via un appel IPC forgé à la main (test automatisé).
- [ ] Un lien symbolique pointant hors du dossier utilisateur n'est ni suivi ni supprimé.
- [ ] Le mode simulation ne déplace aucun fichier (vérifié par un test sur un dossier temporaire).
- [ ] Les fichiers nettoyés se retrouvent dans la Corbeille et peuvent être remis en place depuis le Finder.
- [ ] Le scan complet respecte les cibles de durée et de mémoire sur un MacBook Air M3.
- [ ] L'annulation d'un scan prend moins d'une seconde.
- [ ] Sans Accès complet au disque, l'app fonctionne et affiche le nombre de dossiers inaccessibles.
- [ ] `npm run make` produit un `.dmg` qui s'installe et se lance sur le Mac de développement.

**Risques**

| Risque | Impact | Parade |
| --- | --- | --- |
| Suppression d'un fichier important | Très élevé | Corbeille par défaut, liste noire dans le processus principal, mode simulation au premier lancement, tests de `guard.ts` |
| Scan trop lent sur de gros disques | Moyen | Worker thread, `opendir` en flux, envoi de la progression par lots toutes les 100 ms |
| Une app plante après le vidage de son cache | Faible | Détection des apps ouvertes, caches régénérés automatiquement par macOS |
| Accès complet au disque redemandé après chaque build | Faible | Message explicatif, développement surtout avec `npm start` |
| `shell.trashItem` lent sur des milliers de fichiers | Moyen | Mettre à la Corbeille le dossier parent quand toute une catégorie est cochée (par exemple un dossier DerivedData entier) |

## Prompt à donner à Claude Code

Exporte ce document en Markdown et place-le dans un dossier vide sous le nom `docs/PRD.md`. Lance ensuite Claude Code dans ce dossier et colle le prompt ci-dessous.

```text
Tu vas construire MacSweep, une app de bureau macOS en Electron qui scanne le Mac et met les fichiers encombrants à la Corbeille. La spécification complète est dans docs/PRD.md : lis-la entièrement avant d'écrire du code. Elle fait foi en cas de doute.

Contexte
- Machine : MacBook Air M3 (arm64), macOS récent, Node.js LTS.
- Je développe dans WebStorm. Je connais JavaScript, HTML, CSS et Java ; explique brièvement les concepts propres à Electron quand tu les introduis.
- Pas de compte Apple Developer payant : signature ad hoc uniquement, pas de notarisation.

Stack imposée
- Electron Forge avec le template Vite + TypeScript (mode strict).
- React 18, Tailwind CSS, @tanstack/react-virtual, Recharts, electron-store.
- Vitest pour les tests unitaires, Playwright pour Electron pour les tests de bout en bout.
- ESLint et Prettier.
- Respecte la structure de projet de la section « Architecture technique » du PRD.

Règles non négociables
1. Sécurité Electron : contextIsolation true, nodeIntegration false, sandbox true, CSP stricte, aucun contenu distant, aucune requête réseau.
2. Tout accès disque se fait dans le processus principal ou dans un worker_thread. L'interface passe uniquement par l'API typée exposée dans preload via contextBridge.
3. Implémente les règles de sécurité du PRD dans src/main/safety/guard.ts. Chaque chemin reçu par IPC doit passer par ce module avant toute action, même si l'interface l'a déjà filtré.
4. N'utilise jamais fs.rm, fs.unlink ou rimraf pour nettoyer. Utilise shell.trashItem. Seule exception : vider la Corbeille après la double confirmation décrite dans le PRD.
5. Pendant le développement et les tests, ne lance jamais de nettoyage réel sur mon dossier utilisateur. Les tests créent leurs fichiers dans un dossier temporaire (os.tmpdir) et injectent ce dossier comme racine à la place de os.homedir().
6. Pas de sudo, pas d'AppleScript avec droits administrateur.
7. Le mode simulation (dry run) est activé par défaut au premier lancement.

Méthode de travail
- Avance jalon par jalon (M1 à M6 dans le PRD). Ne commence pas un jalon tant que le précédent ne compile pas, que ses tests ne passent pas et que l'app ne démarre pas avec npm start.
- Commence par me présenter ton plan pour M1 et M2, puis attends ma validation.
- À la fin de chaque jalon : lance npm run lint, npm test et npm start, corrige les erreurs, fais un commit git clair, puis résume en quelques lignes ce qui a été fait et comment je peux le tester moi-même.
- Écris les tests de guard.ts avant son implémentation : liste noire, liens symboliques vers l'extérieur, chemins avec .., chemins hors du dossier utilisateur, appel IPC forgé.
- Si une décision n'est pas couverte par le PRD, choisis l'option la plus prudente pour les données de l'utilisateur et note-la dans docs/DECISIONS.md.
- Tiens à jour un README.md : installation, npm start, npm run make, et activation de l'Accès complet au disque.

Commence maintenant : lis docs/PRD.md, puis propose-moi le plan détaillé de M1 et M2.
```
