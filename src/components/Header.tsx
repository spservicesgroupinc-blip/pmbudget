import React from 'react';
import { FileSpreadsheet, LogOut, RotateCcw, UploadCloud } from 'lucide-react';
import type { EstimateResult } from '../types/estimate';
import type { GappsUser } from '../services/gappsAuth';
import { BrandLogo } from './BrandLogo';
import { InstallPwa } from './InstallPwa';

interface HeaderProps {
  currentEstimate: EstimateResult | null;
  currentUser: GappsUser | null;
  onSignOut: () => void;
  onReset: () => void;
  onNavigateSection: (sectionId: string) => void;
}

const ACTION_CLASS = 'inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-2 rounded-lg border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500';

export const Header: React.FC<HeaderProps> = ({
  currentEstimate, currentUser, onSignOut, onReset, onNavigateSection,
}) => {
  const meta = currentEstimate?.project_meta;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto w-full max-w-[1400px] px-3 sm:px-5">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-2 py-2 sm:flex-nowrap sm:gap-4">
          <BrandLogo size={30} withWordmark sublabel="Project Manager Workspace" className="shrink-0" />

          <div className="hidden min-w-0 flex-1 lg:block">
            <p className="truncate text-sm font-semibold text-slate-800">{meta?.client_name || 'No job selected'}</p>
            <p className="mt-0.5 truncate text-xs text-slate-500">{meta ? `Claim ${meta.claim_number} · ${meta.carrier}` : 'Open a saved job or start with an estimate'}</p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:gap-2">
            <InstallPwa />
            {meta && (
              <button type="button" onClick={onReset} title="Reset current estimate" aria-label="Reset current estimate"
                className={`${ACTION_CLASS} border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900`}>
                <RotateCcw className="h-4 w-4" aria-hidden /><span className="hidden xl:inline">Reset</span>
              </button>
            )}
            <button type="button" onClick={() => onNavigateSection(meta ? 'workspace' : 'intake')}
              aria-label={meta ? 'Export project' : 'Upload estimate'} title={meta ? 'Export project' : 'Upload estimate'}
              className={`${ACTION_CLASS} border-red-600 bg-red-600 text-white hover:border-red-700 hover:bg-red-700`}>
              {meta ? <FileSpreadsheet className="h-4 w-4" aria-hidden /> : <UploadCloud className="h-4 w-4" aria-hidden />}
              <span className="hidden sm:inline">{meta ? 'Export' : 'Upload estimate'}</span>
            </button>
            {currentUser && (
              <button type="button" onClick={onSignOut} title={`Signed in as ${currentUser.email}. Sign out.`} aria-label="Sign out"
                className={`${ACTION_CLASS} border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900`}>
                <span className="hidden max-w-28 truncate xl:inline">{currentUser.name || currentUser.email}</span>
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-between gap-3 border-t border-slate-100 py-2 lg:hidden">
          <span className="min-w-0 truncate text-xs font-medium text-slate-700">{meta?.client_name || 'No job selected'}</span>
          {meta && <span className="max-w-[45%] truncate text-[11px] text-slate-500">Claim {meta.claim_number}</span>}
        </div>
      </div>
    </header>
  );
};
