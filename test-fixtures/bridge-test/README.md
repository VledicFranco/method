# Bridge Test Fixtures

Minimal project directories used by the test bridge instance (`--instance test`) for project discovery without scanning real repositories.

## Contents

```
bridge-test/
  project-alpha/    Fixture project A
  project-beta/     Fixture project B
  project-gamma/    Fixture project C
```

Each directory is an empty project stub. The bridge's project discovery scans `ROOT_DIR` for subdirectories — these fixtures provide predictable, deterministic input for that scan.

## How They're Used

The test instance profile (`.method/instances/test.env`) sets:

```env
ROOT_DIR=test-fixtures/bridge-test
```

This makes the bridge discover exactly these three projects instead of the 137+ real repos in the parent workspace. This enables:

- Fast startup (no real filesystem scan)
- Deterministic project lists in tests
- No interference with production bridge state

## Adding Fixtures

To add a new fixture project, create a directory here. No files are required inside it — the bridge discovers projects by directory presence. If a test needs specific project metadata (e.g., a `package.json` or `.method/` directory), add it to the fixture.
