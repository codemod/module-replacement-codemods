#!/bin/bash
# Script to add PACKAGE_NAME dependency to packages that actually use it
# This script detects the package manager and installs the dependency only where needed

set -euo pipefail

PACKAGE_NAME="arkregex"
PACKAGE_VERSION="0.0.5"

# Find package manager by checking for lock files
detect_package_manager() {
  local dir="$1"
  
  if [ -f "$dir/pnpm-lock.yaml" ]; then
    echo "pnpm"
  elif [ -f "$dir/yarn.lock" ]; then
    echo "yarn"
  elif [ -f "$dir/bun.lockb" ]; then
    echo "bun"
  elif [ -f "$dir/package-lock.json" ]; then
    echo "npm"
  else
    # Default to npm if no lock file found
    echo "npm"
  fi
}

# Check if a directory contains TypeScript files that import the package
has_package_import() {
  local dir="$1"
  local package="$2"
  
  # Use find to search for .ts and .tsx files, excluding node_modules, .git, dist, build
  if find "$dir" -type f \( -name "*.ts" -o -name "*.tsx" \) \
    -not -path "*/node_modules/*" \
    -not -path "*/.git/*" \
    -not -path "*/dist/*" \
    -not -path "*/build/*" \
    -exec grep -l "from [\"']${package}[\"']" {} \; 2>/dev/null | head -1 | grep -q .; then
    return 0  # Found import
  else
    return 1  # No import found
  fi
}

# Install package using the detected package manager
install_package() {
  local dir="$1"
  local pm="$2"
  local package="${PACKAGE_NAME}@${PACKAGE_VERSION}"
  
  echo "Installing ${package} in $(basename "$dir") using $pm..."
  
  case "$pm" in
    pnpm)
      (cd "$dir" && pnpm add "${package}")
      ;;
    yarn)
      (cd "$dir" && yarn add "${package}")
      ;;
    bun)
      (cd "$dir" && bun add "${package}")
      ;;
    npm)
      (cd "$dir" && npm install "${package}")
      ;;
    *)
      echo "Unknown package manager: $pm" >&2
      return 1
      ;;
  esac
}

# Main execution
main() {
  # Start from the target directory (where the codemod is run)
  local target_dir="${1:-.}"
  local root_pm
  
  # Detect package manager at root level
  root_pm=$(detect_package_manager "$target_dir")
  echo "Detected package manager: $root_pm"
  
  # Find all package.json files in the target directory
  # Exclude node_modules and common build/dependency directories
  while IFS= read -r -d '' package_json; do
    package_dir=$(dirname "$package_json")
    
    # Skip if this package already has the dependency (check both dependencies and devDependencies)
    if grep -q "\"${PACKAGE_NAME}\"" "$package_json" 2>/dev/null; then
      echo "Skipping $(basename "$package_dir"): ${PACKAGE_NAME} already in dependencies or devDependencies"
      continue
    fi
    
    # Check if this package actually uses the dependency
    if has_package_import "$package_dir" "$PACKAGE_NAME"; then
      # Detect package manager for this specific package (might be different in monorepos)
      local pm=$(detect_package_manager "$package_dir")
      install_package "$package_dir" "$pm"
    else
      echo "Skipping $(basename "$package_dir"): no imports of ${PACKAGE_NAME} found"
    fi
  done < <(find "$target_dir" -name "package.json" \
    -not -path "*/node_modules/*" \
    -not -path "*/.git/*" \
    -not -path "*/dist/*" \
    -not -path "*/build/*" \
    -print0)
}

main "$@"
