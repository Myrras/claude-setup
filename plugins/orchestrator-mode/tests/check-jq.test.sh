#!/bin/sh
hook="$(cd "$(dirname "$0")" && pwd)/../hooks/check-jq.sh"
fail=0
sh_bin=$(command -v sh)

# PATH with only copies of the given tools, so jq is hidden.
nojq=$(mktemp -d); trap 'rm -rf "$nojq"' EXIT
for t in cat; do
  src=$(command -v $t); cp "$src" "$nojq/"
  [ -f "$(dirname "$src")/msys-2.0.dll" ] && cp "$(dirname "$src")/msys-2.0.dll" "$nojq/"
done

check() { # name, ok(0/1)
  if [ "$2" -eq 0 ]; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}

if command -v jq >/dev/null 2>&1; then
  out=$(sh "$hook"); [ -z "$out" ]; check "silent when jq present" $?
fi
out=$(PATH="$nojq" "$sh_bin" "$hook"); rc=$?
printf '%s' "$out" | grep -q '"systemMessage":".*jq is not installed' && [ $rc -eq 0 ]; check "warns when jq missing" $?

exit $fail
