FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr ca-certificates clamav clamav-freshclam \
    && (freshclam --stdout || (sleep 30 && freshclam --stdout)) \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --requirement requirements.txt
COPY ecos_indexer ./ecos_indexer

RUN useradd --create-home --uid 10001 ecos
USER ecos

CMD ["python", "-m", "ecos_indexer"]
