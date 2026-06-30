import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const checkedAttributes = new Set(["alt", "aria-label", "placeholder", "title"]);

describe("VeloDent i18n strict mode", () => {
  it("does not render hardcoded UI text in TSX components", () => {
    const issues: string[] = [];
    const frontendRoot = path.join(process.cwd(), "src", "frontend");

    for (const filePath of listFiles(frontendRoot, ".tsx")) {
      if (filePath.endsWith(".test.tsx")) {
        continue;
      }

      const sourceText = fs.readFileSync(filePath, "utf8");
      const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

      function visit(node: ts.Node) {
        if (ts.isJsxText(node)) {
          const text = node.getText(sourceFile).replace(/\s+/g, " ").trim();
          if (hasLetters(text)) {
            issues.push(formatIssue(filePath, sourceFile, node, `JSX text "${text}"`));
          }
        }

        if (ts.isJsxAttribute(node) && checkedAttributes.has(node.name.getText(sourceFile)) && node.initializer && ts.isStringLiteral(node.initializer) && hasLetters(node.initializer.text)) {
          issues.push(formatIssue(filePath, sourceFile, node, `${node.name.getText(sourceFile)}="${node.initializer.text}"`));
        }

        if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === "setStatusMessage") {
          const firstArgument = node.arguments[0];
          if (firstArgument && ts.isStringLiteral(firstArgument) && hasLetters(firstArgument.text)) {
            issues.push(formatIssue(filePath, sourceFile, node, `setStatusMessage("${firstArgument.text}")`));
          }
        }

        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
    }

    expect(issues).toEqual([]);
  });
});

function listFiles(directory: string, extension: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath, extension));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(fullPath);
    }
  }
  return files;
}

function hasLetters(value: string) {
  return /[A-Za-zÀ-ÿ]/.test(value);
}

function formatIssue(filePath: string, sourceFile: ts.SourceFile, node: ts.Node, message: string) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${path.relative(process.cwd(), filePath)}:${String(position.line + 1)} ${message}`;
}
