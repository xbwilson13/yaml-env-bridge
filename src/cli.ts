#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseYaml, serializeYaml } from './yaml.js';
import { yamlToEnv, envToYaml, parseEnvFile, serializeEnvFile } from './convert.js';

function printUsageAndExit(): never {
  console.error(`usage: yaml-env-bridge <input-file> [--to env|yaml] [--out <file>] [--lenient]

Converts between a YAML config file and a flat .env file. --to is inferred
from the input file's extension (.yaml/.yml -> env, .env -> yaml) if not
given explicitly.

Strict by default: refuses input that has no clean equivalent in the other
format (nested mappings, lists, or keys that aren't valid identifiers).
Pass --lenient to flatten nested YAML into "__"-joined keys, join lists
with commas, and reconstruct nesting from "__" when going back to YAML.`);
  process.exit(1);
}

interface Args {
  input: string;
  to?: 'env' | 'yaml';
  out?: string;
  lenient: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let to: 'env' | 'yaml' | undefined;
  let out: string | undefined;
  let lenient = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--to') {
      const value = argv[++i];
      if (value !== 'env' && value !== 'yaml') printUsageAndExit();
      to = value;
    } else if (arg === '--out') {
      out = argv[++i];
    } else if (arg === '--lenient') {
      lenient = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsageAndExit();
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1) printUsageAndExit();
  return { input: positional[0], to, out, lenient };
}

function inferDirection(inputPath: string): 'env' | 'yaml' {
  if (inputPath.endsWith('.env')) return 'yaml';
  if (inputPath.endsWith('.yaml') || inputPath.endsWith('.yml')) return 'env';
  printUsageAndExit();
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const to = args.to ?? inferDirection(args.input);
  const source = readFileSync(args.input, 'utf8');
  const opts = { lenient: args.lenient };

  let output: string;
  if (to === 'env') {
    const doc = parseYaml(source);
    const env = yamlToEnv(doc, opts);
    output = serializeEnvFile(env);
  } else {
    const env = parseEnvFile(source, opts);
    const doc = envToYaml(env, opts);
    output = serializeYaml(doc);
  }

  if (args.out) {
    writeFileSync(args.out, output, 'utf8');
  } else {
    process.stdout.write(output);
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
