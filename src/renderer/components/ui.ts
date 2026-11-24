const BASE =
  'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-neutral-900';

export const buttonStyles = {
  primary: `${BASE} bg-blue-600 text-white hover:bg-blue-700 disabled:hover:bg-blue-600`,
  secondary: `${BASE} border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800`,
  ghost: `${BASE} px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950`,
} as const;

export const cardStyle = 'rounded-xl border border-neutral-200 p-5 dark:border-neutral-800';
