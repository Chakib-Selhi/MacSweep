# MacSweep

Nettoyeur de Mac local et prudent. MacSweep scanne le disque, montre ce qui prend de la place et met les fichiers encombrants à la Corbeille, jamais en suppression directe. Aucun compte, aucun réseau, aucune télémétrie.

La spécification complète est dans [docs/PRD.md](docs/PRD.md), les décisions prises en dehors du PRD dans [docs/DECISIONS.md](docs/DECISIONS.md).

## Prérequis

- Mac Apple Silicon, macOS 13 ou plus récent
- Node.js 24 LTS (fonctionne aussi avec Node 25)
- Outils en ligne de commande Xcode (`xcode-select --install`) pour les catégories Xcode

## Installation

```bash
npm install
```

## Lancer en développement

```bash
npm start
```

L'interface se recharge à chaud quand on la modifie. Aucune signature n'est nécessaire.

## Tests et qualité

```bash
npm run lint        # ESLint + Prettier
npm run test:unit   # Vitest seul, rapide
npm test            # types + Vitest + Playwright (empaquette l'app d'abord)
```

Les tests ne touchent jamais au dossier utilisateur réel : ils travaillent dans un dossier temporaire.

## Fabriquer l'app installable

```bash
npm run make
```

Le `.dmg` et le `.zip` sont créés dans `out/make/`. L'app est signée en ad hoc, ce qui suffit sur ton propre Mac Apple Silicon. Après chaque nouvelle compilation, la signature change : macOS peut redemander l'Accès complet au disque. C'est normal.

Pour la donner à quelqu'un d'autre, Gatekeeper affichera un avertissement. La personne fait clic droit sur l'app, puis « Ouvrir », ou lance :

```bash
xattr -dr com.apple.quarantine /Applications/MacSweep.app
```

## Activer l'Accès complet au disque

Sans cet accès, certains dossiers de `~/Library` sont illisibles. MacSweep fonctionne quand même et affiche le nombre de dossiers inaccessibles.

1. Ouvre **Réglages Système → Confidentialité et sécurité → Accès complet au disque**.
2. Clique sur **+** et ajoute `MacSweep.app`. En développement, ajoute plutôt l'app `Electron` lancée par `npm start` : `node_modules/electron/dist/Electron.app`.
3. Relance MacSweep.

## Structure

```
src/main/       processus principal : fenêtre, sécurité, IPC, accès disque
src/preload/    pont contextBridge, API typée window.macsweep
src/renderer/   interface React, sans aucun accès à Node
src/shared/     types partagés entre main et renderer
tests/unit/     Vitest
tests/e2e/      Playwright pour Electron
```
