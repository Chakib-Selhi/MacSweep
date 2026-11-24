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
  placeholder: (milestone: string) => `Cet écran arrive au jalon ${milestone}.`,
} as const;
