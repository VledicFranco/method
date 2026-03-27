import { useProjects } from '@/domains/projects/useProjects';
import { RefreshCw } from 'lucide-react';
import type { ProjectMetadata } from '@/domains/projects/types';
import { memo, useState, useMemo } from 'react';

// -- Vidtecci color palette (inline, no external deps) --
const colors = {
  void: '#0a0e14',
  abyss: '#111923',
  bio: '#00e5a0',
  solar: '#f5a623',
  text: '#e0e8f0',
  textMuted: '#6b7d8e',
  border: 'rgba(255,255,255,0.08)',
  error: '#ff4757',
} as const;

type StatusFilter = 'all' | 'healthy' | 'issues' | 'with_sessions';

const PAGE_SIZE = 50;

export interface ProjectListViewProps {
  onProjectSelect?: (project: ProjectMetadata) => void;
}

function ProjectListViewComponent({
  onProjectSelect,
}: ProjectListViewProps) {
  const { projects, loading, error, refetch } = useProjects();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('all');
  const [showAll, setShowAll] = useState(false);

  // -- Derived stats --
  const stats = useMemo(() => {
    const healthy = projects.filter(p => p.status === 'healthy').length;
    const issues = projects.filter(p =>
      p.status === 'git_corrupted' || p.status === 'missing_config' || p.status === 'permission_denied'
    ).length;
    return { total: projects.length, healthy, issues };
  }, [projects]);

  // -- Filtered + searched list --
  const filteredProjects = useMemo(() => {
    let result = projects;

    // Status filter
    if (activeFilter === 'healthy') {
      result = result.filter(p => p.status === 'healthy');
    } else if (activeFilter === 'issues') {
      result = result.filter(p =>
        p.status === 'git_corrupted' || p.status === 'missing_config' || p.status === 'permission_denied'
      );
    }
    // 'with_sessions' would require session data; show all for now
    // 'all' — no filter

    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        p.path.toLowerCase().includes(q)
      );
    }

    return result;
  }, [projects, activeFilter, search]);

  const visibleProjects = showAll ? filteredProjects : filteredProjects.slice(0, PAGE_SIZE);
  const hasMore = filteredProjects.length > PAGE_SIZE && !showAll;

  // -- Status badge helper --
  const statusBadge = (status: string) => {
    let bg: string;
    let fg: string;
    switch (status) {
      case 'healthy':
        bg = 'rgba(0,229,160,0.12)';
        fg = colors.bio;
        break;
      case 'git_corrupted':
        bg = 'rgba(255,71,87,0.12)';
        fg = colors.error;
        break;
      case 'missing_config':
        bg = 'rgba(245,166,35,0.12)';
        fg = colors.solar;
        break;
      case 'permission_denied':
        bg = 'rgba(255,71,87,0.12)';
        fg = colors.error;
        break;
      default:
        bg = 'rgba(107,125,142,0.12)';
        fg = colors.textMuted;
    }
    const label = status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return (
      <span style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontFamily: 'monospace',
        fontWeight: 500,
        background: bg,
        color: fg,
        border: `1px solid ${fg}33`,
        lineHeight: '1.5',
      }}>
        {label}
      </span>
    );
  };

  // -- Filter chip helper --
  const chip = (label: string, value: StatusFilter) => {
    const isActive = activeFilter === value;
    return (
      <button
        key={value}
        onClick={() => setActiveFilter(value)}
        style={{
          padding: '4px 14px',
          borderRadius: '9999px',
          fontSize: '13px',
          fontFamily: 'monospace',
          fontWeight: 500,
          cursor: 'pointer',
          border: `1px solid ${isActive ? colors.bio : colors.border}`,
          background: isActive ? 'rgba(0,229,160,0.08)' : 'transparent',
          color: isActive ? colors.bio : colors.textMuted,
          transition: 'all 0.15s ease',
        }}
      >
        {label}
      </button>
    );
  };

  // -- Stat card helper --
  const statCard = (label: string, value: number | string, valueColor: string, icon: string) => (
    <div style={{
      flex: '1 1 0',
      minWidth: '140px',
      background: colors.abyss,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      padding: '16px 20px',
    }}>
      <div style={{
        fontSize: '12px',
        fontFamily: 'monospace',
        color: colors.textMuted,
        marginBottom: '6px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        <span style={{ marginRight: '6px' }}>{icon}</span>
        {label}
      </div>
      <div style={{
        fontSize: '28px',
        fontFamily: 'monospace',
        fontWeight: 700,
        color: valueColor,
        lineHeight: 1.1,
      }}>
        {value}
      </div>
    </div>
  );

  // -- Error state --
  if (error) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: colors.text, margin: 0 }}>Projects</h2>
          <button
            onClick={() => refetch()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '6px 14px', borderRadius: '6px', fontSize: '13px',
              fontFamily: 'monospace', cursor: 'pointer',
              border: `1px solid ${colors.border}`, background: colors.abyss, color: colors.textMuted,
            }}
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
        <div style={{
          background: colors.abyss, border: `1px solid rgba(255,71,87,0.3)`,
          borderRadius: '8px', padding: '16px 20px',
        }}>
          <p style={{ fontWeight: 500, color: colors.text, margin: '0 0 4px' }}>Failed to load projects</p>
          <p style={{ fontSize: '14px', color: colors.textMuted, margin: 0 }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* -- Stat cards row -- */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '20px',
        flexWrap: 'wrap',
      }}>
        {statCard('Projects', loading ? '...' : stats.total, colors.bio, '\u25A0')}
        {statCard('Healthy', loading ? '...' : stats.healthy, colors.bio, '\u2713')}
        {statCard('Issues', loading ? '...' : stats.issues, stats.issues > 0 ? colors.error : colors.textMuted, '\u26A0')}
        <div style={{
          flex: '1 1 0',
          minWidth: '140px',
          background: colors.abyss,
          border: `1px solid ${colors.border}`,
          borderRadius: '8px',
          padding: '16px 20px',
        }}>
          <div style={{
            fontSize: '12px',
            fontFamily: 'monospace',
            color: colors.textMuted,
            marginBottom: '6px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            <span style={{ marginRight: '6px' }}>{'\u25B6'}</span>
            Active Sessions
          </div>
          <a
            href="/sessions"
            style={{
              fontSize: '28px',
              fontFamily: 'monospace',
              fontWeight: 700,
              color: colors.textMuted,
              lineHeight: 1.1,
              textDecoration: 'none',
              display: 'block',
            }}
          >
            0
          </a>
        </div>
      </div>

      {/* -- Header row: title + scan button -- */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: colors.text, margin: 0 }}>Projects</h2>
          <p style={{ fontSize: '13px', color: colors.textMuted, margin: '4px 0 0' }}>
            {loading ? 'Discovering...' : `${projects.length} project${projects.length !== 1 ? 's' : ''} discovered`}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={loading}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '6px 14px', borderRadius: '6px', fontSize: '13px',
            fontFamily: 'monospace', cursor: loading ? 'wait' : 'pointer',
            border: `1px solid ${colors.border}`, background: colors.abyss, color: colors.textMuted,
            opacity: loading ? 0.6 : 1,
          }}
        >
          <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
          {loading ? 'Scanning' : 'Scan'}
        </button>
      </div>

      {/* -- Search bar + filter chips row -- */}
      <div style={{
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        marginBottom: '16px',
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 300px', position: 'relative' }}>
          <input
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 14px',
              borderRadius: '6px',
              fontSize: '14px',
              fontFamily: 'monospace',
              border: `1px solid ${colors.border}`,
              background: colors.abyss,
              color: colors.text,
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = `${colors.bio}66`; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = colors.border; }}
          />
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {chip('All', 'all')}
          {chip('Healthy', 'healthy')}
          {chip('Issues', 'issues')}
          {chip('With Sessions', 'with_sessions')}
        </div>
        <span style={{
          fontSize: '12px',
          fontFamily: 'monospace',
          color: colors.textMuted,
          whiteSpace: 'nowrap',
        }}>
          {filteredProjects.length} result{filteredProjects.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* -- Project table -- */}
      {filteredProjects.length === 0 ? (
        <div style={{
          background: colors.abyss, border: `1px solid ${colors.border}`,
          borderRadius: '8px', padding: '40px 20px', textAlign: 'center',
        }}>
          <p style={{ color: colors.textMuted, margin: '0 0 4px' }}>
            {projects.length === 0 ? 'No projects discovered yet.' : 'No projects match your filters.'}
          </p>
          {projects.length === 0 && (
            <p style={{ fontSize: '12px', color: colors.textMuted, margin: 0 }}>
              Check that your projects contain .method directories.
            </p>
          )}
        </div>
      ) : (
        <>
          <div style={{
            overflowX: 'auto',
            borderRadius: '8px',
            border: `1px solid ${colors.border}`,
            background: colors.abyss,
          }}>
            <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }} role="table">
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }} role="row">
                  <th style={{
                    padding: '10px 16px', textAlign: 'left', fontWeight: 500,
                    color: colors.textMuted, fontSize: '12px', fontFamily: 'monospace',
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }} role="columnheader">Name</th>
                  <th style={{
                    padding: '10px 16px', textAlign: 'left', fontWeight: 500,
                    color: colors.textMuted, fontSize: '12px', fontFamily: 'monospace',
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }} role="columnheader">Description</th>
                  <th style={{
                    padding: '10px 16px', textAlign: 'left', fontWeight: 500,
                    color: colors.textMuted, fontSize: '12px', fontFamily: 'monospace',
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                  }} role="columnheader">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleProjects.map((project, index) => {
                  const rowBg = index % 2 === 0 ? colors.void : colors.abyss;
                  return (
                    <tr
                      key={project.id}
                      onClick={() => onProjectSelect?.(project)}
                      role="row"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          onProjectSelect?.(project);
                        }
                      }}
                      style={{
                        background: rowBg,
                        cursor: 'pointer',
                        borderBottom: index === visibleProjects.length - 1 ? 'none' : `1px solid ${colors.border}`,
                        transition: 'background 0.1s ease',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,229,160,0.04)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = rowBg; }}
                    >
                      <td style={{ padding: '10px 16px', verticalAlign: 'top' }} role="cell">
                        <div style={{ fontWeight: 600, color: colors.text, fontSize: '14px' }}>
                          {project.name}
                        </div>
                        <div style={{
                          fontSize: '11px',
                          fontFamily: 'monospace',
                          color: colors.textMuted,
                          marginTop: '2px',
                          opacity: 0.7,
                          maxWidth: '300px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {project.path}
                        </div>
                      </td>
                      <td style={{
                        padding: '10px 16px',
                        color: colors.textMuted,
                        maxWidth: '320px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        verticalAlign: 'top',
                      }} role="cell">
                        {project.description || '\u2014'}
                      </td>
                      <td style={{ padding: '10px 16px', verticalAlign: 'top' }} role="cell">
                        {statusBadge(project.status)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* -- Pagination / show all -- */}
          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: '12px' }}>
              <button
                onClick={() => setShowAll(true)}
                style={{
                  padding: '8px 20px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                  border: `1px solid ${colors.border}`,
                  background: colors.abyss,
                  color: colors.textMuted,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${colors.bio}66`; e.currentTarget.style.color = colors.bio; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.color = colors.textMuted; }}
              >
                Show all {filteredProjects.length} projects
              </button>
            </div>
          )}
        </>
      )}

      {/* Keyframe animation for spinner */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// F-P-3: Export memoized component
export const ProjectListView = memo(ProjectListViewComponent, (prevProps, nextProps) => {
  return prevProps.onProjectSelect === nextProps.onProjectSelect;
});
