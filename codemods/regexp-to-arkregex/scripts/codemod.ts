import { type SgRoot, parse } from "codemod:ast-grep";
import type TSX from "codemod:ast-grep/langs/tsx";

async function transform(root: SgRoot<TSX>): Promise<string | null> {
  const rootNode = root.root();

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

  const edits = [];
  for (let expression of regexExpressionsRule) {
    const argsMatch = expression.getMatch("ARGS");
    if (!argsMatch) continue;
    const args = argsMatch.text();
    edits.push(expression.replace(`regex${args}`));
  }

  if (edits.length === 0) {
    return null;
  }

  let newSource = rootNode.commitEdits(edits);
  newSource = `import { regex } from "arkregex";\n${newSource}`;

  return newSource;
}

export default transform;
