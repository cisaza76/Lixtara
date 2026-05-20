#!/usr/bin/env bash
# Validates supabase/migrations naming so the date-only / duplicate-version drift
# that forced a manual baseline rebuild (2026-05-20) can't recur. Each file must be
# <14-digit-timestamp>_<name>.sql with a UNIQUE version. Read-only — never touches
# the database. Run in CI and locally before committing a new migration.
set -euo pipefail

dir="supabase/migrations"
fail=0

shopt -s nullglob
files=("$dir"/*.sql)

if [ ${#files[@]} -eq 0 ]; then
  echo "No migrations in $dir (nothing to validate)."
  exit 0
fi

for f in "${files[@]}"; do
  base=$(basename "$f")
  if [[ ! "$base" =~ ^[0-9]{14}_[A-Za-z0-9_]+\.sql$ ]]; then
    echo "✗ invalid name (expected <14-digit-timestamp>_name.sql): $base"
    fail=1
  fi
done

# Versions (first 14 chars) must be unique — db push relies on it.
dups=$(for f in "${files[@]}"; do basename "$f" | cut -c1-14; done | sort | uniq -d)
if [ -n "$dups" ]; then
  echo "✗ duplicate migration version(s):"
  echo "$dups" | sed 's/^/    /'
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "Migration validation FAILED."
  exit 1
fi

echo "✓ ${#files[@]} migration(s) valid (14-digit timestamps, unique versions)."
