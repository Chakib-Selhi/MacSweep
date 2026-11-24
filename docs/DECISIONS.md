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
