import { TradeSection } from '../types/estimate';

/**
 * Finish-to-Start predecessor graph helpers shared by the schedule editor.
 *
 * `TradeSection.predecessors` is persisted as a comma-separated string of task
 * ids (e.g. "T-1, T-2"). The schedule editor presents it as a dropdown of the
 * other trades on the schedule, so these helpers keep the string form and the
 * picker's selection list in sync, and stop the user from creating the cycles
 * that `repairPredecessorGraph` would otherwise have to break silently.
 */

/** Minimal shape needed to reason about the dependency graph. */
export type PredecessorGraphNode = Pick<
  TradeSection,
  'task_id' | 'predecessors'
> &
  Partial<Pick<TradeSection, 'trade_name' | 'suggested_duration_days'>>;

export interface PredecessorOption {
  taskId: string;
  tradeName: string;
  /** Scheduled start (YYYY-MM-DD) when the caller passes scheduled tasks. */
  startDate?: string;
  durationDays?: number;
  /** Currently linked as a predecessor of the edited task. */
  linked: boolean;
  /**
   * Linking this task would close a dependency loop (it already depends on the
   * edited task, directly or through other trades).
   */
  createsCycle: boolean;
  /** Why the option is blocked, for display next to a disabled row. */
  blockedReason?: string;
}

/** Splits the persisted string form, trimming, de-duplicating and preserving order. */
export function parsePredecessors(raw?: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  String(raw)
    .split(/[,;]/)
    .map((token) => token.trim())
    .filter(Boolean)
    .forEach((id) => {
      if (seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    });
  return ids;
}

/** Canonical persisted form: "T-1, T-2" (empty string when nothing is linked). */
export function formatPredecessors(ids: readonly string[]): string {
  return parsePredecessors(ids.join(', ')).join(', ');
}

/** Every task `taskId` transitively depends on. Safe on an already-cyclic graph. */
export function collectDependencies(
  tasks: readonly PredecessorGraphNode[],
  taskId: string
): Set<string> {
  const byId = new Map(tasks.map((t) => [String(t.task_id).trim(), t]));
  const visited = new Set<string>();
  const stack: string[] = [taskId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const node = byId.get(current);
    if (!node) continue;
    for (const id of parsePredecessors(node.predecessors)) {
      if (id === current || visited.has(id)) continue;
      visited.add(id);
      stack.push(id);
    }
  }
  return visited;
}

/**
 * True when making `candidateId` a predecessor of `taskId` would create a loop.
 * Only the candidate edge changes, so checking the candidate's existing
 * dependency closure against `taskId` is sufficient.
 */
export function wouldCreateCycle(
  tasks: readonly PredecessorGraphNode[],
  taskId: string,
  candidateId: string
): boolean {
  if (taskId === candidateId) return true;
  return collectDependencies(tasks, candidateId).has(taskId);
}

/**
 * The dropdown's option list: every other trade on the schedule, in schedule
 * order, flagged with its current link state and whether it may be linked.
 */
export function buildPredecessorOptions(
  tasks: readonly PredecessorGraphNode[],
  taskId: string,
  selectedIds: readonly string[]
): PredecessorOption[] {
  const linked = new Set(selectedIds);
  const options: PredecessorOption[] = [];
  for (const task of tasks) {
    const id = String(task.task_id).trim();
    if (!id || id === taskId) continue;
    const createsCycle = wouldCreateCycle(tasks, taskId, id);
    const scheduled = task as PredecessorGraphNode & {
      startDate?: string;
    };
    options.push({
      taskId: id,
      tradeName: task.trade_name || 'Untitled trade package',
      startDate: scheduled.startDate,
      durationDays: task.suggested_duration_days,
      linked: linked.has(id),
      createsCycle,
      blockedReason: createsCycle
        ? `${id} already depends on ${taskId} — linking it would create a loop`
        : undefined,
    });
  }
  return options;
}

/**
 * Adds or removes one predecessor. `linked` options are always togglable so a
 * pre-existing loop can be unlinked from the UI; block-listed options are not
 * added.
 */
export function togglePredecessor(
  selectedIds: readonly string[],
  option: Pick<PredecessorOption, 'taskId' | 'linked' | 'createsCycle'>
): string[] {
  const current = parsePredecessors(selectedIds.join(', '));
  if (current.includes(option.taskId)) {
    return current.filter((id) => id !== option.taskId);
  }
  if (option.createsCycle) return current;
  return [...current, option.taskId];
}

/** Human-readable summary of the linked predecessor set for the picker trigger. */
export function describePredecessors(
  selectedIds: readonly string[],
  tasks: readonly PredecessorGraphNode[]
): string {
  const names = new Map(tasks.map((t) => [String(t.task_id).trim(), t.trade_name]));
  if (selectedIds.length === 0) return 'None — starts at project start';
  return selectedIds
    .map((id) => {
      const name = names.get(id);
      return name ? `${id} · ${name}` : `${id} (not on schedule)`;
    })
    .join(', ');
}
