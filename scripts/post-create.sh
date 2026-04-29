#!/usr/bin/env bash
set -euo pipefail

echo "▶  Running post-create setup..."

# Install git hooks if husky is present in the project
if npx --no husky --version > /dev/null 2>&1; then
  echo "   Installing git hooks via Husky..."
  npx husky install
fi

# Print runtime versions for quick verification
echo "   Node.js : $(node --version)"
echo "   npm     : $(npm --version)"

echo "✅ Post-create setup complete."
echo "   Run 'npm run dev' to start the API server on http://localhost:3000"
