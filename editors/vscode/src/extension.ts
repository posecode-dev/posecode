/**
 * Movit VS Code extension entry point.
 *
 * Syntax highlighting comes from the bundled TextMate grammar; everything
 * smarter (range-of-motion diagnostics, completion, hover) comes from the
 * Movit language server, which this client launches over stdio. The server is
 * bundled to `dist/server.cjs` by `npm run build` so it runs with plain node.
 */

import * as path from "node:path";
import { type ExtensionContext } from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join("dist", "server.cjs"));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: { module: serverModule, transport: TransportKind.stdio },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "movit" }],
  };

  client = new LanguageClient(
    "movit",
    "Movit Language Server",
    serverOptions,
    clientOptions,
  );
  void client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
