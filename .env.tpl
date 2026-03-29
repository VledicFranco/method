# This file is committed to git. It contains references, not secrets.
# Values are resolved at runtime by `op run`.
#
# Format: KEY=op://vault/item/field
# See: https://developer.1password.com/docs/cli/secrets-environment-variables/

# 1Password secret references — resolved at runtime by `op run`
# Vault: Private | Items: "Method Bridge - Anthropic API Key", "Method Bridge - Voyage API Key"
ANTHROPIC_API_KEY=op://Private/Method Bridge - Anthropic API Key/password
VOYAGE_API_KEY=op://Private/Method Bridge - Voyage API Key/password
