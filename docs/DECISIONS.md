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
