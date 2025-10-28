import { type SgRoot, parse } from "codemod:ast-grep";
import type TS from "codemod:ast-grep/langs/typescript";

async function transform(root: SgRoot<TS>): Promise<string> {
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

  let newSource = rootNode.commitEdits(edits);

  if (edits.length) {
    newSource = `import { regex } from "arkregex";\n${newSource}`;
  }

  return newSource;
}

export default transform;
