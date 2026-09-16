# yaml-env-bridge

App config usually starts as YAML because it's readable and lets you nest
things (`database.host`, `database.port`). Then something in the deploy path
only understands flat `KEY=VALUE` pairs - `docker run --env-file`, a systemd
`EnvironmentFile`, a CI secrets panel. So the YAML gets hand-copied into a
`.env` file, the two drift apart, and eventually the flat file is wrong and
nobody notices until a deploy breaks.

This is a CLI that converts between the two. It's strict by default: if the
YAML has a shape that doesn't map cleanly onto flat env vars (a nested
mapping, a list), it refuses and tells you why instead of guessing. Pass
`--lenient` when you actually want that guess.

## Usage

```
yaml-env-bridge <input-file> [--to env|yaml] [--out <file>] [--lenient]
```

`--to` is inferred from the input's extension if you don't pass it:
`.yaml`/`.yml` -> `env`, `.env` -> `yaml`.

Given `config.yaml`:

```yaml
service_name: checkout
port: 8080
debug: false
```

```
$ yaml-env-bridge config.yaml
service_name=checkout
port=8080
debug=false
```

Write straight to a file with `--out`:

```
$ yaml-env-bridge config.yaml --out .env
```

And the reverse direction:

```
$ cat .env
service_name=checkout
port=8080
debug=false

$ yaml-env-bridge .env --to yaml
service_name: checkout
port: 8080
debug: false
```

### Strict by default

Without `--lenient`, anything that has no exact env-var equivalent is a hard
error rather than a silent lossy conversion:

```yaml
service_name: checkout
database:
  host: db.internal
  port: 5432
tags:
  - web
  - checkout
```

```
$ yaml-env-bridge config.yaml
key "database" holds a nested mapping, which has no flat env-var form (use --lenient to allow this)
```

### `--lenient`

With `--lenient`, nested mappings are flattened by joining keys with `__`,
and lists are joined into a comma-separated string:

```
$ yaml-env-bridge config.yaml --lenient
service_name=checkout
database__host=db.internal
database__port=5432
tags=web,checkout
```

Converting back with `--lenient` reconstructs the nesting from `__`, and
infers numbers/booleans from the plain-string env values. Without
`--lenient`, env keys map straight across as flat top-level YAML keys with
string values, which is the honest round trip for a format that has no
native types.

## What the YAML side does not support

This ships with a small hand-written YAML reader rather than pulling in a
dependency, so it only covers the subset actually needed for flat-ish config
files: block mappings, block lists of scalars, and scalar values (strings,
numbers, booleans, null). It will raise a clear error, not a silent wrong
answer, on:

- flow style (`key: [a, b]`, `key: {a: b}`)
- block scalars (`|` and `>`)
- anchors, aliases, and tags (`&foo`, `*foo`, `!!str`)
- multi-document files (`---` separators)
- lists whose items are themselves mappings

## Install

No package registry entry yet - clone the repo and build locally:

```
npm run build
node dist/cli.js config.yaml
```

There are no runtime dependencies.

## License

MIT, see LICENSE.
