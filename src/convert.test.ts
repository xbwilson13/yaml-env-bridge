import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  yamlToEnv,
  envToYaml,
  parseEnvFile,
  serializeEnvFile,
  StrictModeError,
} from './convert.js';

test('yamlToEnv converts a flat mapping to KEY=VALUE strings', () => {
  const env = yamlToEnv({ service_name: 'checkout', port: 8080, debug: false, note: null });
  assert.deepEqual(env, { service_name: 'checkout', port: '8080', debug: 'false', note: '' });
});

test('yamlToEnv rejects a nested mapping without --lenient', () => {
  assert.throws(() => yamlToEnv({ database: { host: 'db.internal' } }), StrictModeError);
});

test('yamlToEnv rejects a list without --lenient', () => {
  assert.throws(() => yamlToEnv({ tags: ['web', 'checkout'] }), StrictModeError);
});

test('yamlToEnv rejects a non-identifier key without --lenient', () => {
  assert.throws(() => yamlToEnv({ 'weird key': 1 }), StrictModeError);
});

test('yamlToEnv rejects a non-mapping top level', () => {
  assert.throws(() => yamlToEnv(['a', 'b']), StrictModeError);
  assert.throws(() => yamlToEnv('just a string'), StrictModeError);
});

test('yamlToEnv --lenient flattens nested mappings with __ and joins lists', () => {
  const env = yamlToEnv(
    { service_name: 'checkout', database: { host: 'db.internal', port: 5432 }, tags: ['web', 'checkout'] },
    { lenient: true },
  );
  assert.deepEqual(env, {
    service_name: 'checkout',
    database__host: 'db.internal',
    database__port: '5432',
    tags: 'web,checkout',
  });
});

test('yamlToEnv --lenient sanitizes keys that are not valid identifiers', () => {
  const env = yamlToEnv({ 'weird key': 1, '2fast': 2 }, { lenient: true });
  assert.deepEqual(env, { weird_key: '1', _2fast: '2' });
});

test('yamlToEnv --lenient still rejects a map nested inside a list', () => {
  assert.throws(() => yamlToEnv({ items: [{ a: 1 }] }, { lenient: true }), StrictModeError);
});

test('envToYaml maps env keys straight across as strings by default', () => {
  const doc = envToYaml({ service_name: 'checkout', port: '8080', debug: 'false' });
  assert.deepEqual(doc, { service_name: 'checkout', port: '8080', debug: 'false' });
});

test('envToYaml rejects a non-identifier key without --lenient', () => {
  assert.throws(() => envToYaml({ 'not valid': '1' }), StrictModeError);
});

test('envToYaml --lenient reconstructs nesting from __ and infers types', () => {
  const doc = envToYaml(
    { service_name: 'checkout', database__host: 'db.internal', database__port: '5432', flag: 'true' },
    { lenient: true },
  );
  assert.deepEqual(doc, {
    service_name: 'checkout',
    database: { host: 'db.internal', port: 5432 },
    flag: true,
  });
});

test('parseEnvFile parses KEY=VALUE and skips blanks and comments', () => {
  const env = parseEnvFile('# comment\n\nservice_name=checkout\nport=8080\n');
  assert.deepEqual(env, { service_name: 'checkout', port: '8080' });
});

test('parseEnvFile unquotes double- and single-quoted values', () => {
  const env = parseEnvFile('a="line one\\nline two"\nb=\'raw $tuff\'\n');
  assert.deepEqual(env, { a: 'line one\nline two', b: 'raw $tuff' });
});

test('parseEnvFile rejects "export" prefix without --lenient', () => {
  assert.throws(() => parseEnvFile('export FOO=bar\n'), StrictModeError);
  assert.deepEqual(parseEnvFile('export FOO=bar\n', { lenient: true }), { FOO: 'bar' });
});

test('parseEnvFile rejects an invalid key without --lenient', () => {
  assert.throws(() => parseEnvFile('not-valid=1\n'), StrictModeError);
  assert.deepEqual(parseEnvFile('not-valid=1\n', { lenient: true }), { 'not-valid': '1' });
});

test('parseEnvFile raises a plain error on a malformed line', () => {
  assert.throws(() => parseEnvFile('this has no equals sign\n'), /expected KEY=VALUE/);
});

test('serializeEnvFile quotes values that need it and leaves plain ones bare', () => {
  const text = serializeEnvFile({ plain: 'db.internal', empty: '', spaced: 'has space', quote: 'say "hi"' });
  assert.equal(text, 'plain=db.internal\nempty=""\nspaced="has space"\nquote="say \\"hi\\""\n');
});

test('parseEnvFile and serializeEnvFile round-trip', () => {
  const env = { service_name: 'checkout', port: '8080', debug: 'false', message: 'has "quotes" and\nnewline' };
  assert.deepEqual(parseEnvFile(serializeEnvFile(env)), env);
});

test('yamlToEnv and envToYaml round-trip a flat document without --lenient', () => {
  const original = { service_name: 'checkout', port: '8080', debug: 'false' };
  const doc = envToYaml(original);
  const env = yamlToEnv(doc);
  assert.deepEqual(env, original);
});

test('yamlToEnv and envToYaml round-trip a nested document with --lenient', () => {
  const original = {
    service_name: 'checkout',
    database: { host: 'db.internal', port: 5432 },
    tags: ['web', 'checkout'],
  };
  const env = yamlToEnv(original, { lenient: true });
  const doc = envToYaml(env, { lenient: true });
  assert.deepEqual(doc, {
    service_name: 'checkout',
    database: { host: 'db.internal', port: 5432 },
    tags: 'web,checkout',
  });
});
