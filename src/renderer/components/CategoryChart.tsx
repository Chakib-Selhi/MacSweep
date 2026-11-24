import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CategoryResult } from '../../shared/types';
import { formatBytes } from '../format';
import { strings } from '../strings';

const ROW_HEIGHT = 30;

/** Decorative: the same figures are listed as text in the category cards below. */
export function CategoryChart({ categories }: { categories: readonly CategoryResult[] }) {
  const data = categories
    .filter((c) => c.totalBytes > 0)
    .map((c) => ({ name: strings.categories[c.id], bytes: c.totalBytes }));
  if (data.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="category-chart"
      className="text-neutral-600 dark:text-neutral-400"
      style={{ height: data.length * ROW_HEIGHT + 24 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
          <XAxis
            type="number"
            dataKey="bytes"
            tickFormatter={formatBytes}
            tick={{ fill: 'currentColor', fontSize: 11 }}
            stroke="currentColor"
          />
          <YAxis
            type="category"
            dataKey="name"
            width={190}
            tick={{ fill: 'currentColor', fontSize: 12 }}
            stroke="currentColor"
          />
          <Tooltip
            cursor={{ fillOpacity: 0.08 }}
            formatter={(value) => formatBytes(Number(value))}
            labelStyle={{ color: '#171717' }}
          />
          <Bar dataKey="bytes" name="Taille" fill="#2563eb" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
