#!/usr/bin/env node
/**
 * Small, dependency-free validator for third-party movement libraries.
 *
 * Usage:
 *   posecode-parser validate movement.posecode ./movement-directory
 *   posecode-parser validate --strict --json ./movement-directory
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "./index.js";
import type { ParseError, Warning } from "./types.js";

export interface FileValidation {
  file: string;
  errors: ParseError[];
  warnings: Warning[];
}

export interface ValidationSummary {
  files: FileValidation[];
  fileCount: number;
  errorCount: number;
  warningCount: number;
}

export function validatePaths(inputs: string[]): ValidationSummary {
  const paths = [...new Set(inputs.flatMap(collectPosecodeFiles))].sort();
  const files = paths.map((file): FileValidation => {
    const source = readFileSync(file, "utf8");
    const { errors, warnings } = parse(source);
    return { file, errors, warnings };
  });

  return {
    files,
    fileCount: files.length,
    errorCount: files.reduce((total, file) => total + file.errors.length, 0),
    warningCount: files.reduce((total, file) => total + file.warnings.length, 0),
  };
}

function collectPosecodeFiles(input: string): string[] {
  const path = resolve(input);
  const stat = statSync(path);
  if (stat.isFile()) return extname(path) === ".posecode" ? [path] : [];
  if (!stat.isDirectory()) return [];

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) return collectPosecodeFiles(child);
    return entry.isFile() && extname(entry.name) === ".posecode" ? [child] : [];
  });
}

export function renderValidation(summary: ValidationSummary): string {
  const lines: string[] = [];
  for (const file of summary.files) {
    for (const error of file.errors) {
      lines.push(`${file.file}:${error.line}: error: ${error.message}`);
    }
    for (const warning of file.warnings) {
      lines.push(
        `${file.file}:${warning.line}: warning: ${warning.joint} ${warning.action} ` +
          `${warning.requested}° was clamped to ${warning.clamped}°`,
      );
    }
  }
  lines.push(
    `Validated ${summary.fileCount} .posecode file(s): ` +
      `${summary.errorCount} error(s), ${summary.warningCount} warning(s).`,
  );
  return lines.join("\n");
}

export function main(argv: string[]): number {
  const args = argv[0] === "validate" ? argv.slice(1) : argv;
  const json = args.includes("--json");
  const strict = args.includes("--strict");
  const inputs = args.filter((arg) => !arg.startsWith("--"));

  if (inputs.length === 0) {
    console.error("Usage: posecode-parser validate [--strict] [--json] <file-or-directory> [...]");
    return 2;
  }

  try {
    const summary = validatePaths(inputs);
    if (summary.fileCount === 0) {
      console.error("No .posecode files found.");
      return 2;
    }
    console.log(json ? JSON.stringify(summary, null, 2) : renderValidation(summary));
    return summary.errorCount > 0 || (strict && summary.warningCount > 0) ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = main(process.argv.slice(2));
}
