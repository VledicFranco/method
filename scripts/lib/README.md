# scripts/lib — Shared Script Utilities

Reusable modules used by the bridge launcher and management scripts.

## Modules

### profile-loader.js

Resolves and parses `.env` instance profiles from `.method/instances/`.

**Exports:**

| Function | Description |
|----------|-------------|
| `parseEnvFile(content)` | Parse `.env` file string into `{ key: value }` object |
| `normalizePathValues(env)` | Normalize Windows backslashes in path-type keys |
| `resolveProfilePath(name, root?)` | Resolve profile path, throw if missing |
| `loadProfile(name, root?)` | Load and parse a named profile (returns `{ env, profilePath }`) |
| `mergeEnv(profileEnv, processEnv?)` | Merge profile env with process env (explicit vars win) |
| `parseInstanceFlag(argv?)` | Extract `--instance <name>` from argv (returns name or null) |

### secrets-resolver.js

Determines how API keys and secrets are provided to the bridge process.

**Exports:**

| Function | Description |
|----------|-------------|
| `isOpAvailable()` | Check if 1Password CLI (`op`) is on PATH |
| `resolveSecretsMode({ hasEnvTpl, hasEnv, hasOp })` | Pure logic: resolve mode from boolean flags |
| `detectSecretsMode(envTplPath, envPath)` | Probe filesystem and PATH, return mode |

**Secrets modes:** `'op-run'` (1Password resolves `op://` refs), `'env-file'` (plain `.env`), `'none'` (no secrets).

## Testing

```bash
node --test scripts/lib/profile-loader.test.mjs
node --test scripts/lib/secrets-resolution.test.mjs
```

Tests use `node:test` and `node:assert/strict`. No external dependencies.
