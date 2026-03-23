/**
 * Execute confirmation dialog for strategy execution.
 *
 * Extracted from Strategies.tsx and StrategyDetail.tsx to deduplicate.
 * Includes Escape key handler and autoFocus for accessibility.
 */

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/shared/components/Button';
import { Badge } from '@/shared/components/Badge';
import type { StrategyDefinition, ContextInputDef } from '@/lib/types';
import { Play } from 'lucide-react';

export interface ExecuteDialogProps {
  definition: StrategyDefinition;
  open: boolean;
  onClose: () => void;
  onExecute: (inputs: Record<string, unknown>) => void;
  loading: boolean;
}

export function ExecuteDialog({ definition, open, onClose, onExecute, loading }: ExecuteDialogProps) {
  const [inputs, setInputs] = useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {};
    for (const ci of definition.context_inputs) {
      defaults[ci.name] = ci.default ?? '';
    }
    return defaults;
  });

  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Auto-focus the dialog container when opened
  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-void/60 backdrop-blur-sm animate-backdrop-fade"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          tabIndex={-1}
          className="w-full max-w-md rounded-card border border-bdr bg-abyss p-sp-6 shadow-2xl focus:outline-none"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="font-display text-md text-txt font-semibold mb-1">
            Execute Strategy
          </h3>
          <p className="text-xs text-txt-dim mb-sp-4">
            {definition.name} ({definition.id})
          </p>

          {/* Context input fields */}
          {definition.context_inputs.length > 0 && (
            <div className="space-y-sp-3 mb-sp-5">
              <p className="text-xs text-txt-muted font-medium uppercase tracking-wider">
                Context Inputs
              </p>
              {definition.context_inputs.map((ci: ContextInputDef, idx: number) => (
                <div key={ci.name}>
                  <label className="block text-xs text-txt-dim mb-1">
                    <span className="font-mono">{ci.name}</span>
                    <Badge variant="default" label={ci.type} className="ml-2" />
                  </label>
                  {ci.type === 'object' ? (
                    <textarea
                      autoFocus={idx === 0}
                      className="w-full rounded-lg border border-bdr bg-void px-3 py-2 text-xs font-mono text-txt focus:border-bio focus:outline-none resize-y min-h-[60px]"
                      value={
                        typeof inputs[ci.name] === 'string'
                          ? (inputs[ci.name] as string)
                          : JSON.stringify(inputs[ci.name], null, 2)
                      }
                      onChange={(e) => {
                        try {
                          setInputs({ ...inputs, [ci.name]: JSON.parse(e.target.value) });
                        } catch {
                          setInputs({ ...inputs, [ci.name]: e.target.value });
                        }
                      }}
                    />
                  ) : (
                    <input
                      type={ci.type === 'number' ? 'number' : 'text'}
                      autoFocus={idx === 0}
                      className="w-full rounded-lg border border-bdr bg-void px-3 py-2 text-xs font-mono text-txt focus:border-bio focus:outline-none"
                      value={String(inputs[ci.name] ?? '')}
                      onChange={(e) => {
                        const val =
                          ci.type === 'number'
                            ? parseFloat(e.target.value) || 0
                            : e.target.value;
                        setInputs({ ...inputs, [ci.name]: val });
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={loading}
              leftIcon={<Play className="h-3.5 w-3.5" />}
              onClick={() => onExecute(inputs)}
            >
              Execute
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
