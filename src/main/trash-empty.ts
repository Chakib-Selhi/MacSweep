import { lstat, opendir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { TrashReport } from '../shared/types';
import type { Journal } from './journal';

// The only module allowed to delete for good (PRD rule 4), after the double confirmation.
export const EMPTY_TRASH_CONFIRMATION = 'VIDER';

interface EmptyTrashInput {
  /** Real path of the home folder (or of the test root). */
  root: string;
  confirmation: unknown;
  dryRun: boolean;
  journal: Journal;
}

/** Allocated size of a file or folder, links never followed. */
async function sizeOf(target: string): Promise<number> {
  const stats = await lstat(target);
  let total = stats.blocks * 512;
  if (!stats.isDirectory()) return total;
  for await (const entry of await opendir(target)) {
    total += await sizeOf(path.join(target, entry.name)).catch(() => 0);
  }
  return total;
}

export async function emptyTrash({
  root,
  confirmation,
  dryRun,
  journal,
}: EmptyTrashInput): Promise<TrashReport> {
  if (confirmation !== EMPTY_TRASH_CONFIRMATION) {
    throw new Error(`Confirmation invalide : il faut taper « ${EMPTY_TRASH_CONFIRMATION} »`);
  }

  const trashDir = path.join(root, '.Trash');
  const report: TrashReport = { dryRun, deletedCount: 0, bytesFreed: 0, failed: [] };
  let stats;
  try {
    stats = await lstat(trashDir);
  } catch {
    return report;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('La Corbeille n’est pas un dossier ordinaire : rien n’a été supprimé');
  }

  let names: string[];
  try {
    names = await readdir(trashDir);
  } catch (error) {
    report.failed.push({
      path: trashDir,
      message: `Corbeille illisible (${error instanceof Error ? error.message : String(error)}) : l’Accès complet au disque est nécessaire.`,
    });
    return report;
  }

  for (const name of names) {
    const entry = path.join(trashDir, name);
    try {
      const sizeBytes = await sizeOf(entry);
      if (!dryRun) {
        // rm removes a symlink itself, never what it points to.
        await rm(entry, { recursive: true, force: false });
        await journal.record({ action: 'empty-trash', path: entry, sizeBytes });
      }
      report.deletedCount += 1;
      report.bytesFreed += sizeBytes;
    } catch (error) {
      report.failed.push({
        path: entry,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}
