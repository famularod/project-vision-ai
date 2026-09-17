#!/bin/sh
set -eu
# A separate, default-off one-shot program; never drain the legacy queue.
exec /usr/local/bin/python -I -B -c 'import sys; sys.path.insert(0, "/app"); from ecos_indexer.owner_worker_main import main; raise SystemExit(main())'
