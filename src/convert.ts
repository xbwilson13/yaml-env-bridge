import type { YamlScalar, YamlValue } from './yaml.js';

export type EnvMap = Record<string, string>;

export interface ConvertOptions {
  lenient?: boolean;
}

// Thrown for anything that would need --lenient to resolve. Kept separate
// from generic parse errors so the CLI can point people at the flag instead
// of just printing "something is wrong".
export class StrictModeError extends Error {
  constructor(message: string) {
    super(`${message} (use --lenient to allow this)`);
    this.name = 'StrictModeError';
  }
}

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function yamlToEnv(doc: YamlValue, opts: ConvertOptions = {}): EnvMap {
  const lenient = opts.lenient ?? false;
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new StrictModeError('the top-level YAML document must be a mapping of keys to values');
  }
  const result: EnvMap = {};
  flatten(doc as Record<string, YamlValue>, [], result, lenient);
  return result;
}

function flatten(obj: Record<string, YamlValue>, path: string[], out: EnvMap, lenient: boolean): void {
  for (const rawKey of Object.keys(obj)) {
    const value = obj[rawKey];
    const key = sanitizeKey(rawKey, path, lenient);
    const fullPath = [...path, key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      if (!lenient) {
        throw new StrictModeError(`key "${fullPath.join('.')}" holds a nested mapping, which has no flat env-var form`);
      }
      flatten(value as Record<string, YamlValue>, fullPath, out, lenient);
      continue;
    }
    if (Array.isArray(value)) {
      if (!lenient) {
        throw new StrictModeError(`key "${fullPath.join('.')}" holds a list, which has no flat env-var form`);
      }
      out[fullPath.join('__')] = value.map((v) => scalarToEnvString(v, fullPath)).join(',');
      continue;
    }
    out[fullPath.join('__')] = scalarToEnvString(value, fullPath);
  }
}

function sanitizeKey(rawKey: string, path: string[], lenient: boolean): string {
  if (ENV_KEY_RE.test(rawKey)) return rawKey;
  if (!lenient) {
    throw new StrictModeError(`key "${[...path, rawKey].join('.')}" is not a valid env-var identifier`);
  }
  const sanitized = rawKey.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
  return sanitized === '' ? '_' : sanitized;
}

function scalarToEnvString(value: YamlValue, path: string[]): string {
  if (value !== null && typeof value === 'object') {
    throw new StrictModeError(`key "${path.join('.')}" holds a nested value inside a list, which has no flat env-var form`);
  }
  if (value === null) return '';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return value;
}

export function envToYaml(env: EnvMap, opts: ConvertOptions = {}): YamlValue {
  const lenient = opts.lenient ?? false;
  const result: Record<string, YamlValue> = {};
  for (const rawKey of Object.keys(env)) {
    if (!ENV_KEY_RE.test(rawKey) && !lenient) {
      throw new StrictModeError(`env key "${rawKey}" is not a valid identifier`);
    }
    const value = env[rawKey];
    if (!lenient) {
      result[rawKey] = value;
      continue;
    }
    const parts = rawKey.split('__').filter((p) => p.length > 0);
    setNested(result, parts.length > 0 ? parts : [rawKey], inferScalar(value));
  }
  return result;
}

function setNested(root: Record<string, YamlValue>, path: string[], value: YamlValue): void {
  let node = root;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const existing = node[segment];
    if (existing !== null && typeof existing === 'object' && !Array.isArray(existing)) {
      node = existing as Record<string, YamlValue>;
    } else {
      const created: Record<string, YamlValue> = {};
      node[segment] = created;
      node = created;
    }
  }
  node[path[path.length - 1]] = value;
}

function inferScalar(value: string): YamlScalar {
  if (value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  return value;
}

const ENV_LINE_RE = /^([^=\s][^=]*)=(.*)$/;

export function parseEnvFile(text: string, opts: ConvertOptions = {}): EnvMap {
  const lenient = opts.lenient ?? false;
  const result: EnvMap = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    let content = trimmed;
    if (/^export\s+/.test(content)) {
      if (!lenient) {
        throw new StrictModeError(`line ${lineNo}: "export" prefix is not allowed`);
      }
      content = content.replace(/^export\s+/, '');
    }

    const match = ENV_LINE_RE.exec(content);
    if (!match) {
      throw new Error(`line ${lineNo}: expected KEY=VALUE, got "${line}"`);
    }
    const key = match[1];
    if (!ENV_KEY_RE.test(key) && !lenient) {
      throw new StrictModeError(`line ${lineNo}: key "${key}" is not a valid identifier`);
    }
    result[key] = unquoteEnvValue(match[2].trim());
  }
  return result;
}

function unquoteEnvValue(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if (first === '"' && last === '"') {
      return raw.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
    if (first === "'" && last === "'") {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

export interface EnvDiffEntry {
  key: string;
  kind: 'added' | 'removed' | 'changed';
  expected?: string;
  actual?: string;
}

// "expected" is what the yaml source would produce, "actual" is what's
// currently sitting in the .env file on disk. Sorted by key so the report
// is stable across runs regardless of either map's insertion order.
export function diffEnv(expected: EnvMap, actual: EnvMap): EnvDiffEntry[] {
  const keys = Array.from(new Set([...Object.keys(expected), ...Object.keys(actual)])).sort();
  const entries: EnvDiffEntry[] = [];
  for (const key of keys) {
    const inExpected = Object.prototype.hasOwnProperty.call(expected, key);
    const inActual = Object.prototype.hasOwnProperty.call(actual, key);
    if (inExpected && !inActual) {
      entries.push({ key, kind: 'added', expected: expected[key] });
    } else if (!inExpected && inActual) {
      entries.push({ key, kind: 'removed', actual: actual[key] });
    } else if (expected[key] !== actual[key]) {
      entries.push({ key, kind: 'changed', expected: expected[key], actual: actual[key] });
    }
  }
  return entries;
}

export function serializeEnvFile(env: EnvMap): string {
  return Object.keys(env)
    .map((key) => `${key}=${quoteEnvValue(env[key])}\n`)
    .join('');
}

function quoteEnvValue(value: string): string {
  if (value === '') return '""';
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}
