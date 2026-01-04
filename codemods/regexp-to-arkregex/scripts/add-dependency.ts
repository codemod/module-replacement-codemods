import { type SgRoot } from "codemod:ast-grep";
import type JSON from "codemod:ast-grep/langs/json";

// ============================================================================
// CONFIGURATION: Change only these values to use this utility for a different package
// ============================================================================
const PACKAGE_NAME = "arkregex";
const PACKAGE_VERSION = "0.0.5";
// ============================================================================

async function transform(root: SgRoot<JSON>): Promise<string | null> {
  const rootNode = root.root();
  const source = rootNode.text();
  const packageJsonPath = root.filename();

  // Only process files named package.json
  if (!packageJsonPath.endsWith("package.json")) {
    return null; // Skip non-package.json files
  }

  // Parse package.json
  let packageJson: any;
  try {
    packageJson = JSON.parse(source);
  } catch {
    return null; // Invalid JSON, skip
  }

  // Verify this is actually a package.json by checking for required fields
  if (!packageJson.name && !packageJson.version) {
    return null; // Not a valid package.json, skip
  }

  // Check if the package is already in dependencies or devDependencies
  if (packageJson.dependencies?.[PACKAGE_NAME] || packageJson.devDependencies?.[PACKAGE_NAME]) {
    return null; // Already exists, no changes needed
  }

  // IMPORTANT: Only add dependency if this package actually uses the package
  // Check if there are any TypeScript files in this package's directory that import it
  const { dirname } = await import("path");
  const packageDir = dirname(packageJsonPath);
  const hasImport = await checkForPackageImports(packageDir, PACKAGE_NAME);
  
  if (!hasImport) {
    return null; // No imports found in this package, skip
  }

  // Add the package to dependencies only if this package uses it
  if (!packageJson.dependencies) {
    packageJson.dependencies = {};
  }
  packageJson.dependencies[PACKAGE_NAME] = PACKAGE_VERSION;

  // Sort dependencies and devDependencies alphabetically
  packageJson.dependencies = sortObjectKeys(packageJson.dependencies);
  if (packageJson.devDependencies) {
    packageJson.devDependencies = sortObjectKeys(packageJson.devDependencies);
  }

  // Return the updated JSON with proper formatting
  return JSON.stringify(packageJson, null, 2) + "\n";
}

/**
 * Recursively search for package imports in TypeScript files within a directory
 * Uses LLRT-compatible file system APIs
 */
async function checkForPackageImports(dirPath: string, packageName: string, maxDepth: number = 5, currentDepth: number = 0): Promise<boolean> {
  if (currentDepth > maxDepth) {
    return false;
  }

  try {
    // Use dynamic import to access file system APIs available in LLRT
    const { readdir, readFile, stat } = await import("fs/promises");
    const { join } = await import("path");
    
    const entries = await readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      // Skip node_modules and other common directories to ignore
      if (entry.isDirectory()) {
        const dirName = entry.name;
        if (dirName === "node_modules" || dirName === ".git" || dirName === "dist" || dirName === "build") {
          continue;
        }
        
        const subDirPath = join(dirPath, dirName);
        if (await checkForPackageImports(subDirPath, packageName, maxDepth, currentDepth + 1)) {
          return true;
        }
      } else if (entry.isFile()) {
        const fileName = entry.name;
        if (fileName.endsWith(".ts") || fileName.endsWith(".tsx")) {
          try {
            const filePath = join(dirPath, fileName);
            const content = await readFile(filePath, "utf-8");
            // Check if file contains the package import
            if (content.includes(`from "${packageName}"`) || content.includes(`from '${packageName}'`)) {
              return true;
            }
          } catch {
            // Skip files we can't read
            continue;
          }
        }
      }
    }
  } catch {
    // If we can't read the directory, assume no imports
    return false;
  }

  return false;
}

/**
 * Sort object keys alphabetically
 */
function sortObjectKeys<T extends Record<string, any>>(obj: T): T {
  const sortedKeys = Object.keys(obj).sort();
  const sorted: any = {};
  for (const key of sortedKeys) {
    sorted[key] = obj[key];
  }
  return sorted as T;
}

export default transform;
