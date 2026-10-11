import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Link2,
  Search,
  Unlink,
  X,
} from 'lucide-react';
import {
  PredecessorOption,
  togglePredecessor,
} from '../utils/predecessors';

interface PredecessorPickerProps {
  /** The task being edited — never offered as its own predecessor. */
  taskId: string;
  /** Currently linked predecessor ids (persisted order preserved). */
  selectedIds: string[];
  /** Every other trade on the schedule, in schedule order. */
  options: PredecessorOption[];
  /** Linked ids that are no longer on the schedule (legacy/stale data). */
  offScheduleIds: string[];
  /** Trigger label, e.g. "T-1 · Framing, T-2 · Drywall". */
  summary: string;
  onChange: (next: string[]) => void;
}

/**
 * Multi-select dropdown that links and unlinks Finish-to-Start predecessors by
 * picking from the other trades already on the schedule, instead of typing task
 * ids by hand. Trades that would close a dependency loop are offered but
 * blocked, with the reason shown.
 */
export const PredecessorPicker: React.FC<PredecessorPickerProps> = ({
  taskId,
  selectedIds,
  options,
  offScheduleIds,
  summary,
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const baseId = useId();

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    options.forEach((option) => map.set(option.taskId, option.tradeName));
    return map;
  }, [options]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (option) =>
        option.taskId.toLowerCase().includes(q) ||
        option.tradeName.toLowerCase().includes(q)
    );
  }, [options, query]);

  // Close when the pointer goes down anywhere outside the picker.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Fresh search + focus every time the panel opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const toggle = (option: PredecessorOption) => {
    // Linked options always toggle off, so a pre-existing loop stays fixable.
    if (option.createsCycle && !option.linked) return;
    onChange(togglePredecessor(selectedIds, option));
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      // Enter/Space open the panel through the trigger button's own click;
      // only ArrowDown needs handling here so the toggle is not fired twice.
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      // Keep the surrounding details modal open; only the panel closes.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.key === 'Enter') {
      const option = filtered[activeIndex];
      if (option) {
        event.preventDefault();
        toggle(option);
      }
    }
  };

  const activeOptionId =
    open && filtered[activeIndex]
      ? `${baseId}-option-${filtered[activeIndex].taskId}`
      : undefined;

  const linkedCount = selectedIds.length;

  return (
    <div
      ref={containerRef}
      className="relative mt-1"
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Predecessors for ${taskId}: ${summary}`}
        onClick={() => setOpen((v) => !v)}
        className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-left flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-red-200 hover:border-slate-400 transition-colors"
      >
        <Link2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span
          className={`flex-1 min-w-0 truncate text-[13px] ${
            linkedCount > 0 ? 'text-slate-900 font-medium' : 'text-slate-500'
          }`}
        >
          {summary}
        </span>
        {linkedCount > 0 && (
          <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 text-[10px] font-bold text-red-700 tabular-nums">
            {linkedCount}
          </span>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Selected links stay visible while the panel is closed. */}
      {(linkedCount > 0 || offScheduleIds.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selectedIds.map((id) => {
            const linkedOption = options.find((option) => option.taskId === id);
            const loops = Boolean(linkedOption?.createsCycle);
            return (
              <span
                key={id}
                className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full border text-[11px] font-medium ${
                  loops
                    ? 'border-amber-300 bg-amber-50 text-amber-800'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                <span className="font-mono font-bold">{id}</span>
                <span className="max-w-[9rem] truncate">
                  {linkedOption?.tradeName ?? nameById.get(id) ?? 'on schedule'}
                </span>
                <button
                  type="button"
                  aria-label={`Unlink predecessor ${id}`}
                  title={`Unlink ${id}`}
                  onClick={() =>
                    onChange(selectedIds.filter((selected) => selected !== id))
                  }
                  className="p-0.5 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
          {offScheduleIds.map((id) => (
            <span
              key={id}
              title={`${id} is no longer on the schedule and will be dropped when you save`}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-[11px] font-medium text-amber-800"
            >
              <AlertTriangle className="w-3 h-3" />
              <span className="font-mono font-bold">{id}</span>
              <span>not on schedule</span>
              <button
                type="button"
                aria-label={`Unlink predecessor ${id}`}
                onClick={() =>
                  onChange(selectedIds.filter((selected) => selected !== id))
                }
                className="p-0.5 rounded-full text-amber-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-1.5 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${baseId}-listbox`}
              aria-activedescendant={activeOptionId}
              aria-autocomplete="list"
              value={query}
              placeholder="Search trades on this schedule…"
              onChange={(event) => setQuery(event.target.value)}
              className="flex-1 min-w-0 h-7 bg-transparent text-[12px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
                className="p-0.5 rounded text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div
            id={`${baseId}-listbox`}
            role="listbox"
            aria-multiselectable="true"
            aria-label="Trades on the schedule"
            className="max-h-56 overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-[12px] text-slate-500 text-center">
                {options.length === 0
                  ? 'No other trades on this schedule yet.'
                  : 'No trades match that search.'}
              </p>
            ) : (
              filtered.map((option, index) => {
                const blocked = option.createsCycle && !option.linked;
                const active = index === activeIndex;
                return (
                  <div
                    key={option.taskId}
                    id={`${baseId}-option-${option.taskId}`}
                    role="option"
                    aria-selected={option.linked}
                    aria-disabled={blocked}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => toggle(option)}
                    className={`flex items-start gap-2.5 px-3 py-2 mx-1 rounded-lg transition-colors ${
                      blocked
                        ? 'cursor-not-allowed opacity-60'
                        : 'cursor-pointer'
                    } ${active && !blocked ? 'bg-slate-100' : ''}`}
                  >
                    <span
                      className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center ${
                        option.linked
                          ? 'bg-red-600 border-red-600 text-white'
                          : blocked
                          ? 'border-slate-300 bg-slate-50'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {option.linked && <Check className="w-3 h-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] font-bold text-slate-900">
                          {option.taskId}
                        </span>
                        <span className="text-[12px] font-medium text-slate-800 truncate">
                          {option.tradeName}
                        </span>
                        {option.linked && (
                          <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-red-700">
                            <Unlink className="w-3 h-3" />
                            Unlink
                          </span>
                        )}
                      </span>
                      <span
                        className={`block text-[11px] mt-0.5 ${
                          blocked ? 'text-amber-700' : 'text-slate-400'
                        }`}
                      >
                        {blocked
                          ? option.blockedReason
                          : [
                              option.startDate
                                ? `starts ${option.startDate}`
                                : null,
                              typeof option.durationDays === 'number'
                                ? `${option.durationDays} workday${
                                    option.durationDays === 1 ? '' : 's'
                                  }`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' • ')}
                      </span>
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-100 bg-slate-50">
            <span className="text-[11px] text-slate-500">
              {linkedCount === 0
                ? 'Nothing linked — this trade can start at the project start.'
                : `${linkedCount} linked · starts after ${
                    linkedCount === 1 ? 'it' : 'all of them'
                  } finish`}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {linkedCount > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-[11px] font-semibold text-slate-600 hover:text-rose-600 px-1.5 py-1 rounded transition-colors"
                >
                  Unlink all
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[11px] font-semibold text-white bg-slate-700 hover:bg-slate-800 px-2.5 py-1 rounded-md transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
