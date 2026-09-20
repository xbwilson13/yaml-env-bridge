import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, serializeYaml, YamlParseError } from './yaml.js';

test('parses flat scalars with inferred types', () => {
  const doc = parseYaml('service_name: checkout\nport: 8080\ndebug: false\nnote: ~\n');
  assert.deepEqual(doc, { service_name: 'checkout', port: 8080, debug: false, note: null });
});

test('parses nested mappings', () => {
  const doc = parseYaml('database:\n  host: db.internal\n  port: 5432\n');
  assert.deepEqual(doc, { database: { host: 'db.internal', port: 5432 } });
});

test('parses block lists of scalars', () => {
  const doc = parseYaml('tags:\n  - web\n  - checkout\n');
  assert.deepEqual(doc, { tags: ['web', 'checkout'] });
});

test('parses single and double quoted scalars, including escapes', () => {
  const doc = parseYaml(`single: 'it''s fine'\ndouble: "a\\nb"\n`);
  assert.deepEqual(doc, { single: "it's fine", double: 'a\nb' });
});

test('parses quoted keys', () => {
  const doc = parseYaml('"weird key": value\n');
  assert.deepEqual(doc, { 'weird key': 'value' });
});

test('strips trailing comments but leaves # inside quotes alone', () => {
  const doc = parseYaml('a: 1 # comment\nb: "has # inside"\n');
  assert.deepEqual(doc, { a: 1, b: 'has # inside' });
});

test('ignores blank lines and full-line comments', () => {
  const doc = parseYaml('# leading comment\n\na: 1\n\n# trailing\n');
  assert.deepEqual(doc, { a: 1 });
});

test('distinguishes ints and floats from plain strings', () => {
  const doc = parseYaml('int: 42\nneg: -7\nfloat: 3.14\nstr: 42abc\n');
  assert.deepEqual(doc, { int: 42, neg: -7, float: 3.14, str: '42abc' });
});

test('rejects flow-style sequences and mappings', () => {
  assert.throws(() => parseYaml('a: [1, 2]\n'), YamlParseError);
  assert.throws(() => parseYaml('a: {b: 1}\n'), YamlParseError);
});

test('rejects block scalars', () => {
  assert.throws(() => parseYaml('a: |\n  text\n'), YamlParseError);
  assert.throws(() => parseYaml('a: >\n  text\n'), YamlParseError);
});

test('rejects anchors, aliases and tags', () => {
  assert.throws(() => parseYaml('a: &anchor value\n'), YamlParseError);
  assert.throws(() => parseYaml('a: *anchor\n'), YamlParseError);
  assert.throws(() => parseYaml('a: !!str value\n'), YamlParseError);
});

test('rejects list items that are themselves maps', () => {
  assert.throws(() => parseYaml('items:\n  - a: 1\n    b: 2\n'), YamlParseError);
});

test('rejects unexpected indentation', () => {
  assert.throws(() => parseYaml('a: 1\n    b: 2\n'), YamlParseError);
});

test('empty document parses to an empty mapping', () => {
  assert.deepEqual(parseYaml(''), {});
  assert.deepEqual(parseYaml('\n\n'), {});
});

test('serializeYaml round-trips a nested document through parseYaml', () => {
  const original = {
    service_name: 'checkout',
    port: 8080,
    debug: false,
    note: null,
    tags: ['web', 'checkout'],
    database: { host: 'db.internal', port: 5432 },
  };
  const text = serializeYaml(original);
  assert.deepEqual(parseYaml(text), original);
});

test('serializeYaml quotes scalars that would otherwise be misread', () => {
  const text = serializeYaml({ a: 'true', b: '42', c: '', d: ' padded ' });
  assert.deepEqual(parseYaml(text), { a: 'true', b: '42', c: '', d: ' padded ' });
});
