#!/usr/bin/env python3
"""Validate emitted sing-box 1.14+ configs against `sing-box schema` output."""
from __future__ import annotations
import json, pathlib, sys
from jsonschema import Draft202012Validator

if len(sys.argv) != 3:
    print('usage: official_schema.py <schema.json> <config-dir>', file=sys.stderr)
    raise SystemExit(2)
schema_path = pathlib.Path(sys.argv[1])
config_dir = pathlib.Path(sys.argv[2])
schema = json.loads(schema_path.read_text(encoding='utf-8'))
validator = Draft202012Validator(schema)
files = sorted(config_dir.rglob('*.json'))
if not files:
    print('no config files found', file=sys.stderr)
    raise SystemExit(2)
failed = 0
for file in files:
    data = json.loads(file.read_text(encoding='utf-8'))
    errors = sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path))
    if not errors:
        print('  ok  ', file)
        continue
    failed += 1
    print('  FAIL', file)
    for err in errors[:8]:
        loc = '.'.join(map(str, err.absolute_path)) or '<root>'
        print('       ', loc + ':', err.message)
    if len(errors) > 8:
        print('        …', len(errors), 'errors total')
print(('OFFICIAL SCHEMA ALL PASS' if not failed else f'OFFICIAL SCHEMA FAILURES: {failed}') + f'  ({len(files)-failed}/{len(files)})')
raise SystemExit(1 if failed else 0)
