import os

from .worker import HostedIndexerWorker


if __name__ == "__main__":
    worker = HostedIndexerWorker()
    if os.getenv("ECOS_WORKER_RUN_MODE", "batch").strip().lower() == "continuous":
        worker.run_forever()
    else:
        worker.run_batch()
