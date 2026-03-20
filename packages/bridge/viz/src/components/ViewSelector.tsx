import type { ViewMode } from '../lib/types';

interface ViewSelectorProps {
  current: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const TABS: { mode: ViewMode; label: string; disabled?: boolean }[] = [
  { mode: 'definition', label: 'Definition' },
  { mode: 'live', label: 'Live' },
  { mode: 'history', label: 'History', disabled: true },
];

export function ViewSelector({ current, onChange }: ViewSelectorProps) {
  return (
    <div className="view-selector">
      {TABS.map((tab) => {
        const isActive = current === tab.mode;
        let className = 'view-selector__tab';
        if (isActive) className += ' view-selector__tab--active';
        if (tab.disabled) className += ' view-selector__tab--disabled';

        return (
          <button
            key={tab.mode}
            className={className}
            onClick={() => !tab.disabled && onChange(tab.mode)}
            disabled={tab.disabled}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
