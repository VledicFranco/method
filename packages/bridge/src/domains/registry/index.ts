export {
  type MethodologySpec,
  type VerifyResult,
  type ProjectConfig,
  type ProjectRegistry,
  InMemoryProjectRegistry,
} from './project-registry.js';
export { registerRegistryRoutes } from './routes.js';
export { copyMethodology, copyStrategy, validateTargetIds } from './resource-copier.js';
