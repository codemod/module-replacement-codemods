import { type SgRoot, type SgNode, parse } from "codemod:ast-grep";
import type TSX from "codemod:ast-grep/langs/tsx";

// Configuration: whether to transform RegExp(...) call form (not just new RegExp(...))
const TRANSFORM_CALL_FORM = false; // Default false as per requirements

/**
 * Check if an identifier refers to the global RegExp constructor
 * Returns true if it's the global RegExp, false if shadowed
 */
function isGlobalRegExp(node: SgNode<TSX>): boolean {
  // Get the identifier node (should be "RegExp")
  const identifier = node.is("identifier") ? node : node.find({
    rule: { kind: "identifier", regex: "^RegExp$" },
  });
  
  if (!identifier) return false;
  
  // Check if it's in a member expression (e.g., Foo.RegExp) - skip those
  const parent = identifier.parent();
  if (parent && parent.is("member_expression")) {
    return false; // Not the global RegExp
  }
  
  // Use semantic analysis to check if this refers to the global RegExp
  const def = identifier.definition();
  
  // If definition is 'local', it's shadowed by a local binding - skip
  if (def && def.kind === "local") {
    return false; // Shadowed by local binding (param, var, class, namespace, etc.)
  }
  
  // If definition is 'import', it's imported from somewhere - not global
  if (def && def.kind === "import") {
    return false; // Not the global RegExp
  }
  
  // If no definition found or definition is 'external', it's likely the global RegExp
  // (built-in globals like RegExp don't have definitions in the codebase)
  // We're conservative: only transform if we're confident it's not shadowed
  return true; // Assume global RegExp if not shadowed
}

/**
 * Check if a node is "statically known" (string literal, template literal without substitutions, etc.)
 */
function isStaticallyKnown(node: SgNode<TSX>): boolean {
  if (!node) return false;
  
  // String literal is statically known
  if (node.is("string")) {
    return true;
  }
  
  // Template literal without substitutions is statically known
  if (node.is("template_string")) {
    // Check if it has any interpolations
    const interpolations = node.findAll({
      rule: { kind: "template_substitution" },
    });
    return interpolations.length === 0;
  }
  
  // Parenthesized expression - check the inner expression
  if (node.is("parenthesized_expression")) {
    const inner = node.field("expression");
    if (inner) {
      return isStaticallyKnown(inner);
    }
  }
  
  // Check if it's a const identifier with a literal initializer
  // This requires finding the declaration
  if (node.is("identifier")) {
    const def = node.definition();
    if (def && def.kind === "local") {
      // Check if it's a const declaration with a literal value
      const declNode = def.node;
      // Find the variable declarator
      const declarator = declNode.ancestors().find((a: SgNode<TSX>) => a.kind() === "variable_declarator");
      if (declarator) {
        const value = declarator.field("value");
        if (value) {
          // Check if the value is a literal
          if (value.is("string") || value.is("template_string")) {
            // Also check if it's const (not let/var)
            const varDecl = declarator.parent();
            if (varDecl && varDecl.is("variable_declaration")) {
              const kind = varDecl.field("kind");
              if (kind && kind.text() === "const") {
                return isStaticallyKnown(value);
              }
            }
          }
        }
      }
    }
  }
  
  // Binary expression with + operator and both sides are statically known
  if (node.is("binary_expression")) {
    const operator = node.field("operator");
    if (operator && operator.text() === "+") {
      const left = node.field("left");
      const right = node.field("right");
      if (left && right) {
        return isStaticallyKnown(left) && isStaticallyKnown(right);
      }
    }
  }
  
  // Everything else is dynamic
  return false;
}

/**
 * Get the first and second arguments from an arguments node
 */
function getArguments(argsNode: SgNode<TSX>): { first: SgNode<TSX> | null; second: SgNode<TSX> | null } {
  const children = argsNode.children();
  const args: SgNode<TSX>[] = [];
  
  for (const child of children) {
    const kind = child.kind();
    // Skip punctuation and comments
    if (kind === "(" || kind === ")" || kind === "," || kind === "comment") {
      continue;
    }
    args.push(child);
  }
  
  return {
    first: args[0] || null,
    second: args[1] || null,
  };
}

/**
 * Check if a TODO comment already exists immediately before a statement
 */
function hasTodoComment(node: SgNode<TSX>): boolean {
  // Find the containing statement
  const stmt = node.ancestors().find((a: SgNode<TSX>) => 
    a.kind() === "expression_statement" ||
    a.kind() === "variable_declaration" ||
    a.kind() === "return_statement" ||
    a.kind() === "if_statement" ||
    a.kind() === "for_statement" ||
    a.kind() === "while_statement"
  );
  
  if (!stmt) return false;
  
  // Check if the statement follows a comment with the TODO text
  const todoText = "// TODO(arkregex): pattern/flags not statically known; typing may degrade. Consider regex.as<...>(...)";
  
  // Get all previous siblings
  const prev = stmt.prev();
  if (prev && prev.is("comment")) {
    const commentText = prev.text().trim();
    if (commentText === todoText || commentText.includes("TODO(arkregex)")) {
      return true;
    }
  }
  
  // Also check using follows() for comments
  return stmt.follows({
    rule: {
      kind: "comment",
      regex: "TODO\\(arkregex\\)",
    },
  });
}

/**
 * Check if regex is already imported from arkregex
 */
function hasRegexImport(rootNode: SgNode<TSX>): { has: boolean; alias: string | null } {
  // Check using semantic analysis first
  const regexIdentifier = rootNode.find({
    rule: {
      kind: "identifier",
      regex: "^regex$",
    },
  });

  if (regexIdentifier) {
    const def = regexIdentifier.definition();
    if (def && def.kind === "import") {
      const importNode = def.node;
      const importStmt = importNode.ancestors().find((a: SgNode<TSX>) => a.kind() === "import_statement");
      if (importStmt) {
        const source = importStmt.field("source");
        if (source && source.text().includes("arkregex")) {
          // Check if it's an alias
          const specifier = importNode.parent();
          if (specifier && specifier.is("import_specifier")) {
            const imported = specifier.field("name");
            const alias = specifier.field("alias");
            if (alias) {
              return { has: true, alias: alias.text() };
            }
            return { has: true, alias: null };
          }
          return { has: true, alias: null };
        }
      }
    }
  }

  // Also check using AST pattern matching as fallback
  const existingImports = rootNode.findAll({
    rule: {
      all: [
        {
          kind: "import_statement",
        },
        {
          has: {
            kind: "import_clause",
            has: {
              kind: "named_imports",
              has: {
                kind: "import_specifier",
                has: {
                  kind: "identifier",
                  regex: "^regex$",
                },
              },
            },
          },
        },
        {
          has: {
            kind: "string",
            regex: "arkregex",
          },
        },
      ],
    },
  });
  
  if (existingImports.length > 0) {
    // Check for alias
    for (const imp of existingImports) {
      const specifiers = imp.findAll({
        rule: {
          kind: "import_specifier",
          has: {
            kind: "identifier",
            regex: "^regex$",
          },
        },
      });
      for (const spec of specifiers) {
        const alias = spec.field("alias");
        if (alias) {
          return { has: true, alias: alias.text() };
        }
      }
    }
    return { has: true, alias: null };
  }

  return { has: false, alias: null };
}

/**
 * Check if 'regex' identifier conflicts (would cause shadowing)
 */
function hasRegexConflict(rootNode: SgNode<TSX>): boolean {
  // Check for variable declarations with name "regex"
  const problematicDeclarators = rootNode.findAll({
    rule: {
      all: [
        {
          kind: "variable_declarator",
        },
        {
          has: {
            field: "name",
            kind: "identifier",
            regex: "^regex$",
          },
        },
      ],
    },
  });

  // Check for assignments to "regex"
  const problematicAssignments = rootNode.findAll({
    rule: {
      all: [
        {
          kind: "assignment_expression",
        },
        {
          has: {
            field: "left",
            kind: "identifier",
            regex: "^regex$",
          },
        },
      ],
    },
  });

  // Check for function parameters named "regex"
  const problematicParams = rootNode.findAll({
    rule: {
      all: [
        {
          kind: "identifier",
          regex: "^regex$",
        },
        {
          inside: {
            kind: "formal_parameters",
          },
        },
      ],
    },
  });

  return problematicDeclarators.length > 0 || 
         problematicAssignments.length > 0 || 
         problematicParams.length > 0;
}

async function transform(root: SgRoot<TSX>): Promise<string | null> {
  const rootNode = root.root();
  const sourceText = rootNode.text();

  // Check if regex is already imported
  const importInfo = hasRegexImport(rootNode);
  const alreadyHasRegexImport = importInfo.has;
  const existingAlias = importInfo.alias;

  // Check for conflicts
  const hasConflict = hasRegexConflict(rootNode);
  
  // Determine function name to use
  const functionName = hasConflict ? "arkregex" : (existingAlias || "regex");
  const needsNewImport = !alreadyHasRegexImport || (hasConflict && !existingAlias);

  const edits: any[] = [];

  // Find all new RegExp expressions
  const newRegExpExpressions = rootNode.findAll({
    rule: {
      kind: "new_expression",
      has: {
        kind: "arguments",
        follows: {
          kind: "identifier",
          regex: "^RegExp$",
        },
      },
    },
  });

  // Find all RegExp call expressions (if enabled)
  const regExpCalls = TRANSFORM_CALL_FORM
    ? rootNode.findAll({
        rule: {
          kind: "call_expression",
          has: {
            field: "function",
            kind: "identifier",
            regex: "^RegExp$",
          },
        },
      })
    : [];

  // Process new RegExp(...)
  for (const expression of newRegExpExpressions) {
    const identifier = expression.find({
      rule: { kind: "identifier", regex: "^RegExp$" },
    });
    
    if (!identifier || !isGlobalRegExp(identifier)) {
      continue; // Skip if not global RegExp
    }

    const argsNode = expression.field("arguments");
    if (!argsNode) continue;

    const { first: firstArg, second: secondArg } = getArguments(argsNode);

    // Only handle 1 or 2 arguments
    if (!firstArg) continue; // 0 arguments - skip
    const allArgs = argsNode.children().filter((c: SgNode<TSX>) => 
      c.kind() !== "(" && c.kind() !== ")" && c.kind() !== "," && c.kind() !== "comment"
    );
    if (allArgs.length > 2) {
      continue; // More than 2 arguments - skip
    }

    // Check if pattern and flags are statically known
    const patternStatic = isStaticallyKnown(firstArg);
    const flagsStatic = secondArg ? isStaticallyKnown(secondArg) : true;

    // Build replacement
    let replacement = functionName + "(";
    
    // Add pattern with type assertion if dynamic
    if (patternStatic) {
      replacement += firstArg.text();
    } else {
      replacement += `${firstArg.text()} as Parameters<typeof ${functionName}>[0]`;
    }

    // Add flags if present
    if (secondArg) {
      replacement += ", ";
      if (flagsStatic) {
        replacement += secondArg.text();
      } else {
        replacement += `${secondArg.text()} as Parameters<typeof ${functionName}>[1] | undefined`;
      }
    }

    replacement += ") as RegExp";

    // Check if this expression is part of a member expression chain (e.g., new RegExp(...).test())
    // If so, wrap in parentheses to fix precedence: (regex(...) as RegExp).test()
    const parent = expression.parent();
    if (parent && parent.is("member_expression")) {
      // Check if this expression is the object of the member expression
      const object = parent.field("object");
      if (object && object.id() === expression.id()) {
        replacement = `(${replacement})`;
      }
    }

    // Add TODO comment if either is dynamic
    if (!patternStatic || !flagsStatic) {
      // Find the start of the line where the expression is located
      const exprRange = expression.range();
      
      // Find the start of the line (go backwards to find the previous newline)
      let lineStart = exprRange.start.index;
      while (lineStart > 0 && sourceText[lineStart - 1] !== '\n') {
        lineStart--;
      }
      
      // Check if there's already a TODO comment on this line or the line before
      // First, check the current line
      const lineEnd = sourceText.indexOf('\n', lineStart);
      const currentLineText = lineEnd >= 0 
        ? sourceText.substring(lineStart, lineEnd)
        : sourceText.substring(lineStart);
      const hasCommentOnCurrentLine = currentLineText.trim().startsWith("//") && 
        currentLineText.includes("TODO(arkregex)");
      
      // Then check the previous line
      const lineBeforeStart = lineStart > 0 ? (() => {
        let pos = lineStart - 1;
        // Skip the newline itself
        if (pos >= 0 && sourceText[pos] === '\n') pos--;
        // Go back to find the start of the previous line
        while (pos > 0 && sourceText[pos - 1] !== '\n') {
          pos--;
        }
        return pos;
      })() : -1;
      
      const hasCommentOnPreviousLine = lineBeforeStart >= 0 && 
        sourceText.substring(lineBeforeStart, lineStart).includes("TODO(arkregex)");
      
      const hasExistingComment = hasCommentOnCurrentLine || hasCommentOnPreviousLine;
      
      if (!hasExistingComment) {
        const todoComment = "// TODO(arkregex): pattern/flags not statically known; typing may degrade. Consider regex.as<...>(...)\n";
        // Place comment at the start of the current line (which will appear right above the expression)
        // If we're not at the start of the file, we're placing it on the line before
        const insertPos = lineStart > 0 ? lineStart : 0;
        edits.push({
          startPos: insertPos,
          endPos: insertPos,
          insertedText: todoComment,
        });
      }
    }

    edits.push(expression.replace(replacement));
  }

  // Process RegExp(...) call form (if enabled)
  for (const call of regExpCalls) {
    const identifier = call.field("function");
    if (!identifier || !identifier.is("identifier") || !isGlobalRegExp(identifier)) {
      continue;
    }

    const argsNode = call.field("arguments");
    if (!argsNode) continue;

    const { first: firstArg, second: secondArg } = getArguments(argsNode);

    if (!firstArg) continue;
    const allArgs = argsNode.children().filter((c: SgNode<TSX>) =>
      c.kind() !== "(" && c.kind() !== ")" && c.kind() !== "," && c.kind() !== "comment"
    );
    if (allArgs.length > 2) {
      continue;
    }

    const patternStatic = isStaticallyKnown(firstArg);
    const flagsStatic = secondArg ? isStaticallyKnown(secondArg) : true;

    let replacement = functionName + "(";
    
    if (patternStatic) {
      replacement += firstArg.text();
    } else {
      replacement += `${firstArg.text()} as Parameters<typeof ${functionName}>[0]`;
    }

    if (secondArg) {
      replacement += ", ";
      if (flagsStatic) {
        replacement += secondArg.text();
      } else {
        replacement += `${secondArg.text()} as Parameters<typeof ${functionName}>[1] | undefined`;
      }
    }

    replacement += ") as RegExp";

    // Check if this call is part of a member expression chain (e.g., RegExp(...).test())
    // If so, wrap in parentheses to fix precedence: (regex(...) as RegExp).test()
    const parent = call.parent();
    if (parent && parent.is("member_expression")) {
      // Check if this call is the object of the member expression
      const object = parent.field("object");
      if (object && object.id() === call.id()) {
        replacement = `(${replacement})`;
      }
    }

    if (!patternStatic || !flagsStatic) {
      // Find the start of the line where the call is located
      const callRange = call.range();
      
      // Find the start of the line (go backwards to find the previous newline)
      let lineStart = callRange.start.index;
      while (lineStart > 0 && sourceText[lineStart - 1] !== '\n') {
        lineStart--;
      }
      
      // Check if there's already a TODO comment on this line or the line before
      // First, check the current line
      const lineEnd = sourceText.indexOf('\n', lineStart);
      const currentLineText = lineEnd >= 0 
        ? sourceText.substring(lineStart, lineEnd)
        : sourceText.substring(lineStart);
      const hasCommentOnCurrentLine = currentLineText.trim().startsWith("//") && 
        currentLineText.includes("TODO(arkregex)");
      
      // Then check the previous line
      const lineBeforeStart = lineStart > 0 ? (() => {
        let pos = lineStart - 1;
        // Skip the newline itself
        if (pos >= 0 && sourceText[pos] === '\n') pos--;
        // Go back to find the start of the previous line
        while (pos > 0 && sourceText[pos - 1] !== '\n') {
          pos--;
        }
        return pos;
      })() : -1;
      
      const hasCommentOnPreviousLine = lineBeforeStart >= 0 && 
        sourceText.substring(lineBeforeStart, lineStart).includes("TODO(arkregex)");
      
      const hasExistingComment = hasCommentOnCurrentLine || hasCommentOnPreviousLine;
      
      if (!hasExistingComment) {
        const todoComment = "// TODO(arkregex): pattern/flags not statically known; typing may degrade. Consider regex.as<...>(...)\n";
        // Place comment at the start of the current line (which will appear right above the expression)
        // If we're not at the start of the file, we're placing it on the line before
        const insertPos = lineStart > 0 ? lineStart : 0;
        edits.push({
          startPos: insertPos,
          endPos: insertPos,
          insertedText: todoComment,
        });
      }
    }

    edits.push(call.replace(replacement));
  }

  if (edits.length === 0) {
    return null;
  }

  let newSource = rootNode.commitEdits(edits);

  // Add import if needed
  if (needsNewImport) {
    const importStatement = functionName === "arkregex"
      ? `import { regex as arkregex } from "arkregex";\n`
      : `import { regex } from "arkregex";\n`;
    
    // Find imports in the original source to get their text
    const existingImports = rootNode.findAll({
      rule: { kind: "import_statement" },
    });
    
    if (existingImports.length > 0) {
      // Get the last import from the original source
      const lastImport = existingImports[existingImports.length - 1];
      const lastImportText = lastImport.text();
      
      // Find the last occurrence of this import text in the new source
      const lastIndex = newSource.lastIndexOf(lastImportText);
      
      if (lastIndex !== -1) {
        // Found the import, calculate insert position (after the import text)
        let insertPos = lastIndex + lastImportText.length;
        
        // Skip any trailing whitespace/newlines after the import
        while (insertPos < newSource.length) {
          const char = newSource[insertPos];
          if (char === ' ' || char === '\t') {
            insertPos++;
          } else if (char === '\n' || (char === '\r' && insertPos + 1 < newSource.length && newSource[insertPos + 1] === '\n')) {
            // Found a newline, insert after it
            insertPos += char === '\r' ? 2 : 1;
            break;
          } else {
            // Non-whitespace character, insert newline before it
            break;
          }
        }
        
        // Insert the new import with a newline
        newSource = newSource.substring(0, insertPos) + importStatement + newSource.substring(insertPos);
      } else {
        // Couldn't find exact match, use fallback: find last "import" keyword
        const lastImportPos = newSource.lastIndexOf("import ");
        if (lastImportPos !== -1) {
          // Find the end of that line
          const lineEnd = newSource.indexOf("\n", lastImportPos);
          if (lineEnd !== -1) {
            newSource = newSource.substring(0, lineEnd + 1) + importStatement + newSource.substring(lineEnd + 1);
          } else {
            // No newline found, append at end
            newSource = newSource + "\n" + importStatement;
          }
        } else {
          // No imports found, insert at start
          newSource = importStatement + newSource;
        }
      }
    } else {
      // No imports found, insert at start
      newSource = importStatement + newSource;
    }
  }

  return newSource;
}

export default transform;
