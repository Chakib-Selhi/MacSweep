import type { CategoryId, RiskLevel } from '../shared/categories';
import type { ScanStatus } from '../shared/types';

export const strings = {
  appName: 'MacSweep',
  nav: {
    label: 'Navigation principale',
    dashboard: 'Tableau de bord',
    largeFiles: 'Gros fichiers',
    duplicates: 'Doublons',
    history: 'Historique',
    settings: 'Réglages',
  },
  dashboard: {
    diskTitle: 'Disque',
    used: 'Utilisé',
    free: 'Libre',
    total: 'Total',
    loading: 'Lecture du disque…',
    error: 'Impossible de lire les informations du disque.',
    usageLabel: (percent: number) => `${percent} % utilisé`,
  },
  scan: {
    title: 'Scan',
    start: 'Lancer le scan',
    cancel: 'Annuler',
    preview: 'Aperçu temporaire : l’écran de revue complet arrive au jalon M3.',
    startError: 'Le scan n’a pas pu démarrer.',
    running: (category: string) => `Analyse : ${category}`,
    filesVisited: (count: string) => `${count} fichiers parcourus`,
    status: {
      completed: 'Scan terminé',
      cancelled: 'Scan annulé (résultats partiels)',
      failed: 'Le scan a échoué',
    } satisfies Record<ScanStatus, string>,
    duration: (seconds: string) => `en ${seconds} s`,
    denied: (count: number) =>
      `${count} dossier${count > 1 ? 's' : ''} inaccessible${count > 1 ? 's' : ''} : l’Accès complet au disque permettrait de les analyser.`,
    items: (count: number) => `${count} élément${count > 1 ? 's' : ''}`,
    empty: 'Rien à signaler dans les catégories analysées.',
  },
  risk: {
    low: 'Risque faible',
    medium: 'Risque moyen',
    high: 'Risque élevé',
  } satisfies Record<RiskLevel, string>,
  categories: {
    'user-caches': 'Caches utilisateur',
    'user-logs': 'Logs utilisateur',
    'xcode-derived-data': 'Xcode DerivedData',
    'xcode-archives': 'Archives Xcode',
    'ios-simulators': 'Simulateurs iOS inutilisés',
    'ios-device-support': 'Support des appareils iOS',
    'js-package-caches': 'Caches npm, yarn, pnpm',
    'homebrew-cache': 'Cache Homebrew',
    'jvm-caches': 'Caches Gradle et Maven',
    'node-modules': 'Dossiers node_modules',
    'downloaded-installers': 'Installeurs téléchargés',
    trash: 'Corbeille',
  } satisfies Record<CategoryId, string>,
  placeholder: (milestone: string) => `Cet écran arrive au jalon ${milestone}.`,
} as const;
