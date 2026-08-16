#!/bin/sh
set -eu

clamav_database_directory=/var/lib/clamav
clamav_database_checksums=/usr/local/share/ecos/clamav-databases.sha256

if [ ! -r "$clamav_database_checksums" ]; then
  echo "ClamAV checksum lock is unavailable." >&2
  exit 1
fi

# Definitions are reviewed and SHA-256-bound at image build time. Recheck them
# without network access, and keep worker/provider credentials out of the
# verification subprocess.
if ! (
  cd "$clamav_database_directory"
  /usr/bin/env -i PATH=/usr/bin:/bin LANG=C \
    /usr/bin/sha256sum --check --strict --status "$clamav_database_checksums"
); then
  echo "ClamAV definition integrity verification failed." >&2
  exit 1
fi

exec /usr/local/bin/python -m ecos_indexer
