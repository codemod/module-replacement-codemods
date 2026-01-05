import { type SgRoot, parse } from "codemod:ast-grep";
import type TSX from "codemod:ast-grep/langs/tsx";

async function transform(root: SgRoot<TSX>): Promise<string | null> {
  const rootNode = root.root();

  // Check if regex is already imported from arkregex using semantic analysis
  // Try to find a reference to "regex" and check if it's imported from "arkregex"
  let hasRegexImport = false;
  const regexIdentifier = rootNode.find({
    rule: {
      kind: "identifier",
      regex: "^regex$",
    },
  });

  if (regexIdentifier) {
    const def = regexIdentifier.definition();
    if (def && def.kind === "import") {
      // Check if the import is from "arkregex"
      const importNode = def.node;
      const importStmt = importNode.ancestors().find((a: any) => a.kind() === "import_statement");
      if (importStmt) {
        const source = importStmt.field("source");
        if (source && source.text().includes("arkregex")) {
          hasRegexImport = true;
        }
      }
    }
  }

  // Also check using AST pattern matching as fallback
  if (!hasRegexImport) {
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
    hasRegexImport = existingImports.length > 0;
  }

  // Check if there are any variable declarations or assignments where the variable/left-hand side is "regex"
  // This would cause shadowing issues when we replace new RegExp with regex()
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
        {
          has: {
            field: "value",
            kind: "new_expression",
            has: {
              kind: "identifier",
              regex: "RegExp",
            },
          },
        },
      ],
    },
  });

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
        {
          has: {
            field: "right",
            kind: "new_expression",
            has: {
              kind: "identifier",
              regex: "RegExp",
            },
          },
        },
      ],
    },
  });

  // If we have conflicts, use an import alias to avoid shadowing
  const useAlias = problematicDeclarators.length > 0 || problematicAssignments.length > 0;
  const functionName = useAlias ? "createRegex" : "regex";

  const edits = [];

  // Find all new RegExp expressions and replace them
  // Only replace when the first argument is a string literal (not a variable or expression)
  const regexExpressionsRule = rootNode.findAll({
    rule: {
      kind: "new_expression",
      has: {
        kind: "arguments",
        pattern: "$ARGS",
        follows: {
          kind: "identifier",
          regex: "RegExp",
        },
      },
    },
  });

  for (let expression of regexExpressionsRule) {
    const argsMatch = expression.getMatch("ARGS");
    if (!argsMatch) continue;
    
    // Get the arguments node to check the first argument
    const argsNode = expression.field("arguments");
    if (!argsNode) continue;
    
    // Check if the first argument is a string literal
    // Get children of the arguments node (these are the individual arguments)
    const argChildren = argsNode.children();
    if (argChildren.length === 0) continue;
    
    const firstArg = argChildren[0];
    // Only replace if the first argument is a string literal
    // Skip if it's a variable, expression, or any non-literal value
    if (firstArg.kind() !== "string") {
      // Skip this replacement - arkregex's regex() only works with string literals
      continue;
    }
    
    const args = argsMatch.text();
    edits.push(expression.replace(`${functionName}${args}`));
  }

  if (edits.length === 0) {
    return null;
  }

  let newSource = rootNode.commitEdits(edits);

  if (!hasRegexImport) {
    const importStatement = useAlias 
      ? `import { regex as ${functionName} } from "arkregex";\n`
      : `import { regex } from "arkregex";\n`;
    newSource = importStatement + newSource;
  }

  return newSource;
}

export default transform;
