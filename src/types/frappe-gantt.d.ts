/**
 * Type declarations for `frappe-gantt` v1.2.x.
 *
 * The package ships no bundled types and no `types` condition in its `exports`
 * map, so this file only *describes* the library surface this app relies on —
 * it does not alter package resolution.
 */
declare module 'frappe-gantt' {
  export interface GanttTask {
    /** Stable id. The library replaces spaces with underscores. */
    id: string;
    name: string;
    /** `YYYY-MM-DD` (start is inclusive). */
    start: string;
    /**
     * `YYYY-MM-DD`. A bare date counts as a *full final day* — the library
     * extends it by 24h — so this is the inclusive last day of the bar.
     */
    end: string;
    /** `0`–`1`. */
    progress?: number;
    /** Comma-separated predecessor ids; the library normalizes to an array. */
    dependencies?: string;
    /** Extra class applied to the `.bar-wrapper` group. */
    custom_class?: string;
    description?: string;
    [key: string]: unknown;
  }

  export interface GanttViewMode {
    name: string;
    padding?: string;
    step?: string;
    column_width?: number;
    date_format?: string;
    snap_at?: string;
    upper_text_frequency?: number;
    lower_text?: string | ((current: Date, previous: Date | null, lang: string) => string);
    upper_text?: string | ((current: Date, previous: Date | null, lang: string) => string);
    thick_line?: (current: Date) => boolean;
  }

  /** Context handed to the `popup` callback. */
  export interface GanttPopupContext {
    task: GanttTask;
    chart: Gantt;
    get_title: () => unknown;
    get_subtitle: () => unknown;
    get_details: () => unknown;
    set_title: (html: string) => void;
    set_subtitle: (html: string) => void;
    set_details: (html: string) => void;
    add_action: (html: string, callback: () => void) => void;
  }

  export interface GanttOptions {
    arrow_curve?: number;
    auto_move_label?: boolean;
    bar_corner_radius?: number;
    bar_height?: number;
    container_height?: number | 'auto';
    column_width?: number | null;
    date_format?: string;
    upper_header_height?: number;
    lower_header_height?: number;
    snap_at?: string | null;
    infinite_padding?: boolean;
    holidays?: Record<string, unknown> | null;
    ignore?: string | Array<string | Date | ((date: Date) => boolean)> | ((date: Date) => boolean);
    is_weekend?: (date: Date) => boolean;
    language?: string;
    lines?: 'none' | 'vertical' | 'horizontal' | 'both';
    move_dependencies?: boolean;
    /** Fired when a bar is clicked. */
    on_click?: (task: GanttTask) => void;
    /**
     * Fired on bar double-click (and double-tap). The library suppresses the
     * event for a second after a drag ends so a move cannot open it.
     */
    on_double_click?: (task: GanttTask) => void;
    /**
     * Fired while/after a bar is moved or resized. `end` is the inclusive last
     * day (the library subtracts one second from its exclusive internal end).
     */
    on_date_change?: (task: GanttTask, start: Date, end: Date) => void;
    on_progress_change?: (task: GanttTask, progress: number) => void;
    on_view_change?: (mode: string) => void;
    padding?: number;
    popup?: (context: GanttPopupContext) => string | false | void;
    popup_on?: 'click' | 'hover';
    readonly?: boolean;
    readonly_dates?: boolean;
    readonly_progress?: boolean;
    hover_on_date?: boolean;
    fixed_duration?: boolean;
    scroll_to?: 'today' | 'start' | 'end' | string;
    show_expected_progress?: boolean;
    today_button?: boolean;
    view_mode?: string | GanttViewMode;
    view_modes?: Array<string | GanttViewMode>;
    view_mode_select?: boolean;
  }

  export default class Gantt {
    constructor(
      wrapper: string | HTMLElement | SVGElement,
      tasks: GanttTask[],
      options?: GanttOptions
    );

    /** The scrollable `.gantt-container` the chart renders into. */
    $container: HTMLElement;
    /** The root `<svg class="gantt">` element. */
    $svg: SVGSVGElement;
    /** Tasks after normalization (dates parsed, dependencies arrayified). */
    tasks: GanttTask[];
    options: GanttOptions;

    /** Re-renders the chart from a (possibly new) task list. */
    refresh(tasks: GanttTask[]): void;
    /** Re-renders the chart after merging new options. */
    update_options(options: Partial<GanttOptions>): void;
    change_view_mode(mode?: string | GanttViewMode, maintain_pos?: boolean): void;
    update_task(id: string, details: Partial<GanttTask>): void;
    get_task(id: string): GanttTask | undefined;
    scroll_current(): void;
    /** Scrolls the container to the given date (or 'start' | 'today' | 'end'). */
    set_scroll_position(date: Date | string | null): void;
    clear(): void;
  }
}
