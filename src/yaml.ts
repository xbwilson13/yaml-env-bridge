// Minimal YAML reader/writer for the config subset this tool cares about:
// block mappings, block lists (of scalars or maps), and scalar values
// (string, number, boolean, null). No flow style, anchors, tags,
// multi-document files, or block scalars (| and >) - those get an explicit
// error instead of a wrong silent parse. See README for the full list of
// what's out of scope.

export type YamlScalar = string | number | boolean | null;
export type YamlValue = YamlScalar | YamlValue[] | { [key: string]: YamlValue };

export class YamlParseError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.name = 'YamlParseError';
    this.line = line;
  }
}

interface Line {
  indent: number;
  text: string;
  lineNo: number;
}

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) {
      if (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t') return line.slice(0, i);
    }
  }
  return line;
}

function tokenize(text: string): Line[] {
  return text
    .split(/\r?\n/)
    .map((raw, idx) => ({ raw: stripComment(raw), lineNo: idx + 1 }))
    .filter((l) => l.raw.trim().length > 0)
    .map((l) => ({ indent: l.raw.length - l.raw.trimStart().length, text: l.raw.trim(), lineNo: l.lineNo }));
}

function findColon(text: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === ':' && !inSingle && !inDouble) {
      if (i === text.length - 1 || text[i + 1] === ' ') return i;
    }
  }
  return -1;
}

function unquote(raw: string): string {
  const quote = raw[0];
  const body = raw.slice(1, -1);
  if (quote === "'") return body.replace(/''/g, "'");
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && i + 1 < body.length) {
      const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' };
      const next = body[i + 1];
      if (next in escapes) {
        out += escapes[next];
        i++;
        continue;
      }
    }
    out += c;
  }
  return out;
}

function isQuoted(raw: string): boolean {
  return raw.length >= 2 && ((raw[0] === '"' && raw[raw.length - 1] === '"') || (raw[0] === "'" && raw[raw.length - 1] === "'"));
}

function unquoteKey(raw: string): string {
  return isQuoted(raw) ? unquote(raw) : raw;
}

function parseScalar(raw: string, lineNo: number): YamlScalar {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    throw new YamlParseError(`line ${lineNo}: flow-style collections ("[...]" / "{...}") aren't supported`, lineNo);
  }
  if (/^[|>][+-]?\d*$/.test(trimmed)) {
    throw new YamlParseError(`line ${lineNo}: block scalars ("|" and ">") aren't supported`, lineNo);
  }
  if (trimmed.startsWith('&') || trimmed.startsWith('*') || trimmed.startsWith('!')) {
    throw new YamlParseError(`line ${lineNo}: anchors, aliases and tags aren't supported`, lineNo);
  }
  if (isQuoted(trimmed)) return unquote(trimmed);
  if (trimmed === '~' || trimmed.toLowerCase() === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  return trimmed;
}

function parseBlock(lines: Line[], start: number, indent: number): [YamlValue, number] {
  const first = lines[start];
  if (first.text.startsWith('- ') || first.text === '-') return parseList(lines, start, indent);
  return parseMap(lines, start, indent);
}

function parseMap(lines: Line[], start: number, indent: number): [Record<string, YamlValue>, number] {
  const result: Record<string, YamlValue> = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i];
    const colonIdx = findColon(line.text);
    if (colonIdx === -1) {
      throw new YamlParseError(`line ${line.lineNo}: expected "key: value"`, line.lineNo);
    }
    const key = unquoteKey(line.text.slice(0, colonIdx).trim());
    const rest = line.text.slice(colonIdx + 1).trim();
    if (rest === '') {
      if (i + 1 < lines.length && lines[i + 1].indent > indent) {
        const [child, next] = parseBlock(lines, i + 1, lines[i + 1].indent);
        result[key] = child;
        i = next;
      } else {
        result[key] = null;
        i++;
      }
    } else {
      result[key] = parseScalar(rest, line.lineNo);
      i++;
      if (i < lines.length && lines[i].indent > indent) {
        throw new YamlParseError(`line ${lines[i].lineNo}: unexpected indent`, lines[i].lineNo);
      }
    }
  }
  return [result, i];
}

function parseList(lines: Line[], start: number, indent: number): [YamlValue[], number] {
  const result: YamlValue[] = [];
  let i = start;
  while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
    const line = lines[i];
    const rest = line.text === '-' ? '' : line.text.slice(2).trim();
    if (rest === '') {
      if (i + 1 < lines.length && lines[i + 1].indent > indent) {
        const [child, next] = parseBlock(lines, i + 1, lines[i + 1].indent);
        result.push(child);
        i = next;
      } else {
        result.push(null);
        i++;
      }
      continue;
    }
    if (!isQuoted(rest) && findColon(rest) !== -1) {
      // Inline map item ("- key: value"): the map's fields sit two columns in from
      // the dash, so splice a synthetic first line at that indent and hand the
      // whole run of same-or-deeper lines to parseMap.
      const itemIndent = indent + 2;
      const itemLines: Line[] = [{ indent: itemIndent, text: rest, lineNo: line.lineNo }];
      let j = i + 1;
      while (j < lines.length && lines[j].indent >= itemIndent) {
        itemLines.push(lines[j]);
        j++;
      }
      const [map] = parseMap(itemLines, 0, itemIndent);
      result.push(map);
      i = j;
      continue;
    }
    result.push(parseScalar(rest, line.lineNo));
    i++;
    if (i < lines.length && lines[i].indent > indent) {
      throw new YamlParseError(`line ${lines[i].lineNo}: unexpected indent`, lines[i].lineNo);
    }
  }
  return [result, i];
}

export function parseYaml(text: string): YamlValue {
  const lines = tokenize(text);
  if (lines.length === 0) return {};
  const [value] = parseBlock(lines, 0, lines[0].indent);
  return value;
}

function isScalar(value: YamlValue): value is YamlScalar {
  return value === null || typeof value !== 'object';
}

function needsScalarQuoting(s: string): boolean {
  if (s === '') return true;
  if (/^(true|false|null|~)$/i.test(s)) return true;
  if (/^-?\d+(\.\d+)?$/.test(s)) return true;
  if (/^\s|\s$/.test(s)) return true;
  if (/[:#[\]{},&*!|>'"%@`]/.test(s)) return true;
  return false;
}

function serializeScalar(v: YamlScalar): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return needsScalarQuoting(v) ? JSON.stringify(v) : v;
}

function needsKeyQuoting(key: string): boolean {
  return key === '' || /[:#\s]/.test(key) || key.startsWith('-') || key.startsWith('?');
}

function serializeBlock(value: YamlValue, depth: number): string {
  const pad = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`;
    return value
      .map((item) => {
        if (isScalar(item)) return `${pad}- ${serializeScalar(item)}\n`;
        if (Array.isArray(item)) return `${pad}-\n${serializeBlock(item, depth + 1)}`;
        // Map items read better as "- key: value" with the rest of the keys
        // aligned under it, rather than a bare dash on its own line.
        const childPad = `${pad}  `;
        return serializeBlock(item, depth + 1).replace(childPad, `${pad}- `);
      })
      .join('');
  }
  const obj = value as Record<string, YamlValue>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return `${pad}{}\n`;
  return keys
    .map((key) => {
      const v = obj[key];
      const safeKey = needsKeyQuoting(key) ? JSON.stringify(key) : key;
      return isScalar(v) ? `${pad}${safeKey}: ${serializeScalar(v)}\n` : `${pad}${safeKey}:\n${serializeBlock(v, depth + 1)}`;
    })
    .join('');
}

export function serializeYaml(value: YamlValue): string {
  if (isScalar(value)) return `${serializeScalar(value)}\n`;
  return serializeBlock(value, 0);
}
