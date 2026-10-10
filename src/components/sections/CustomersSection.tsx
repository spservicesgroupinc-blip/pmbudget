import React, { useEffect, useMemo, useState } from 'react';
import {
  Users, RefreshCw, Search, FolderOpen, Trash2, Save, Loader2, HardDrive, FileClock,
} from 'lucide-react';
import { ConfirmModal } from '../ConfirmModal';
import type { EstimateResult } from '../../types/estimate';
import { formatMoney } from '../../utils/workOrders';
import {
  CustomerProfileSummary,
  listCustomerProfiles,
  getCustomerProfile,
  deleteCustomerProfile,
} from '../../services/gappsApi';

interface CustomersSectionProps {
  currentEstimate: EstimateResult | null;
  onSaveCurrent: () => Promise<void> | null;
  isSaving: boolean;
  onOpenProfile: (estimate: EstimateResult, profile: CustomerProfileSummary) => void;
  onShowToast: (type: 'success' | 'warning' | 'error', message: string) => void;
}

const fmtDate = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
        ' ' +
        d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

export const CustomersSection: React.FC<CustomersSectionProps> = ({
  currentEstimate,
  onSaveCurrent,
  isSaving,
  onOpenProfile,
  onShowToast,
}) => {
  const [profiles, setProfiles] = useState<CustomerProfileSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{
    isOpen: boolean;
    profile: CustomerProfileSummary | null;
  }>({ isOpen: false, profile: null });

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setProfiles(await listCustomerProfiles());
    } catch (err: any) {
      setError(err?.message || 'Failed to load customer profiles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) =>
      [p.client_name, p.claim_number, p.carrier, p.property_address].join(' ').toLowerCase().includes(q)
    );
  }, [profiles, search]);

  const handleSaveCurrent = async () => {
    if (!currentEstimate) return;
    await onSaveCurrent();
    await refresh();
  };

  const handleOpen = async (p: CustomerProfileSummary) => {
    setOpeningId(p.customer_id);
    try {
      const loaded = await getCustomerProfile(p.customer_id);
      onOpenProfile(loaded.estimate, loaded.profile);
    } catch (err: any) {
      onShowToast('error', err?.message || 'Failed to load customer profile');
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-none">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-50 text-red-600">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
              Saved job records
            </h3>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Reopen a saved estimate or remove a job you no longer need.
            </p>
          </div>
        </div>
      </div>

      {/* Save current estimate */}
      {currentEstimate && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-none">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-50 text-red-600">
                <FolderOpen className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
                  Save Current Estimate
                </h3>
                <p className="text-[12px] text-slate-500 mt-0.5">
                  Save the latest budget, trade packages, and selections for this job.
                </p>
              </div>
            </div>

            <button
              onClick={() => void handleSaveCurrent()}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors shrink-0"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving…</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Current Estimate</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-none">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, claim, carrier, or address…"
              className="w-full px-3 py-2 pl-9 rounded-lg border border-slate-300 bg-white text-[13px] focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
            />
          </div>
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-none">
          <Loader2 className="w-6 h-6 animate-spin text-red-600 mx-auto" />
          <p className="text-[12px] text-slate-500 mt-3">Loading customer profiles…</p>
        </div>
      ) : error ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 shadow-none">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-[13px] text-rose-700">{error}</p>
            <button
              onClick={() => void refresh()}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-colors shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-none">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-3">
            <Users className="w-6 h-6" />
          </div>
          <h3 className="text-[14px] font-semibold text-slate-800">
            {profiles.length > 0 ? 'No profiles match your search.' : 'No customer profiles yet'}
          </h3>
          <p className="text-[12px] text-slate-500 max-w-sm mx-auto mt-1">
            {profiles.length > 0
              ? 'Try a different name, claim number, carrier, or address.'
              : 'Process an estimate or press Save Current Estimate to create the first customer record.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((p) => (
            <div
              key={p.customer_id}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-none flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <span className="font-semibold text-slate-900 text-[14px] truncate">
                    {p.client_name}
                  </span>
                  <span className="text-[11px] font-semibold bg-slate-100 text-slate-600 rounded px-2 py-0.5 whitespace-nowrap">
                    Claim {p.claim_number}
                  </span>
                </div>

                <div className="space-y-1.5 mb-3">
                  <p className="text-[12px] text-slate-500">
                    <span className="font-medium text-slate-700">Carrier:</span>{' '}
                    {p.carrier || '—'}
                  </p>
                  <p className="text-[12px] text-slate-500">
                    <span className="font-medium text-slate-700">Address:</span>{' '}
                    {p.property_address || '—'}
                  </p>
                  <p className="text-[12px] text-slate-500">
                    <span className="font-medium text-slate-700">Estimate RCV:</span>{' '}
                    {formatMoney(Number(p.total_rcv) || 0)}
                  </p>
                  <p className="text-[12px] text-slate-500 flex items-center gap-1">
                    <FileClock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Updated {fmtDate(p.updated_at)}</span>
                  </p>
                  {p.created_by && (
                    <p className="text-[12px] text-slate-500">
                      <span className="font-medium text-slate-700">Created by:</span>{' '}
                      {p.created_by}
                    </p>
                  )}
                </div>

                {p.estimate_json_url && (
                  <a
                    href={p.estimate_json_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-red-600 hover:text-red-700 transition-colors"
                  >
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>Profile JSON in Drive</span>
                  </a>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  onClick={() => void handleOpen(p)}
                  disabled={openingId === p.customer_id}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  {openingId === p.customer_id ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Opening…</span>
                    </>
                  ) : (
                    <>
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Open</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => setDeleting({ isOpen: true, profile: p })}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold text-red-600 border border-red-200 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={deleting.isOpen}
        title="Delete Customer Profile?"
        subtitle={
          deleting.profile
            ? `${deleting.profile.client_name} — Claim ${deleting.profile.claim_number}`
            : undefined
        }
        message="This removes the customer record from the workspace database."
        consequence="Saved Drive files are kept. You can recreate the profile by processing or saving the estimate again."
        confirmLabel="Delete Profile"
        isDestructive
        onConfirm={async () => {
          const target = deleting.profile;
          setDeleting({ isOpen: false, profile: null });
          if (!target) return;
          try {
            await deleteCustomerProfile(target.customer_id);
            onShowToast('success', `Deleted ${target.client_name} (Claim ${target.claim_number}).`);
            await refresh();
          } catch (err: any) {
            onShowToast('error', err?.message || 'Failed to delete customer profile');
          }
        }}
        onCancel={() => setDeleting({ isOpen: false, profile: null })}
      />
    </div>
  );
};
