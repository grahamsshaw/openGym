# Bridge runner: hears pull-button jobs, runs the import chain.
# Python (converters, Flask imports) + Node (autopush) in one image.
FROM python:3.12-slim

# Node for autopush.mjs (global fetch + modern syntax need 18+; distro
# packaging trails, so pin a recent major explicitly).
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && apt-get clean && rm -rf /var/lib/apt/lists \
 && node --version && python3 --version

# Only what the Flask import_data path imports (converters are stdlib-only).
RUN pip install --no-cache-dir httpx python-dotenv Flask Flask-SQLAlchemy

WORKDIR /runner
CMD ["python3", "/bridge/runner.py"]
