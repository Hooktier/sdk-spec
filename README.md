# Hooktier SDK bundle

This repository publishes the MIT-licensed public OpenAPI specification, conformance
cases, webhook vectors, and shared tools used by Hooktier SDKs. SDKs consume this
bundle rather than reading the main Hooktier repository or the website's spec copy.

Bundle files come from export pull requests only. Never hand-edit them. Exports
replace only `bundle/`; repository documentation and scripts remain outside it.
The first export adds `bundle/`, which is absent during repository bootstrap.

```text
bundle/
  openapi.yaml
  cases/
  vectors/
  tools/
  MANIFEST.json
LICENSE
README.md
scripts/
.github/
```

`openapi.yaml` excludes private `x-hooktier-*` extensions. `MANIFEST.json` records
the integer bundle version, case schema version, source commit, and every bundle
file's SHA-256 hash. `tools/` includes manifest verification, change reporting,
disposition checking, its schema, and fixtures. SDK-W adds `.github/` workflows separately.

## Bundle releases

Immutable tags use `bundle-vN`, where `N` is an integer from `MANIFEST.json`.
The release workflow tags an export after merge and owner approval. Tags are never
moved, deleted, or reused. Failed or bad bundles are abandoned. The next export
uses one more than the highest tag number or the bundle version on `main`,
whichever is greater, including versions whose release failed before tagging.

A bundle is eligible only when its GitHub release is published, neither a draft
nor a prerelease, and its `MANIFEST.json` asset matches the tag's
`bundle/MANIFEST.json` byte for byte. Publication happens after the release checks;
eligibility does not depend on the job's final conclusion. Other tags are abandoned.
To abandon a published bad bundle, the owner immediately marks its release as a
prerelease with the title suffix `(abandoned)`.

## SDK sync (K18)

Each SDK's weekly sync selects the newest eligible `bundle-vN` and verifies all
bundle hashes. It computes the full `oasdiff diff --format json` from its current
`spec/openapi.yaml` to the target spec. The target bundle's `tools/changes.mjs`
converts that diff into `spec/changes.json`, recording both bundle versions.
This includes changes across skipped bundles.

The sync runs in the SDK's `release-pr` environment. Its `hooktier-release-pr`
token opens a pull request that replaces `spec/` with the target `bundle/` and
adds `spec/changes.json`, triggering CI. Manifest verification allows only that
SDK-local file with `--allow changes.json`. Conformance and disposition checks
fail until the SDK implements or explains every change and passes every case.

## Local checks

Scripts require Node 22.14 or later and use no package dependencies.

```sh
node --test scripts/
node scripts/mutation-test.mjs --bundle <dir> --oasdiff <binary>
```

The mutation check adds one optional property to `CustomerCreate` in a temporary
copy. It runs the supplied `oasdiff` binary and the bundle's `tools/changes.mjs`,
then requires exactly the property's change ID. The source bundle stays unchanged.
Unit tests use temporary fake bundles and a fake binary; no export is needed.
