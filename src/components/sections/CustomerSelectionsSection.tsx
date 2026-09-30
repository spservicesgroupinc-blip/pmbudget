import React, { useMemo, useState } from 'react';
import {
  Palette,
  Plus,
  Trash2,
  RefreshCw,
  FileDown,
  Loader2,
  CheckCircle2,
  Info,
  PackageOpen,
  UploadCloud,
} from 'lucide-react';
import { ConfirmModal } from '../ConfirmModal';
import type { CustomerSelectionItem, EstimateResult } from '../../types/estimate';
import { formatMoney } from '../../utils/workOrders';
import {
  buildCustomerSelections,
  computeSelectionTotals,
  groupSelectionsByCategory,
  SELECTION_CATEGORIES,
} from '../../utils/customerSelections';
import {
  buildCustomerSelectionsPdf,
  customerSelectionsPdfFilename,
} from '../../utils/customerSelectionsPdf';
import { saveCustomerProfile, uploadCustomerPdf } from '../../services/gappsApi';

interface CustomerSelectionsSectionProps {
  estimate: EstimateResult | null;
  onUpdateSelections: (items: CustomerSelectionItem[]) => void;
  onNavigateSection: (id: string) => void;
  onShowToast: (type: 'success' | 'warning' | 'error', message: string) => void;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const UOM_OPTIONS = ['SF', 'LF', 'EA', 'SH', 'GL', 'ROLL', 'SET', 'SY'];

/** Triggers a client-side download of generated PDF bytes. */
const downloadBytes = (bytes: Uint8Array, filename: string) => {
  // Copy into a fresh ArrayBuffer-backed view for TS 7 BlobPart compat.
  const blob = new Blob([Uint8Array.from(bytes).buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

/** Compact label over an input, matching the section's small-form styling. */
const fieldLabel = (text: string) => (
  <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
    {text}
  </span>
);

const inputClass =
  'w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-[12px] text-slate-900 transition focus:bg-white focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15';

interface AddForm {
  description: string;
  category: string;
  trade: string;
  qty: string;
  uom: string;
  unit: string;
  vendor: string;
  notes: string;
}

const EMPTY_ADD_FORM: AddForm = {
  description: '',
  category: SELECTION_CATEGORIES[0],
  trade: '',
  qty: '',
  uom: 'SF',
  unit: '',
  vendor: '',
  notes: '',
};

export const CustomerSelectionsSection: React.FC<CustomerSelectionsSectionProps> = ({
  estimate,
  onUpdateSelections,
  onNavigateSection,
  onShowToast,
}) => {
  const [generating, setGenerating] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_ADD_FORM);

  const items = estimate?.customer_selections ?? [];
  const groups = useMemo(() => groupSelectionsByCategory(items), [items]);
  const totals = useMemo(() => computeSelectionTotals(items), [items]);

  if (!estimate) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-none">
        <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-4">
          <Palette className="w-6 h-6" />
        </div>
        <h3 className="text-[15px] font-semibold text-slate-900">No Estimate Loaded</h3>
        <p className="text-[13px] text-slate-500 mt-1.5 max-w-md mx-auto">
          Load or process an estimate to build the customer material selection allowances.
        </p>
        <button
          onClick={() => onNavigateSection('intake')}
          className="mt-5 inline-flex items-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold bg-red-600 text-white hover:bg-red-700 shadow-sm transition-colors"
        >
          <UploadCloud className="w-4 h-4" />
          Go to Intake
        </button>
      </div>
    );
  }

  const commit = (next: CustomerSelectionItem[]) => onUpdateSelections(next);

  const updateItem = (id: string, patch: Partial<CustomerSelectionItem>) => {
    const next = items.map((item) => (item.id === id ? { ...item, ...patch } : item));
    commit(next);
  };

  const commitQty = (id: string, raw: string) => {
    const qty = parseFloat(raw);
    if (!Number.isFinite(qty) || qty < 0) return;
    const next = items.map((item) =>
      item.id === id
        ? { ...item, qty, allowance_total: round2(qty * item.allowance_per_unit) }
        : item
    );
    commit(next);
  };

  const commitUnitCost = (id: string, raw: string) => {
    const unit = parseFloat(raw);
    if (!Number.isFinite(unit) || unit < 0) return;
    const next = items.map((item) =>
      item.id === id
        ? { ...item, allowance_per_unit: unit, allowance_total: round2(item.qty * unit) }
        : item
    );
    commit(next);
  };

  const removeItem = (id: string) => {
    const target = items.find((item) => item.id === id);
    commit(items.filter((item) => item.id !== id));
    onShowToast(
      'success',
      `Removed ${target ? target.description.slice(0, 40) : id} from customer selections.`
    );
  };

  const nextManualId = () => {
    let max = 0;
    for (const item of items) {
      const m = item.id.match(/^SEL-M(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `SEL-M${max + 1}`;
  };

  const submitAdd = () => {
    const qty = parseFloat(addForm.qty);
    const unit = parseFloat(addForm.unit);
    if (!addForm.description.trim()) {
      onShowToast('warning', 'Give the selection item a description.');
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unit) || unit < 0) {
      onShowToast('warning', 'Qty must be positive and the allowance per unit must be 0 or more.');
      return;
    }
    const item: CustomerSelectionItem = {
      id: nextManualId(),
      category: addForm.category,
      trade: addForm.trade.trim() || 'Manual Selection',
      description: addForm.description.trim(),
      qty,
      uom: addForm.uom.toUpperCase() || 'EA',
      allowance_per_unit: round2(unit),
      allowance_total: round2(qty * unit),
      vendor: addForm.vendor.trim() || undefined,
      notes: addForm.notes.trim() || undefined,
      source: 'manual',
    };
    commit([...items, item]);
    setAddForm(EMPTY_ADD_FORM);
    setAddOpen(false);
    onShowToast('success', `Added ${item.description.slice(0, 40)} to customer selections.`);
  };

  const handleRebuild = () => {
    const rebuilt = buildCustomerSelections(estimate.material_allowances);
    commit(rebuilt);
    setConfirmRebuild(false);
    onShowToast(
      rebuilt.length > 0 ? 'success' : 'warning',
      rebuilt.length > 0
        ? `Rebuilt ${rebuilt.length} selection item(s) from ${estimate.material_allowances?.length || 0} material allowance row(s).`
        : 'No selection items could be derived from the current material allowances.'
    );
  };

  const handleGenerate = async () => {
    if (items.length === 0) {
      onShowToast('warning', 'No customer selections to render yet.');
      return;
    }
    setGenerating(true);
    try {
      const bytes = await buildCustomerSelectionsPdf(estimate);
      const filename = customerSelectionsPdfFilename(estimate);
      downloadBytes(bytes, filename);
      let workspaceSaved = false;
      try {
        const profile = await saveCustomerProfile(estimate);
        await uploadCustomerPdf(profile.customer_id, filename, bytes);
        workspaceSaved = true;
      } catch (uploadErr: any) {
        console.error('Workspace auto-save failed', uploadErr);
      }
      onShowToast(
        workspaceSaved ? 'success' : 'warning',
        workspaceSaved
          ? 'Customer Selections & Material Allowance Sheet downloaded · saved to workspace record.'
          : 'Allowance sheet downloaded — workspace auto-save failed.'
      );
    } catch (err: any) {
      onShowToast('error', err?.message || 'Failed to build the allowance sheet.');
    } finally {
      setGenerating(false);
    }
  };

  const materialAllowanceCount = estimate.material_allowances?.length || 0;

  return (
    <div className="space-y-6">
      {/* Workflow banner */}
      <div
        className={`rounded-xl border px-4 py-3 text-[13px] font-medium flex items-start gap-2.5 ${
          items.length > 0
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}
      >
        {items.length > 0 ? (
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
        ) : (
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
        )}
        <span>
          {items.length > 0
            ? `Customer selections ready — review and adjust the ${items.length} allowance item(s), then generate the allowance sheet.`
            : 'No customer selections yet — upload the estimate with its optional Component Breakdown Report to populate selection allowances automatically, or add items manually.'}
        </span>
      </div>

      {/* Main card */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-none">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
              <Palette className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">
                Customer Selections &amp; Material Allowances
              </h2>
              <p className="text-[12px] text-slate-500 mt-0.5">
                Flooring, cabinets, countertops and finish allowances by SF / LF / item — review, edit, and generate the customer sheet.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={materialAllowanceCount === 0}
              onClick={() => setConfirmRebuild(true)}
              title={
                materialAllowanceCount === 0
                  ? 'No material allowance rows to rebuild from'
                  : `Rebuild from ${materialAllowanceCount} material allowance row(s)`
              }
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg text-[12px] font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Rebuild from Allowances
            </button>
            <button
              type="button"
              disabled={items.length === 0 || generating}
              onClick={handleGenerate}
              className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg text-[12px] font-semibold bg-red-600 text-white hover:bg-red-700 shadow-sm transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {generating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileDown className="w-3.5 h-3.5" />
              )}
              Generate Allowance Sheet
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-4">
              <PackageOpen className="w-6 h-6" />
            </div>
            <h3 className="text-[15px] font-semibold text-slate-900">No Selection Items Yet</h3>
            <p className="text-[13px] text-slate-500 mt-1.5 max-w-md mx-auto">
              Upload the estimate with its Xactimate Component Breakdown Report to populate
              selection allowances automatically, or add items by hand.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                onClick={() => onNavigateSection('intake')}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold bg-red-600 text-white hover:bg-red-700 shadow-sm transition-colors"
              >
                <UploadCloud className="w-4 h-4" />
                Upload Estimate
              </button>
              <button
                onClick={() => setAddOpen(true)}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Item Manually
              </button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {groups.map((group) => {
              const groupTotal = round2(
                group.items.reduce(
                  (sum, item) =>
                    sum + (Number.isFinite(item.allowance_total) ? item.allowance_total : 0),
                  0
                )
              );
              return (
                <div key={group.category}>
                  <div className="px-5 py-2.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-[12px] font-bold text-slate-700">
                      {group.category}
                      <span className="ml-2 text-[11px] font-medium text-slate-400">
                        {group.items.length} item{group.items.length === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="text-[12px] font-semibold text-red-600 tabular-nums">
                      {formatMoney(groupTotal)}
                    </span>
                  </div>
                  {group.items.map((item) => (
                    <div key={item.id} className="px-5 py-3 border-b border-slate-100 last:border-0">
                      <div className="flex flex-wrap md:flex-nowrap items-start gap-3">
                        {/* Description + notes */}
                        <div className="w-full md:w-auto md:flex-1 min-w-[220px]">
                          {fieldLabel('Item Description')}
                          <input
                            type="text"
                            defaultValue={item.description}
                            onBlur={(e) => {
                              const description = e.target.value.trim();
                              if (description && description !== item.description) {
                                updateItem(item.id, { description });
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                            className={inputClass}
                          />
                          <input
                            type="text"
                            defaultValue={item.notes || ''}
                            placeholder="Selection note — deadline, approved store, range…"
                            onBlur={(e) => {
                              const notes = e.target.value.trim();
                              if (notes !== (item.notes || '')) {
                                updateItem(item.id, { notes: notes || undefined });
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                            className={`${inputClass} mt-1.5 text-[11px] text-slate-500`}
                          />
                        </div>

                        {/* Category */}
                        <div className="w-[132px]">
                          {fieldLabel('Category')}
                          <select
                            value={item.category}
                            onChange={(e) => updateItem(item.id, { category: e.target.value })}
                            className={inputClass}
                          >
                            {SELECTION_CATEGORIES.map((category) => (
                              <option key={category} value={category}>
                                {category}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Qty */}
                        <div className="w-[64px]">
                          {fieldLabel('Qty')}
                          <input
                            type="number"
                            min={0}
                            step="any"
                            defaultValue={item.qty}
                            onChange={(e) => commitQty(item.id, e.target.value)}
                            className={`${inputClass} tabular-nums`}
                          />
                        </div>

                        {/* UOM */}
                        <div className="w-[60px]">
                          {fieldLabel('Unit')}
                          <input
                            type="text"
                            defaultValue={item.uom}
                            maxLength={5}
                            onBlur={(e) => {
                              const uom = e.target.value.trim().toUpperCase();
                              if (uom && uom !== item.uom) updateItem(item.id, { uom });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                            className={inputClass}
                          />
                        </div>

                        {/* Allowance / unit */}
                        <div className="w-[88px]">
                          {fieldLabel('$/Unit')}
                          <input
                            type="number"
                            min={0}
                            step="any"
                            defaultValue={item.allowance_per_unit}
                            onChange={(e) => commitUnitCost(item.id, e.target.value)}
                            className={`${inputClass} tabular-nums`}
                          />
                        </div>

                        {/* Total (display) */}
                        <div className="w-[96px] pt-5">
                          <p className="text-[13px] font-bold text-slate-900 tabular-nums text-right">
                            {formatMoney(item.allowance_total)}
                          </p>
                          <p className="text-[10px] text-slate-400 text-right mt-0.5">
                            total allowance
                          </p>
                        </div>

                        {/* Vendor */}
                        <div className="w-[148px]">
                          {fieldLabel('Vendor')}
                          <input
                            type="text"
                            defaultValue={item.vendor || ''}
                            placeholder="Suggested vendor"
                            onBlur={(e) => {
                              const vendor = e.target.value.trim();
                              if (vendor !== (item.vendor || '')) {
                                updateItem(item.id, { vendor: vendor || undefined });
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                            className={inputClass}
                          />
                        </div>

                        {/* Remove */}
                        <div className="pt-5">
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            aria-label={`Remove ${item.description}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer actions */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setAddOpen((open) => !open)}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-red-600 hover:text-red-700"
          >
            <Plus className="w-3.5 h-3.5" />
            {addOpen ? 'Hide Add Form' : 'Add Selection Item'}
          </button>
          {estimate.components_filename && (
            <span className="text-[11px] text-slate-400 truncate ml-3">
              Component report: {estimate.components_filename}
            </span>
          )}
        </div>
      </div>

      {/* Add item form */}
      {addOpen && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-none px-5 py-4">
          <h3 className="text-[13px] font-semibold text-slate-900 mb-3">Add a Customer Selection Item</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="col-span-2">
              {fieldLabel('Item Description')}
              <input
                type="text"
                value={addForm.description}
                onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                placeholder="e.g. Luxury Vinyl Plank — click-lock, 12 mil wear layer"
                className={inputClass}
              />
            </div>
            <div>
              {fieldLabel('Category')}
              <select
                value={addForm.category}
                onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}
                className={inputClass}
              >
                {SELECTION_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <div>
              {fieldLabel('Trade Package')}
              <input
                type="text"
                value={addForm.trade}
                onChange={(e) => setAddForm({ ...addForm, trade: e.target.value })}
                placeholder="e.g. Flooring"
                className={inputClass}
              />
            </div>
            <div>
              {fieldLabel('Qty')}
              <input
                type="number"
                min={0}
                step="any"
                value={addForm.qty}
                onChange={(e) => setAddForm({ ...addForm, qty: e.target.value })}
                placeholder="320"
                className={`${inputClass} tabular-nums`}
              />
            </div>
            <div>
              {fieldLabel('Unit')}
              <select
                value={addForm.uom}
                onChange={(e) => setAddForm({ ...addForm, uom: e.target.value })}
                className={inputClass}
              >
                {UOM_OPTIONS.map((uom) => (
                  <option key={uom} value={uom}>
                    {uom}
                  </option>
                ))}
              </select>
            </div>
            <div>
              {fieldLabel('Allowance $/Unit')}
              <input
                type="number"
                min={0}
                step="any"
                value={addForm.unit}
                onChange={(e) => setAddForm({ ...addForm, unit: e.target.value })}
                placeholder="3.25"
                className={`${inputClass} tabular-nums`}
              />
            </div>
            <div>
              {fieldLabel('Suggested Vendor')}
              <input
                type="text"
                value={addForm.vendor}
                onChange={(e) => setAddForm({ ...addForm, vendor: e.target.value })}
                placeholder="Optional"
                className={inputClass}
              />
            </div>
            <div className="col-span-2">
              {fieldLabel('Selection Note')}
              <input
                type="text"
                value={addForm.notes}
                onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
                placeholder="Optional — deadline, approved stores, ranges"
                className={inputClass}
              />
            </div>
            <div className="col-span-2 md:col-span-4 flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="h-10 px-4 rounded-lg text-[13px] font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitAdd}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-[13px] font-semibold bg-red-600 text-white hover:bg-red-700 shadow-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Totals card */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-none px-5 py-4">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
              Selection Allowance Subtotal
            </p>
            <p className="text-[24px] font-bold text-slate-900 tabular-nums mt-1">
              {formatMoney(totals.subtotal)}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-none px-5 py-4">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
              Indiana Material Sales Tax (7%)
            </p>
            <p className="text-[24px] font-bold text-slate-900 tabular-nums mt-1">
              {formatMoney(totals.tax)}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-red-200 shadow-none px-5 py-4">
            <p className="text-[11px] font-semibold text-red-600 uppercase tracking-wide">
              Total Customer Selection Allowance
            </p>
            <p className="text-[24px] font-bold text-red-600 tabular-nums mt-1">
              {formatMoney(totals.total)}
            </p>
          </div>
        </div>
      )}

      {/* Rebuild confirmation */}
      <ConfirmModal
        isOpen={confirmRebuild}
        title="Rebuild Customer Selections?"
        subtitle="Replace the current selection rows"
        message={`This replaces all ${items.length} current selection item(s) with rows derived from the ${materialAllowanceCount} material allowance row(s) extracted from the estimate. Manual edits will be lost.`}
        confirmLabel="Rebuild"
        onConfirm={handleRebuild}
        onCancel={() => setConfirmRebuild(false)}
      />
    </div>
  );
};
