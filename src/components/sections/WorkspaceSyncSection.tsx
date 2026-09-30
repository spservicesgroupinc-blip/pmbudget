import React, { useState } from 'react';
import {
  FileSpreadsheet,
  FileText,
  Calendar,
  HardDrive,
  ExternalLink,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Share2,
  ShieldCheck,
  ArrowUpRight,
} from 'lucide-react';
import { EstimateResult } from '../../types/estimate';
import { GappsUser } from '../../services/gappsAuth';
import {
  createSheetsBudget,
  createDocsScopeAgreement,
  syncCalendarEvents,
  savePackageToDrive,
  WorkspaceExportResult,
} from '../../services/gappsApi';
import { computeSchedule, getNextMonday } from '../../utils/scheduler';
import { ConfirmModal } from '../ConfirmModal';

interface WorkspaceSyncSectionProps {
  estimate: EstimateResult | null;
  currentUser: GappsUser | null;
  onShowToast: (type: 'success' | 'warning' | 'error', message: string) => void;
}

export const WorkspaceSyncSection: React.FC<WorkspaceSyncSectionProps> = ({
  estimate,
  currentUser,
  onShowToast,
}) => {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [createdItems, setCreatedItems] = useState<WorkspaceExportResult[]>([]);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    consequence?: string;
    action: () => Promise<void>;
  }>({
    isOpen: false,
    title: '',
    message: '',
    action: async () => {},
  });

  if (!estimate) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-none">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-3">
          <Share2 className="w-6 h-6" />
        </div>
        <h3 className="text-[14px] font-semibold text-slate-800">
          No Estimate Available to Sync
        </h3>
        <p className="text-[12px] text-slate-500 max-w-sm mx-auto mt-1">
          Please upload or load an Xactimate estimate before exporting to Google Sheets, Docs, Calendar, or Drive.
        </p>
      </div>
    );
  }

  // 1. Export to Google Sheets
  const handleExportSheets = async () => {
    setLoadingAction('sheets');
    try {
      const res = await createSheetsBudget(estimate, 60);
      setCreatedItems((prev) => [res, ...prev.filter((i) => i.type !== 'sheets')]);
      onShowToast('success', 'Google Sheet created successfully!');
    } catch (err: any) {
      console.error(err);
      onShowToast('error', err.message || 'Failed to create Google Sheet');
    } finally {
      setLoadingAction(null);
    }
  };

  // 2. Export to Google Docs
  const handleExportDocs = async () => {
    setLoadingAction('docs');
    try {
      const res = await createDocsScopeAgreement(estimate, getNextMonday());
      setCreatedItems((prev) => [res, ...prev.filter((i) => i.type !== 'docs')]);
      onShowToast('success', 'Google Docs agreement created!');
    } catch (err: any) {
      console.error(err);
      onShowToast('error', err.message || 'Failed to create Google Doc');
    } finally {
      setLoadingAction(null);
    }
  };

  // 3. Sync to Google Calendar (with confirmation modal)
  const promptCalendarSync = () => {
    const schedule = computeSchedule(estimate.trade_sections, getNextMonday());
    setConfirmModal({
      isOpen: true,
      title: 'Sync Milestones to Google Calendar?',
      message: `This will create ${schedule.tasks.length} sequenced trade package milestone events in your primary Google Calendar starting on ${getNextMonday()}.`,
      consequence:
        'Events will appear on your Google Calendar schedule. You can edit or remove them anytime from Google Calendar.',
      action: async () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        setLoadingAction('calendar');
        try {
          const res = await syncCalendarEvents(estimate, schedule.tasks);
          setCreatedItems((prev) => [res, ...prev.filter((i) => i.type !== 'calendar')]);
          onShowToast(
            'success',
            `Synced ${res.count || schedule.tasks.length} trade milestones to Google Calendar!`
          );
        } catch (err: any) {
          console.error(err);
          onShowToast('error', err.message || 'Failed to sync calendar');
        } finally {
          setLoadingAction(null);
        }
      },
    });
  };

  // 4. Save to Google Drive
  const handleSaveDrive = async () => {
    setLoadingAction('drive');
    try {
      const res = await savePackageToDrive(estimate);
      setCreatedItems((prev) => [res, ...prev.filter((i) => i.type !== 'drive')]);
      onShowToast('success', 'Project JSON package saved to Google Drive!');
    } catch (err: any) {
      console.error(err);
      onShowToast('error', err.message || 'Failed to save to Drive');
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Workspace Connection Banner */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-none">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">
                  Google Workspace Direct Integrations
                </h3>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                    currentUser
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}
                >
                  {currentUser ? 'Connected' : 'Sign-in Required'}
                </span>
              </div>
              <p className="text-[12px] text-slate-500 mt-0.5">
                {currentUser
                  ? `Connected as ${currentUser.email} — Sheets, Docs, Calendar, and Drive exports are written to the Hays + Sons workspace via Apps Script.`
                  : 'Sign in to export live spreadsheets, subcontractor agreements, and calendar schedules.'}
              </p>
            </div>
          </div>

          <div>
            {currentUser && (
              <div className="flex items-center gap-2 text-[12px] text-emerald-800 font-medium bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Ready to Sync</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Grid of 4 Workspace Tools */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Tool 1: Google Sheets */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-none flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-semibold font-mono text-slate-400">
                sheets.googleapis.com
              </span>
            </div>
            <h4 className="text-[14px] font-semibold text-slate-900">
              Subcontractor Buyout Budget Spreadsheet
            </h4>
            <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
              Creates a Google Sheet with tabular trade packages, approved Xactimate RCV, target buyout allowances, subcontractor bids, and gross profit reconciliation.
            </p>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Full cell formula support</span>
            <button
              onClick={handleExportSheets}
              disabled={loadingAction === 'sheets'}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {loadingAction === 'sheets' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Creating Sheet…</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Export to Sheets</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tool 2: Google Docs */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-none flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-blue-50 text-blue-700">
                <FileText className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-semibold font-mono text-slate-400">
                docs.googleapis.com
              </span>
            </div>
            <h4 className="text-[14px] font-semibold text-slate-900">
              Trade Scope of Work &amp; Sub Agreement
            </h4>
            <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
              Generates a formatted Subcontractor Agreement document in Google Docs complete with trade scope descriptions, schedule milestones, general restoration conditions, and signature blocks.
            </p>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Printable &amp; signable</span>
            <button
              onClick={handleExportDocs}
              disabled={loadingAction === 'docs'}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {loadingAction === 'docs' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Generating Doc…</span>
                </>
              ) : (
                <>
                  <FileText className="w-3.5 h-3.5" />
                  <span>Generate Doc</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tool 3: Google Calendar */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-none flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-amber-50 text-amber-700">
                <Calendar className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-semibold font-mono text-slate-400">
                calendar.googleapis.com
              </span>
            </div>
            <h4 className="text-[14px] font-semibold text-slate-900">
              Project Schedule Calendar Milestones
            </h4>
            <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
              Schedules all sequenced trade packages into your Google Calendar as all-day milestone events, including durations, predecessor notes, and approved scopes.
            </p>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Requires confirmation</span>
            <button
              onClick={promptCalendarSync}
              disabled={loadingAction === 'calendar'}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {loadingAction === 'calendar' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Syncing Calendar…</span>
                </>
              ) : (
                <>
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Sync to Calendar</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tool 4: Google Drive */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-none flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 rounded-lg bg-purple-50 text-purple-700">
                <HardDrive className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-semibold font-mono text-slate-400">
                drive.googleapis.com
              </span>
            </div>
            <h4 className="text-[14px] font-semibold text-slate-900">
              Google Drive Project Archive
            </h4>
            <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
              Saves the parsed project record, trade packages, buyout data, and metadata directly as an archive file in your Google Drive.
            </p>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">JSON Archive file</span>
            <button
              onClick={handleSaveDrive}
              disabled={loadingAction === 'drive'}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {loadingAction === 'drive' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving to Drive…</span>
                </>
              ) : (
                <>
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>Save to Drive</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Generated Documents History & Quick Links */}
      {createdItems.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-none">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <h3 className="text-[14px] font-semibold text-slate-900">
                Active Google Workspace Links ({createdItems.length})
              </h3>
            </div>
            <span className="text-[11px] text-slate-400">
              Click to open directly in Google apps
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {createdItems.map((item, idx) => (
              <div
                key={idx}
                className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`p-1.5 rounded-md ${
                      item.type === 'sheets'
                        ? 'bg-emerald-50 text-emerald-700'
                        : item.type === 'docs'
                        ? 'bg-blue-50 text-blue-700'
                        : item.type === 'calendar'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-purple-50 text-purple-700'
                    }`}
                  >
                    {item.type === 'sheets' && <FileSpreadsheet className="w-4 h-4" />}
                    {item.type === 'docs' && <FileText className="w-4 h-4" />}
                    {item.type === 'calendar' && <Calendar className="w-4 h-4" />}
                    {item.type === 'drive' && <HardDrive className="w-4 h-4" />}
                  </span>
                  <div>
                    <h5 className="text-[13px] font-semibold text-slate-900">
                      {item.title}
                    </h5>
                    <p className="text-[11px] text-slate-400 capitalize">
                      Google {item.type} resource
                    </p>
                  </div>
                </div>

                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 transition-colors"
                >
                  <span>Open in {item.type.toUpperCase()}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmation Modal for Calendar sync */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        consequence={confirmModal.consequence}
        confirmLabel="Sync to Calendar"
        cancelLabel="Cancel"
        onConfirm={confirmModal.action}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};
