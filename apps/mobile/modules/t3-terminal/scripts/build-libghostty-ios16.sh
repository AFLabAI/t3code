#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENDOR_DIR="${MODULE_DIR}/Vendor/libghostty"
PATCH_DIR="${SCRIPT_DIR}/libghostty-ios-patches"
LAYER_LIFETIME_PATCH="${PATCH_DIR}/0001-clear-display-callback-before-layer-release.patch"

GHOSTTY_REVISION="d36c3b8dffd0d756dd5e5f4933962f774a0e6753"
GHOSTTY_SOURCE_DIR="${GHOSTTY_SOURCE_DIR:-${HOME}/.cache/t3code/ghostty-${GHOSTTY_REVISION:0:8}}"
GHOSTTY_REPOSITORY_URL="${GHOSTTY_REPOSITORY_URL:-https://github.com/Yash-Singh1/ghostty.git}"
GHOSTTY_ZIG_VERSION="${GHOSTTY_ZIG_VERSION:-0.15.2}"
GHOSTTY_ZIG="${GHOSTTY_ZIG:-}"

log() {
  printf '[libghostty-ios16] %s\n' "$*"
}

die() {
  printf '[libghostty-ios16] error: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

ensure_zig() {
  if [[ -n "${GHOSTTY_ZIG}" ]]; then
    [[ -x "${GHOSTTY_ZIG}" ]] || die "GHOSTTY_ZIG is not executable: ${GHOSTTY_ZIG}"
    return
  fi

  if command -v zig >/dev/null 2>&1 && [[ "$(zig version)" == "${GHOSTTY_ZIG_VERSION}" ]]; then
    GHOSTTY_ZIG="$(command -v zig)"
    return
  fi

  local cache_dir="${HOME}/.cache/t3code/zig-${GHOSTTY_ZIG_VERSION}"
  local archive_arch
  archive_arch="$(uname -m)"
  case "${archive_arch}" in
    arm64) archive_arch="aarch64" ;;
    x86_64) archive_arch="x86_64" ;;
    *) die "unsupported macOS architecture for Zig download: ${archive_arch}" ;;
  esac

  GHOSTTY_ZIG="${cache_dir}/zig"
  if [[ -x "${GHOSTTY_ZIG}" ]]; then
    return
  fi

  require_cmd curl
  require_cmd tar
  mkdir -p "${cache_dir}"
  log "downloading Zig ${GHOSTTY_ZIG_VERSION}"
  curl -fsSL "https://ziglang.org/download/${GHOSTTY_ZIG_VERSION}/zig-${archive_arch}-macos-${GHOSTTY_ZIG_VERSION}.tar.xz" \
    | tar -xJ --strip-components=1 -C "${cache_dir}"
}

ensure_ghostty_source() {
  if ! git -C "${GHOSTTY_SOURCE_DIR}" rev-parse --git-dir >/dev/null 2>&1; then
    require_cmd git
    log "cloning Ghostty ${GHOSTTY_REVISION}"
    git clone --filter=blob:none --no-checkout "${GHOSTTY_REPOSITORY_URL}" \
      "${GHOSTTY_SOURCE_DIR}"
    git -C "${GHOSTTY_SOURCE_DIR}" fetch --depth=1 origin "${GHOSTTY_REVISION}"
    git -C "${GHOSTTY_SOURCE_DIR}" checkout --detach "${GHOSTTY_REVISION}"
  fi

  local actual_revision
  actual_revision="$(git -C "${GHOSTTY_SOURCE_DIR}" rev-parse HEAD)"
  [[ "${actual_revision}" == "${GHOSTTY_REVISION}" ]] || \
    die "expected Ghostty ${GHOSTTY_REVISION}, found ${actual_revision}"
}

apply_ghostty_patch() {
  [[ -f "${LAYER_LIFETIME_PATCH}" ]] || \
    die "missing required patch: ${LAYER_LIFETIME_PATCH}"

  local patch_name
  patch_name="$(basename "${LAYER_LIFETIME_PATCH}")"
  if git -C "${GHOSTTY_SOURCE_DIR}" apply --reverse --check "${LAYER_LIFETIME_PATCH}" >/dev/null 2>&1; then
    log "patch already applied: ${patch_name}"
    return
  fi

  log "applying patch: ${patch_name}"
  git -C "${GHOSTTY_SOURCE_DIR}" apply --check "${LAYER_LIFETIME_PATCH}"
  git -C "${GHOSTTY_SOURCE_DIR}" apply "${LAYER_LIFETIME_PATCH}"
}

validate_ghostty_source() (
  umask 077

  scratch_dir="$(mktemp -d "${TMPDIR:-/tmp}/t3code-libghostty-source.XXXXXX")"
  trap 'rm -rf -- "${scratch_dir}"' EXIT

  export GIT_INDEX_FILE="${scratch_dir}/index"
  git -C "${GHOSTTY_SOURCE_DIR}" read-tree "${GHOSTTY_REVISION}"
  git -C "${GHOSTTY_SOURCE_DIR}" apply --cached "${LAYER_LIFETIME_PATCH}"

  local tracked_changes
  local untracked_files
  tracked_changes="$(git -C "${GHOSTTY_SOURCE_DIR}" diff --name-status)"
  untracked_files="$(git -C "${GHOSTTY_SOURCE_DIR}" ls-files --others --exclude-standard)"
  if [[ -n "${tracked_changes}" || -n "${untracked_files}" ]]; then
    [[ -z "${tracked_changes}" ]] || printf '%s\n' "${tracked_changes}" >&2
    [[ -z "${untracked_files}" ]] || printf '%s\n' "${untracked_files}" >&2
    die "Ghostty source contains changes beyond the required patch"
  fi
)

require_cmd git
require_cmd xcodebuild
require_cmd xcrun
require_cmd rsync
ensure_zig
ensure_ghostty_source
apply_ghostty_patch
validate_ghostty_source

ghostty_ref="$(git -C "${GHOSTTY_SOURCE_DIR}" rev-parse HEAD)"
log "using Ghostty source: ${GHOSTTY_SOURCE_DIR} @ ${ghostty_ref}"
log "using Zig: ${GHOSTTY_ZIG} ($("${GHOSTTY_ZIG}" version))"
log "building GhosttyKit.xcframework"

(
  cd "${GHOSTTY_SOURCE_DIR}"
  PATH="$(dirname "${GHOSTTY_ZIG}"):${PATH}" "${GHOSTTY_ZIG}" build -j1 \
    -Dapp-runtime=none \
    -Demit-xcframework=true \
    -Demit-macos-app=false \
    -Demit-exe=false \
    -Demit-docs=false \
    -Demit-webdata=false \
    -Demit-helpgen=false \
    -Demit-terminfo=false \
    -Demit-termcap=false \
    -Demit-themes=false \
    -Doptimize=ReleaseFast \
    -Dstrip \
    -Dxcframework-target=universal
)

xcframework="${GHOSTTY_SOURCE_DIR}/macos/GhosttyKit.xcframework"
ios_archive="${xcframework}/ios-arm64/libghostty-fat.a"
sim_archive="${xcframework}/ios-arm64-simulator/libghostty-fat.a"
[[ -f "${ios_archive}" ]] || die "missing built iOS archive: ${ios_archive}"
[[ -f "${sim_archive}" ]] || die "missing built iOS simulator archive: ${sim_archive}"

log "stripping iOS archives"
xcrun strip -S -x "${ios_archive}"
xcrun strip -S -x "${sim_archive}"

log "copying iOS archives into ${VENDOR_DIR}/GhosttyKit.xcframework"
cp "${ios_archive}" "${VENDOR_DIR}/GhosttyKit.xcframework/ios-arm64/libghostty-fat.a"
cp "${sim_archive}" "${VENDOR_DIR}/GhosttyKit.xcframework/ios-arm64-simulator/libghostty-fat.a"
rsync -a "${xcframework}/ios-arm64/Headers/" \
  "${VENDOR_DIR}/GhosttyKit.xcframework/ios-arm64/Headers/"
rsync -a "${xcframework}/ios-arm64-simulator/Headers/" \
  "${VENDOR_DIR}/GhosttyKit.xcframework/ios-arm64-simulator/Headers/"

log "done"
