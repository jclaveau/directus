#!/usr/bin/env bash
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)

node --experimental-specifier-resolution=node "$SCRIPT_DIR/cli.js" "$@" 
