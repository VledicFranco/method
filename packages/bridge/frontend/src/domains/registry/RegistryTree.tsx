/**
 * PRD 019.2 Component 2: Registry Tree View (Sidebar)
 *
 * Collapsible tree showing all methodologies and their methods/protocols.
 * Status icons: compiled=green check, draft=gray circle, promoted=cyan star, trial=solar flask.
 * Client-side search filtering.
 */

import { useState, useMemo } from 'react';
import {
  Check, Circle, Star, FlaskConical, ChevronRight, Search, AlertCircle,
} from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { RegistryMethodologySummary, RegistryMethodSummary } from '@/domains/registry/types';

// ── Status Icons ──

function StatusIcon({ status, type }: { status: string; type: 'method' | 'protocol' }) {
  if (type === 'protocol') {
    if (status === 'promoted') {
      return <Star className="h-3.5 w-3.5 text-cyan shrink-0" />;
    }
    if (status === 'trial') {
      return <FlaskConical className="h-3.5 w-3.5 text-solar shrink-0" />;
    }
    // draft protocol
    return <Circle className="h-3.5 w-3.5 text-txt-muted shrink-0" />;
  }

  // Method statuses
  if (status === 'compiled') {
    return <Check className="h-3.5 w-3.5 text-bio shrink-0" />;
  }
  if (status === 'PASS_WITH_WIP') {
    return <AlertCircle className="h-3.5 w-3.5 text-solar shrink-0" />;
  }
  // draft
  return <Circle className="h-3.5 w-3.5 text-txt-muted shrink-0" />;
}

// ── Props ──

export interface RegistryTreeProps {
  methodologies: RegistryMethodologySummary[];
  totals: {
    methodologies: number;
    methods: number;
    protocols: number;
  };
  selectedMethodology: string | null;
  selectedMethod: string | null;
  onSelect: (methodologyId: string, methodId: string) => void;
  className?: string;
}

export function RegistryTree({
  methodologies,
  totals,
  selectedMethodology,
  selectedMethod,
  onSelect,
  className,
}: RegistryTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(methodologies.map(m => m.id)));
  const [searchTerm, setSearchTerm] = useState('');

  // Filter tree by search term
  const filteredMethodologies = useMemo(() => {
    if (!searchTerm.trim()) return methodologies;

    const term = searchTerm.toLowerCase();
    return methodologies
      .map((m) => {
        const matchingMethods = m.methods.filter(
          (method) =>
            method.id.toLowerCase().includes(term) ||
            method.name.toLowerCase().includes(term),
        );
        if (matchingMethods.length > 0) {
          return { ...m, methods: matchingMethods, method_count: matchingMethods.length };
        }
        // Also match on methodology id/name
        if (m.id.toLowerCase().includes(term) || m.name.toLowerCase().includes(term)) {
          return m;
        }
        return null;
      })
      .filter(Boolean) as RegistryMethodologySummary[];
  }, [methodologies, searchTerm]);

  // When search is active, expand all matching
  const effectiveExpanded = searchTerm.trim()
    ? new Set(filteredMethodologies.map((m) => m.id))
    : expandedIds;

  function toggleExpanded(id: string) {
    if (searchTerm.trim()) return; // Don't toggle during search
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalItems = totals.methods + totals.protocols;

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-bdr">
        <h2 className="font-display text-md text-txt font-semibold tracking-tight">Registry</h2>
        <p className="text-[0.7rem] text-txt-dim mt-0.5 font-mono">
          {totals.methodologies} methodologies, {totalItems} items
        </p>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-bdr">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-txt-muted" />
          <input
            type="text"
            placeholder="Search methods..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={cn(
              'w-full pl-8 pr-3 py-1.5 rounded-lg text-sm',
              'bg-abyss border border-bdr text-txt placeholder:text-txt-muted',
              'focus:outline-none focus:border-bio/40 focus:ring-1 focus:ring-bio/20',
              'transition-colors',
            )}
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {filteredMethodologies.length === 0 && (
          <p className="px-4 py-8 text-sm text-txt-dim text-center">No methods match your search.</p>
        )}
        {filteredMethodologies.map((m) => {
          const isExpanded = effectiveExpanded.has(m.id);

          return (
            <div key={m.id}>
              {/* Methodology header */}
              <button
                onClick={() => toggleExpanded(m.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-left',
                  'hover:bg-abyss-light transition-colors duration-150',
                )}
              >
                <ChevronRight
                  className={cn(
                    'h-3.5 w-3.5 text-txt-muted transition-transform duration-200 shrink-0',
                    isExpanded && 'rotate-90',
                  )}
                />
                <span className="font-mono text-[0.75rem] text-bio font-medium">{m.id}</span>
                <span className="text-[0.75rem] text-txt-dim truncate flex-1">{m.name}</span>
                <span className="font-mono text-[0.65rem] text-txt-muted shrink-0">{m.method_count}</span>
              </button>

              {/* Method items */}
              {isExpanded && (
                <div className="pb-1">
                  {m.methods.map((method) => {
                    const isSelected = selectedMethodology === m.id && selectedMethod === method.id;

                    return (
                      <button
                        key={method.id}
                        onClick={() => onSelect(m.id, method.id)}
                        className={cn(
                          'w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-left',
                          'transition-colors duration-150',
                          isSelected
                            ? 'bg-bio-dim border-r-2 border-r-bio'
                            : 'hover:bg-abyss-light',
                        )}
                      >
                        <StatusIcon status={method.status} type={method.type} />
                        <span
                          className={cn(
                            'font-mono text-[0.75rem] flex-1 truncate',
                            isSelected ? 'text-bio' : 'text-txt-dim',
                          )}
                        >
                          {method.id}
                        </span>
                        <span className="font-mono text-[0.6rem] text-txt-muted shrink-0">
                          v{method.version}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
