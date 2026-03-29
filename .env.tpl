# This file is committed to git. It contains references, not secrets.
# Values are resolved at runtime by `op run`.
#
# Format: KEY=op://vault/item/field
# See: https://developer.1password.com/docs/cli/secrets-environment-variables/

# 1Password secret references — resolved at runtime by `op run`
# Vault paths are PLACEHOLDERS — replace with actual paths when OQ-1 is resolved
ANTHROPIC_API_KEY=op://Development/anthropic-api-key/credential
VOYAGE_API_KEY=op://Development/voyage-api-key/credential
