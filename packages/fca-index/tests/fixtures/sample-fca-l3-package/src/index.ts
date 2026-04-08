/**
 * Sample FCA L3 Package — public interface.
 */

export interface PackageConfig {
  name: string;
  version: string;
}

export interface PackageService {
  getConfig(): PackageConfig;
}

export function createPackageService(config: PackageConfig): PackageService {
  return {
    getConfig(): PackageConfig {
      return config;
    },
  };
}
