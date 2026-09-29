export interface ProjectMeta {
  client_name: string;
  claim_number: string;
  carrier: string;
  policy_number?: string;
  total_rcv: number;
  net_claim?: number;
  overhead_and_profit?: number;
  // ---- Budget-engine extraction extensions (optional, back-compat) ----
  property_address?: string;
  insured_phone?: string;
  deductible?: number;
  /** Carrier summary pre-tax, pre-O&P line-item subtotal (audit basis). */
  base_subtotal?: number;
  /** Material sales tax included in the carrier summary, if itemized. */
  material_tax?: number;
  /** Total overhead + profit dollars included in the summary. */
  op_total?: number;
}

export interface TradeSection {
  task_id: string; // e.g. "T-1", "T-2"
  trade_name: string;
  category_codes_included: string[];
  billable_revenue: number;
  suggested_duration_days: number;
  predecessors: string; // e.g. "T-1" or "T-2, T-3" or ""
  scope_summary: string;
  /**
   * Manual schedule pin (YYYY-MM-DD), written when a bar is dragged on the
   * Gantt chart. The scheduler honors it, but never ahead of the project
   * start and never before the task's predecessors finish. Cleared by
   * "Reset manual dates" in the bar's details.
   */
  schedule_start_override?: string;
  // Subcontractor buyout extensions
  subcontractor_name?: string;
  subcontractor_bid?: number;
  labor_split_pct?: number; // default e.g. 60% labor, 40% materials
  // ---- Budget engine (Xactimate -> Master Budget) extensions ----
  /** Standardized 14-division taxonomy label resolved by the budget engine. */
  trade_division?: string;
  execution_type?: string;
  /** Line-item subtotal before tax and O&P (revenue allocation basis). */
  direct_subtotal?: number;
  /** Retail labor/equipment dollars carried by this trade's line items. */
  retail_labor?: number;
  /** Retail material dollars carried by this trade's line items. */
  retail_material?: number;
  /** Direct material cost INCLUDING material sales tax (checksum convention). */
  direct_material?: number;
  /** Direct labor / subcontracted buyout cost. */
  direct_labor?: number;
  /** Equipment rental + associated tax. */
  equipment_tax?: number;
  total_direct_cost?: number;
  gross_profit?: number;
  gross_margin_pct?: number;
  /** 'model_extraction' when parsed from line items, 'derived_defaults' otherwise. */
  budget_basis?: string;
  /** Credited-out / DO NOT PERFORM scope that field crews must not execute. */
  exclusions?: string[];
}

export interface EstimateResult {
  project_meta: ProjectMeta;
  trade_sections: TradeSection[];
  extracted_at?: string;
  source_filename?: string;
  /** Deterministic reconciliation output from the budget engine. */
  budget_audit?: BudgetAudit;
  /** Itemized material procurement allowance (Output 2 of the budget spec). */
  material_allowances?: MaterialAllowanceItem[];
  /** Crew-ready field work orders with contract amounts linked to budget lines (carrier margins excluded). */
  work_orders?: WorkOrder[];
  work_order_site?: WorkOrderSiteLogistics;
  work_orders_generated_at?: string;
  /**
   * ISO timestamp of the most recent buyout budget adjustment for this claim
   * (sub bid / margin / target application). Final work orders are locked
   * until this is set — the adjusted buyout drives every contract amount.
   */
  budget_adjusted_at?: string;
  processing?: ProcessingMeta;
}

export interface MaterialAllowanceItem {
  trade: string;
  component_code?: string;
  description: string;
  qty: number;
  uom: string;
  unit_cost: number;
  extended_cost: number;
  vendor?: string;
}

export interface BudgetAudit {
  carrier_total_rcv: number;
  base_subtotal: number;
  material_tax: number;
  op_total: number;
  sum_trade_rcv: number;
  delta_rcv: number;
  sum_direct_material: number;
  allowance_subtotal: number;
  allowance_tax: number;
  allowance_total: number;
  material_variance: number;
  rcv_reconciled: boolean;
  material_reconciled: boolean;
  basis: 'model_extraction' | 'derived_defaults';
  assumptions: string[];
}

export interface WorkOrderAreaInstruction {
  area: string;
  items: string[];
}

export interface WorkOrderBudgetLine {
  task_id: string;
  trade_name: string;
  trade_division?: string;
  /** subcontractor_bid when defined, else direct_labor (budgeted buyout), rounded to cents. */
  amount: number;
  basis: 'sub_bid' | 'budgeted_buyout' | 'none';
}

export interface WorkOrderContract {
  /** Σ budget_lines.amount, rounded to cents. */
  contract_amount: number;
  basis: 'sub_bid' | 'budgeted_buyout' | 'mixed' | 'none';
  budget_lines: WorkOrderBudgetLine[];
}

export interface WorkOrder {
  crew_id: string;
  crew_name: string;
  crew_scope: string;
  trade_task_ids: string[];
  scope_summary: string;
  safety_protocols: string[];
  instructions: WorkOrderAreaInstruction[];
  material_specs: string[];
  qc_checklist: string[];
  exclusions: string[];
  source: 'ai' | 'template';
  /** Office-attached subcontractor contract amount derived from budget lines (carrier margins excluded). */
  contract?: WorkOrderContract;
}

export interface WorkOrderSiteLogistics {
  working_hours: string;
  parking_staging: string;
  waste_disposal: string;
  emergency_protocol: string;
  superintendent?: string;
}

export interface ProcessingMeta {
  model?: string;
  warnings?: string[];
  processed_at?: string;
  duration_ms?: number;
  engine?: string;
}

export interface ScheduledTask extends TradeSection {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  startOffsetDays: number;
  endOffsetDays: number;
  isCriticalPath: boolean;
}
