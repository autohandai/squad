#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "Usage: $0 v <semver>" >&2
  exit 2
fi

tag_prefix="$1"
version="$2"

if [[ "$tag_prefix" != "v" ]]; then
  echo "::error::Unsupported release tag prefix '$tag_prefix'. Expected 'v'." >&2
  exit 1
fi

validate_semver() {
  local candidate="$1"
  local core prerelease major minor patch extra identifier

  # The release artifact and installer contracts do not accept SemVer build
  # metadata. Pre-release identifiers are supported and validated below.
  [[ "$candidate" != *+* ]] || return 1

  if [[ "$candidate" == *-* ]]; then
    core="${candidate%%-*}"
    prerelease="${candidate#*-}"
    [[ -n "$prerelease" ]] || return 1
    [[ "$prerelease" != .* && "$prerelease" != *. && "$prerelease" != *..* ]] || return 1
  else
    core="$candidate"
    prerelease=""
  fi

  IFS=. read -r major minor patch extra <<< "$core"
  [[ -z "${extra:-}" ]] || return 1
  for identifier in "$major" "$minor" "$patch"; do
    [[ "$identifier" =~ ^(0|[1-9][0-9]*)$ ]] || return 1
  done

  if [[ -n "$prerelease" ]]; then
    local identifiers=()
    IFS=. read -r -a identifiers <<< "$prerelease"
    for identifier in "${identifiers[@]}"; do
      [[ "$identifier" =~ ^[0-9A-Za-z-]+$ ]] || return 1
      if [[ "$identifier" =~ ^[0-9]+$ && "$identifier" != "0" && "$identifier" == 0* ]]; then
        return 1
      fi
    done
  fi
}

if ! validate_semver "$version"; then
  echo "::error::Invalid release version. Expected SemVer such as 0.4.0 or 1.0.0-beta.1." >&2
  exit 1
fi

tag="${tag_prefix}${version}"
expected_ref="refs/tags/${tag}"

if [[ "${GITHUB_REF:-}" != "$expected_ref" ]]; then
  echo "::error::Release must run from $expected_ref; current ref is ${GITHUB_REF:-<unset>}." >&2
  exit 1
fi

if ! git show-ref --verify --quiet "$expected_ref"; then
  echo "::error::Release tag $expected_ref is missing from the checkout." >&2
  exit 1
fi

head_sha="$(git rev-parse 'HEAD^{commit}')"
tag_sha="$(git rev-parse "${expected_ref}^{commit}")"

if [[ "$head_sha" != "$tag_sha" ]]; then
  echo "::error::HEAD ($head_sha) does not match $expected_ref ($tag_sha)." >&2
  exit 1
fi

echo "Verified $expected_ref at $head_sha."
