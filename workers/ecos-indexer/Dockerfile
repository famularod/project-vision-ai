FROM clamav/clamav:1.5.4@sha256:0af8760cd96f9ab67d07977af36e155431581a9fe9f0ec8b256c9f855fda183e AS clamav-definitions

FROM python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN printf '%s\n' \
      'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20260731T000000Z bookworm main' \
      'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20260731T000000Z bookworm-updates main' \
      'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/20260731T000000Z bookworm-security main' \
      > /etc/apt/sources.list \
    && rm -f /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates=20230311+deb12u1 \
      clamav=1.4.3+dfsg-1~deb12u2 \
      clamav-freshclam=1.4.3+dfsg-1~deb12u2 \
      tesseract-ocr=5.3.0-2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --require-hashes --only-binary=:all: --requirement requirements.txt

COPY --from=clamav-definitions /var/lib/clamav/main.cvd /var/lib/clamav/main.cvd
COPY --from=clamav-definitions /var/lib/clamav/daily.cvd /var/lib/clamav/daily.cvd
COPY --from=clamav-definitions /var/lib/clamav/bytecode.cvd /var/lib/clamav/bytecode.cvd
COPY clamav-databases.sha256 /usr/local/share/ecos/clamav-databases.sha256
RUN cd /var/lib/clamav \
    && sha256sum --check --strict /usr/local/share/ecos/clamav-databases.sha256 \
    && chmod 0444 /var/lib/clamav/*.cvd /usr/local/share/ecos/clamav-databases.sha256 \
    && chmod 0555 /var/lib/clamav /usr/local/share/ecos

COPY ecos_indexer ./ecos_indexer
COPY entrypoint.sh /usr/local/bin/ecos-entrypoint

RUN useradd --create-home --uid 10001 ecos \
    && chmod 0555 /usr/local/bin/ecos-entrypoint
USER ecos

CMD ["/usr/local/bin/ecos-entrypoint"]
