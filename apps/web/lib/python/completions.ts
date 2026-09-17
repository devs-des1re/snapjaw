import type { Monaco } from "@monaco-editor/react";
import type * as MonacoTypes from "monaco-editor";

import {
  PYTHON_BUILTIN_CLASSES,
  PYTHON_BUILTIN_FUNCTIONS,
  PYTHON_BUILTIN_VALUES,
  PYTHON_EXCEPTIONS,
  PYTHON_KEYWORDS,
  PYTHON_MODULE_MEMBERS,
  PYTHON_MODULE_NAMES,
  type PythonModuleMembers,
} from "@/lib/python/symbols";

export type PythonCompletionKind =
  "keyword" | "snippet" | "function" | "class" | "module" | "value";

export interface PythonCompletion {
  label: string;
  kind: PythonCompletionKind;
  detail?: string;
  insertText?: string;
  isSnippet?: boolean;
}

export interface PythonSnippet {
  label: string;
  detail: string;
  body: string;
}

export interface CompletionContext {
  linePrefix: string;
  imports: Record<string, string>;
}

export const PYTHON_SNIPPETS: PythonSnippet[] = [
  { label: "def", detail: "function definition", body: "def ${1:name}(${2}):\n    ${3:pass}" },
  {
    label: "class",
    detail: "class definition",
    body: "class ${1:Name}:\n    def __init__(self${2}):\n        ${3:pass}",
  },
  { label: "if", detail: "if statement", body: "if ${1:condition}:\n    ${2:pass}" },
  { label: "elif", detail: "else if branch", body: "elif ${1:condition}:\n    ${2:pass}" },
  { label: "else", detail: "else branch", body: "else:\n    ${1:pass}" },
  { label: "for", detail: "for loop", body: "for ${1:item} in ${2:iterable}:\n    ${3:pass}" },
  { label: "while", detail: "while loop", body: "while ${1:condition}:\n    ${2:pass}" },
  {
    label: "try",
    detail: "try/except block",
    body: "try:\n    ${1:pass}\nexcept ${2:Exception} as ${3:error}:\n    ${4:pass}",
  },
  {
    label: "with",
    detail: "context manager",
    body: 'with ${1:open("file")} as ${2:handle}:\n    ${3:pass}',
  },
  {
    label: "main",
    detail: "main guard",
    body: 'def main():\n    ${1:pass}\n\n\nif __name__ == "__main__":\n    main()',
  },
];

const ATTRIBUTE_AT_END = /([A-Za-z_][\w.]*)\.(\w*)$/;
const FROM_WITHOUT_IMPORT = /^\s*from\s+[\w.]*$/;
const FROM_IMPORT = /^\s*from\s+([\w.]+)\s+import\s+[\w\s,()*]*$/;
const PLAIN_IMPORT = /^\s*import\s*[\w\s,]*$/;

// One line is enough: a multi-line string is only misread on its first line.
export function lineContext(linePrefix: string): "code" | "string" | "comment" {
  let quote: string | null = null;

  for (let index = 0; index < linePrefix.length; index += 1) {
    const character = linePrefix[index];

    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (linePrefix.startsWith(quote, index)) {
        index += quote.length - 1;
        quote = null;
      }
      continue;
    }

    if (character === "#") return "comment";

    if (character === '"' || character === "'") {
      const triple = character.repeat(3);
      quote = linePrefix.startsWith(triple, index) ? triple : character;
      if (quote.length === 3) index += 2;
    }
  }

  return quote ? "string" : "code";
}

function splitSignature(signature: string): { name: string; params: string } {
  const open = signature.indexOf("(");
  if (open < 0) return { name: signature, params: "" };

  const tail = signature.endsWith(")") ? signature.slice(open + 1, -1) : signature.slice(open + 1);
  return { name: signature.slice(0, open), params: tail };
}

function callableCompletion(signature: string, kind: "function" | "class"): PythonCompletion {
  const { name, params } = splitSignature(signature);
  if (!params) return { label: name, kind, detail: `${name}()`, insertText: `${name}()` };

  return {
    label: name,
    kind,
    detail: `${name}(${params})`,
    insertText: `${name}($0)`,
    isSnippet: true,
  };
}

function membersToCompletions(members: PythonModuleMembers | undefined): PythonCompletion[] {
  if (!members) return [];

  return [
    ...(members.functions ?? []).map((signature) => callableCompletion(signature, "function")),
    ...(members.classes ?? []).map((name) => callableCompletion(name, "class")),
    ...(members.values ?? []).map((name) => ({ label: name, kind: "value" as const })),
  ];
}

function moduleCompletions(): PythonCompletion[] {
  return PYTHON_MODULE_NAMES.map((name) => ({ label: name, kind: "module" as const }));
}

function globalCompletions(): PythonCompletion[] {
  const snippetLabels = new Set(PYTHON_SNIPPETS.map((snippet) => snippet.label));

  const completions: PythonCompletion[] = [
    ...PYTHON_SNIPPETS.map((snippet) => ({
      label: snippet.label,
      kind: "snippet" as const,
      detail: snippet.detail,
      insertText: snippet.body,
      isSnippet: true,
    })),
    ...PYTHON_KEYWORDS.filter((keyword) => !snippetLabels.has(keyword)).map((name) => ({
      label: name,
      kind: "keyword" as const,
    })),
    ...PYTHON_BUILTIN_FUNCTIONS.map((signature) => callableCompletion(signature, "function")),
    ...PYTHON_BUILTIN_CLASSES.map((name) => ({
      label: name,
      kind: "class" as const,
      detail: name,
    })),
    ...PYTHON_EXCEPTIONS.map((name) => ({ label: name, kind: "class" as const })),
    ...PYTHON_BUILTIN_VALUES.map((name) => ({ label: name, kind: "value" as const })),
  ];

  const seen = new Set<string>();
  return completions.filter((completion) => {
    if (seen.has(completion.label)) return false;
    seen.add(completion.label);
    return true;
  });
}

function membersForBase(
  base: string,
  imports: Record<string, string>,
): PythonModuleMembers | undefined {
  return PYTHON_MODULE_MEMBERS[imports[base] ?? base];
}

export function completionsFor({ linePrefix, imports }: CompletionContext): PythonCompletion[] {
  if (lineContext(linePrefix) !== "code") return [];

  const attribute = ATTRIBUTE_AT_END.exec(linePrefix);
  if (attribute) return membersToCompletions(membersForBase(attribute[1] ?? "", imports));

  const fromImport = FROM_IMPORT.exec(linePrefix);
  if (fromImport) return membersToCompletions(PYTHON_MODULE_MEMBERS[fromImport[1] ?? ""]);

  if (FROM_WITHOUT_IMPORT.test(linePrefix) || PLAIN_IMPORT.test(linePrefix))
    return moduleCompletions();

  return globalCompletions();
}

const IMPORT_LINE = /^\s*import\s+(.+?)\s*(?:#.*)?$/;
const FROM_LINE = /^\s*from\s+([\w.]+)\s+import\s+(.+?)\s*(?:#.*)?$/;

function importedNames(text: string): Array<{ name: string; alias?: string }> {
  return text
    .replace(/[()]/g, "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "*")
    .map((part) => {
      const [name, alias] = part.split(/\s+as\s+/);
      return { name: (name ?? "").trim(), alias: alias?.trim() };
    })
    .filter((entry) => entry.name.length > 0);
}

// Names bound by an import: `import os.path` binds `os`, `import numpy as np` binds `np`.
export function collectImportAliases(source: string): Record<string, string> {
  const aliases: Record<string, string> = {};

  for (const line of source.split("\n")) {
    const from = FROM_LINE.exec(line);
    if (from) {
      const moduleName = from[1] ?? "";
      for (const { name, alias } of importedNames(from[2] ?? "")) {
        aliases[alias ?? name] = `${moduleName}.${name}`;
      }
      continue;
    }

    const plain = IMPORT_LINE.exec(line);
    if (!plain) continue;

    for (const { name, alias } of importedNames(plain[1] ?? "")) {
      const root = name.split(".")[0] ?? name;
      aliases[alias ?? root] = alias ? name : root;
    }
  }

  return aliases;
}

function toCompletionItem(
  monacoInstance: Monaco,
  completion: PythonCompletion,
  range: MonacoTypes.IRange,
): MonacoTypes.languages.CompletionItem {
  const kinds = monacoInstance.languages.CompletionItemKind;
  const kindByCompletion: Record<PythonCompletionKind, MonacoTypes.languages.CompletionItemKind> = {
    keyword: kinds.Keyword,
    snippet: kinds.Snippet,
    function: kinds.Function,
    class: kinds.Class,
    module: kinds.Module,
    value: kinds.Constant,
  };

  const item: MonacoTypes.languages.CompletionItem = {
    label: completion.label,
    kind: kindByCompletion[completion.kind],
    range,
    detail: completion.detail,
    insertText: completion.insertText ?? completion.label,
  };

  if (completion.isSnippet) {
    item.insertTextRules = monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  }

  return item;
}

let registered = false;

export function registerPythonCompletions(monacoInstance: Monaco): void {
  if (registered) return;
  registered = true;

  monacoInstance.languages.registerCompletionItemProvider("python", {
    triggerCharacters: ["."],
    provideCompletionItems(model: MonacoTypes.editor.ITextModel, position: MonacoTypes.Position) {
      const linePrefix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const word = model.getWordUntilPosition(position);
      const range: MonacoTypes.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const imports = collectImportAliases(model.getValue());

      return {
        suggestions: completionsFor({ linePrefix, imports }).map((completion) =>
          toCompletionItem(monacoInstance, completion, range),
        ),
      };
    },
  });
}
