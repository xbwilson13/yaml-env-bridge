#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseYaml, serializeYaml } from './yaml.js';
import { yamlToEnv, envToYaml, parseEnvFile, serializeEnvFile, diffEnv } from './convert.js';

function printUsageAndExit(): never {
  console.error(`usage: yaml-env-bridge <input-file> [--to env|yaml] [--out <file>] [--lenient]
       yaml-env-bridge <yaml-file> --check <env-file> [--lenient]

Converts between a YAML config file and a flat .env file. --to is inferred
from the input file's extension (.yaml/.yml -> env, .env -> yaml) if not
given explicitly.

Strict by default: refuses input that has no clean equivalent in the other
format (nested mappings, lists, or keys that aren't valid identifiers).
Pass --lenient to flatten nested YAML into "__"-joined keys, join lists
with commas, and reconstruct nesting from "__" when going back to YAML.

--check <env-file> compares what the yaml source would produce against an
existing .env file without writing anything. It prints the differences and
exits with status 1 if any are found, 0 if the file is already up to date.`);
  process.exit(1);
}

interface Args {
  input: string;
  to?: 'env' | 'yaml';
  out?: string;
  lenient: boolean;
  check?: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let to: 'env' | 'yaml' | undefined;
  let out: string | undefined;
  let lenient = false;
  let check: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--to') {
      const value = argv[++i];
      if (value !== 'env' && value !== 'yaml') printUsageAndExit();
      to = value;
    } else if (arg === '--out') {
      out = argv[++i];
    } else if (arg === '--check') {
      check = argv[++i];
    } else if (arg === '--lenient') {
      lenient = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsageAndExit();
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1) printUsageAndExit();
  if (check !== undefined && out !== undefined) printUsageAndExit();
  return { input: positional[0], to, out, lenient, check };
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

  if (args.check !== undefined) {
    if (to !== 'env') {
      console.error('--check compares a yaml source against an existing .env file, so the input must be yaml');
      process.exit(1);
    }
    const expected = yamlToEnv(parseYaml(source), opts);
    const actual = parseEnvFile(readFileSync(args.check, 'utf8'), opts);
    const diffs = diffEnv(expected, actual);
    if (diffs.length === 0) {
      console.log(`${args.check} is up to date with ${args.input}`);
      return;
    }
    for (const d of diffs) {
      if (d.kind === 'added') console.log(`+ ${d.key}=${d.expected}`);
      else if (d.kind === 'removed') console.log(`- ${d.key}=${d.actual}`);
      else console.log(`~ ${d.key}=${d.actual} -> ${d.expected}`);
    }
    process.exit(1);
  }

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
