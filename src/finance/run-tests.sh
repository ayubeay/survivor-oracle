#!/bin/bash
# All finance suites. A test that is never run protects nothing - two assertions sat
# failing for a day after the review promotion because nobody ran them together.
cd "$(dirname "$0")/../.."
fail=0
for f in mandate execution-authorization capability-firewall policy robinhood-auth; do
  out=$(node "src/finance/$f.test.js" 2>&1 | tail -1)
  printf '%-28s %s\n' "$f" "$out"
  echo "$out" | grep -q "0 failed" || fail=1
done
[ $fail -eq 0 ] && echo "ALL GREEN" || echo "SUITES FAILING"
exit $fail
