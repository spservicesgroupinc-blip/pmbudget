import React from 'react';
import {
  FileSpreadsheet,
  RotateCcw,
  LogOut,
  Calendar,
  CheckCircle2,
  FileText,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { InstallPwa } from './InstallPwa';
import { EstimateResult } from '../types/estimate';
import { GappsUser } from '../services/gappsAuth';

interface HeaderProps {
  currentEstimate: EstimateResult | null;
  currentUser: GappsUser | null;
  onSignOut: () => void;
  onReset: () => void;
  onNavigateSection: (sectionId: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentEstimate,
  currentUser,
  onSignOut,
  onReset,
  onNavigateSection,
}) => {
  const meta = currentEstimate?.project_meta;

  return (
    <header className="h-16 sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="max-w-[1400px] h-full mx-auto px-5 flex items-center justify-between gap-4">
        {/* Logo & Brand */}
        <BrandLogo size={34} withWordmark />

        {/* Center Context Chip */}
        <div className="hidden md:flex items-center gap-2 min-w-0">
          {meta ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[12px]">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="font-semibold text-slate-900 truncate max-w-[180px]">
                {meta.client_name}
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-600 font-mono text-[11px]">
                Claim #{meta.claim_number}
              </span>
              <span className="text-slate-400">·</span>
              <span className="font-semibold text-slate-900 tabular-nums">
                ${meta.total_rcv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RCV
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-dashed border-slate-200 text-[12px] text-slate-500">
              <span className="w-2 h-2 rounded-full bg-slate-300 shrink-0" />
              <span>No estimate loaded — Upload PDF or select sample</span>
            </div>
          )}
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Google Workspace Session (Sheets-backed login) */}
          {currentUser && (
            <div className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg border border-emerald-200 bg-emerald-50/50">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-[11px] font-medium text-emerald-800 hidden sm:inline">
                {currentUser.name || currentUser.email}
              </span>
              <button
                onClick={onSignOut}
                title={`Signed in as ${currentUser.email}. Click to sign out.`}
                className="p-1 rounded text-slate-400 hover:text-rose-600 transition-colors"
                aria-label="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* PWA install (hidden when already installed or unsupported) */}
          <InstallPwa />

          {/* Reset button if estimate exists */}
          {currentEstimate && (
            <button
              onClick={onReset}
              title="Reset current estimate"
              className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-[12px] font-medium transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              <span className="hidden sm:inline">Reset</span>
            </button>
          )}

          {/* Primary Action Button */}
          {currentEstimate ? (
            <button
              onClick={() => onNavigateSection('workspace')}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold bg-red-600 text-white hover:bg-red-700 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Workspace Export</span>
            </button>
          ) : (
            <button
              onClick={() => onNavigateSection('intake')}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold bg-red-600 text-white hover:bg-red-700 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
            >
              <FileText className="w-4 h-4" />
              <span>Select Estimate</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
