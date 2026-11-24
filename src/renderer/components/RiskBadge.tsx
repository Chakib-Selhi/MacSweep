import type { RiskLevel } from '../../shared/categories';
import { strings } from '../strings';

const STYLES: Record<RiskLevel, string> = {
  low: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  medium: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  high: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

/** The colour always comes with its text label, never alone. */
export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${STYLES[risk]}`}>
      {strings.risk[risk]}
    </span>
  );
}
