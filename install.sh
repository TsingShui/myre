#!/bin/sh
set -eu

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

case "$(uname -s):$(uname -m)" in
  Linux:x86_64|Linux:amd64) platform=linux-x64 ;;
  Linux:aarch64|Linux:arm64) platform=linux-arm64 ;;
  Darwin:arm64|Darwin:aarch64) platform=macos-arm64 ;;
  *) fail "Unsupported platform. Download a supported archive from https://github.com/TsingShui/myre/releases/latest." ;;
esac

case "$platform" in
  linux-*)
    if ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
      fail "The Linux binary requires glibc."
    fi
    ;;
esac

if command -v sha256sum >/dev/null 2>&1; then
  hash_file() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  fail "sha256sum or shasum is required."
fi

bin_dir=${MYRE_INSTALL_DIR:-"$HOME/.local/bin"}
case "$bin_dir" in /*) ;; *) fail "MYRE_INSTALL_DIR must be an absolute path." ;; esac
if command -v myre >/dev/null 2>&1; then
  fail "A myre command already exists on PATH; remove it before installing."
fi
if [ -e "$bin_dir/myre" ] || [ -L "$bin_dir/myre" ]; then
  fail "Refusing to overwrite $bin_dir/myre."
fi

mkdir -p "$bin_dir"
temporary=$(mktemp -d "$bin_dir/.myre-install.XXXXXXXX")
trap 'rm -rf "$temporary"' EXIT
trap 'exit 1' HUP INT TERM

release_url=$(curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --output /dev/null --write-out '%{url_effective}' https://github.com/TsingShui/myre/releases/latest)
case "$release_url" in
  https://github.com/TsingShui/myre/releases/tag/*) tag=${release_url##*/} ;;
  *) fail "Latest Release returned an unexpected URL." ;;
esac
case "$tag" in
  v[0-9]* ) ;;
  *) fail "Invalid Latest Release tag." ;;
esac
case "$tag" in *[!a-zA-Z0-9._-]*) fail "Invalid Latest Release tag." ;; esac

asset="myre-$tag-$platform.tar.gz"
base="https://github.com/TsingShui/myre/releases/download/$tag"
printf 'Downloading %s\n' "$asset"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --output "$temporary/$asset" "$base/$asset"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --output "$temporary/SHA256SUMS" "$base/SHA256SUMS"
expected=$(awk -v asset="$asset" '$2 == asset && length($1) == 64 && $1 ~ /^[0-9a-fA-F]+$/ { hash = tolower($1); count++ } END { if (count != 1) exit 1; print hash }' "$temporary/SHA256SUMS") || fail "Missing or ambiguous SHA-256 checksum."
actual=$(hash_file "$temporary/$asset")
[ "$actual" = "$expected" ] || fail "Release archive failed SHA-256 verification."

tar -xOzf "$temporary/$asset" myre > "$temporary/myre" || fail "Cannot extract the myre executable."
[ -s "$temporary/myre" ] || fail "The extracted executable is empty."
chmod 755 "$temporary/myre"
# Linking creates the destination only if it does not already exist.
ln "$temporary/myre" "$bin_dir/myre" || fail "Cannot install without overwriting $bin_dir/myre."
printf 'Installed myre %s to %s/myre\n' "$tag" "$bin_dir"
printf 'Ensure %s is on PATH.\n' "$bin_dir"
