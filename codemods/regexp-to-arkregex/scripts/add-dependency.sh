#!/bin/sh
# Script to add PACKAGE_NAME dependency to packages that actually use it
# This script detects the package manager and installs the dependency only where needed

set -eu

PACKAGE_NAME="arkregex"
PACKAGE_VERSION="0.0.5"

# Find package manager by checking for lock files
detect_package_manager() {
  dir="$1"
  
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


# Install package using the detected package manager
install_package() {
  dir="$1"
  pm="$2"
  package="${PACKAGE_NAME}@${PACKAGE_VERSION}"
  
  echo "Installing ${package} in $(basename "$dir") using $pm..."
  
  case "$pm" in
    pnpm)
      echo ">>> EXECUTING: cd \"$dir\" && pnpm add ${package}"
      if (cd "$dir" && pnpm add ${package}); then
        echo ">>> SUCCESS: pnpm add completed"
      else
        echo ">>> ERROR: pnpm add failed"
        return 1
      fi
      ;;
    yarn)
      # Simple yarn add command without quotes and without -W flag
      echo ">>> EXECUTING: cd \"$dir\" && yarn add ${package}"
      if (cd "$dir" && yarn add ${package}); then
        echo ">>> SUCCESS: yarn add completed"
      else
        echo ">>> ERROR: yarn add failed"
        return 1
      fi
      ;;
    bun)
      echo ">>> EXECUTING: cd \"$dir\" && bun add ${package}"
      if (cd "$dir" && bun add ${package}); then
        echo ">>> SUCCESS: bun add completed"
      else
        echo ">>> ERROR: bun add failed"
        return 1
      fi
      ;;
    npm)
      echo ">>> EXECUTING: cd \"$dir\" && npm install ${package}"
      if (cd "$dir" && npm install ${package}); then
        echo ">>> SUCCESS: npm install completed"
      else
        echo ">>> ERROR: npm install failed"
        return 1
      fi
      ;;
    *)
      echo "Unknown package manager: $pm" >&2
      return 1
      ;;
  esac
}


# Check if a directory is a monorepo root
is_monorepo_root() {
  dir="$1"
  package_json="$dir/package.json"
  
  if [ ! -f "$package_json" ]; then
    return 1
  fi
  
  # Check for yarn workspaces
  if grep -q '"workspaces"' "$package_json" 2>/dev/null; then
    return 0
  fi
  
  # Check for pnpm workspaces
  if [ -f "$dir/pnpm-workspace.yaml" ] || grep -q '"pnpm"' "$package_json" 2>/dev/null; then
    return 0
  fi
  
  # Check for npm workspaces
  if grep -q '"workspaces"' "$package_json" 2>/dev/null; then
    return 0
  fi
  
  return 1
}

# Find monorepo root (directory with workspaces configuration)
find_monorepo_root() {
  dir="$1"
  current="$dir"
  
  while [ "$current" != "/" ]; do
    if is_monorepo_root "$current"; then
      echo "$current"
      return 0
    fi
    current=$(dirname "$current")
  done
  
  # If no monorepo root found, return the original directory
  echo "$dir"
}

# Check if package is used anywhere in the directory tree
has_package_import_anywhere() {
  dir="$1"
  package="$2"
  
  echo ">>> Checking for imports of '${package}' anywhere in $(basename "$dir")..."
  
  matching_files=$(find "$dir" -type f \( -name "*.ts" -o -name "*.tsx" \) \
    ! -path "*/node_modules/*" \
    ! -path "*/.git/*" \
    ! -path "*/dist/*" \
    ! -path "*/build/*" \
    ! -path "*/.yarn/*" \
    -exec grep -l "from [\"']${package}[\"']" {} \; 2>/dev/null | head -1)
  
  if [ -n "$matching_files" ]; then
    echo ">>> FOUND import in: $matching_files"
    return 0  # Found import
  else
    echo ">>> NO imports found"
    return 1  # No import found
  fi
}

# Check if package is already installed at root
is_package_installed_at_root() {
  root_dir="$1"
  package_json="$root_dir/package.json"
  
  if [ -f "$package_json" ]; then
    grep -q "\"${PACKAGE_NAME}\"" "$package_json" 2>/dev/null
  else
    return 1
  fi
}

# Main execution
main() {
  # Start from the target directory (where the codemod is run)
  target_dir="${1:-.}"
  
  echo "========================================="
  echo "Starting dependency installation script"
  echo "Target directory: $target_dir"
  echo "Package: ${PACKAGE_NAME}@${PACKAGE_VERSION}"
  echo "========================================="
  
  # Find monorepo root
  monorepo_root=$(find_monorepo_root "$target_dir")
  echo "Monorepo root: $monorepo_root"
  
  # Check if it's actually a monorepo
  if is_monorepo_root "$monorepo_root"; then
    echo ">>> Monorepo detected"
    
    # Check if package is already installed at root
    if is_package_installed_at_root "$monorepo_root"; then
      echo ">>> SKIPPING: ${PACKAGE_NAME} already installed at monorepo root"
      return 0
    fi
    
    # Check if package is used anywhere in the monorepo
    if has_package_import_anywhere "$target_dir" "$PACKAGE_NAME"; then
      # Detect package manager at root
      root_pm=$(detect_package_manager "$monorepo_root")
      echo ">>> Detected package manager: $root_pm"
      echo ">>> Installing ${PACKAGE_NAME}@${PACKAGE_VERSION} at monorepo root..."
      
      if install_package "$monorepo_root" "$root_pm"; then
        echo ">>> SUCCESS: Installation completed at monorepo root"
      else
        echo ">>> ERROR: Installation failed at monorepo root"
        return 1
      fi
    else
      echo ">>> SKIPPING: no imports of ${PACKAGE_NAME} found in monorepo"
    fi
  else
    echo ">>> Not a monorepo, checking for package usage..."
    
    # For non-monorepo, check if package is used
    if has_package_import_anywhere "$target_dir" "$PACKAGE_NAME"; then
      # Check if already installed
      if is_package_installed_at_root "$target_dir"; then
        echo ">>> SKIPPING: ${PACKAGE_NAME} already installed"
        return 0
      fi
      
      # Detect package manager
      pm=$(detect_package_manager "$target_dir")
      echo ">>> Detected package manager: $pm"
      echo ">>> Installing ${PACKAGE_NAME}@${PACKAGE_VERSION}..."
      
      if install_package "$target_dir" "$pm"; then
        echo ">>> SUCCESS: Installation completed"
      else
        echo ">>> ERROR: Installation failed"
        return 1
      fi
    else
      echo ">>> SKIPPING: no imports of ${PACKAGE_NAME} found"
    fi
  fi
  
  echo ""
  echo "========================================="
  echo "Installation complete"
  echo "========================================="
}

main "$@"
