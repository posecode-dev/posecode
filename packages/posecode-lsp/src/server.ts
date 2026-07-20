#!/usr/bin/env node
/**
 * Posecode language server (stdio). Thin wiring around the pure converters in
 * convert.ts: diagnostics on change, completion, and hover. Run via `tsx` in
 * dev or as the bundled `dist/server.cjs` from the VS Code extension.
 */

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeResult,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { toDiagnostics, toCompletions, toHover } from "./convert.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: { triggerCharacters: [" ", ":", "="] },
    hoverProvider: true,
  },
}));

documents.onDidChangeContent((change) => {
  connection.sendDiagnostics({
    uri: change.document.uri,
    diagnostics: toDiagnostics(change.document.getText()),
  });
});

connection.onCompletion((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return toCompletions(doc.getText(), params.position.line, params.position.character);
});

connection.onHover((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  return toHover(doc.getText(), params.position.line, params.position.character);
});

documents.listen(connection);
connection.listen();
