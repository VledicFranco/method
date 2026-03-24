export {
  registerProjectRoutes,
  eventLog,
  cursorMap,
  getEventsFromLog,
  setOnEventHook,
  getSessionContext,
  validateProjectAccess,
  generateCursor,
  parseCursor,
  getEventsSinceCursor,
  validateCursorFormat,
  validateProjectIdFormat,
  pushEventToLog,
  createCircularEventLog,
  pushEventToLogWithPersistence,
  setPersistence,
} from './routes.js';
export type { CircularEventLog, CursorState } from './routes.js';
export { DiscoveryService } from './discovery-service.js';
export type { DiscoveryResult, ProjectMetadata } from './discovery-service.js';
