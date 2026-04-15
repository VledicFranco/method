// PRD-057 / S2 §2: @method/runtime top-level barrel.
//
// Hot-path symbols are re-exported here for consumers that want a single
// import point. Advanced consumers can still deep-import from subpaths
// (`@method/runtime/strategy`, `/sessions`, `/event-bus`, `/cost-governor`,
// `/ports`, `/config`).
//
// C1 (`runtime-scaffold-and-ports-move`) ships only the ports surface.
// C2–C6 fill in the strategy/event-bus/cost-governor/sessions/config
// implementations; C7 finalizes this barrel with hot-path exports.

export type {
  EventBus,
  EventSink,
  EventConnector,
  EventFilter,
  RuntimeEvent,
  RuntimeEventInput,
  EventDomain,
  EventSeverity,
  SessionProviderFactory,
  SessionProviderOptions,
  CostOracle,
  RuntimeRateGovernor,
  HistoricalObservations,
  MethodologySource,
  FileSystemProvider,
  YamlLoader,
} from './ports/index.js';
