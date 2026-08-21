FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/opt/huggingface \
    MDD_HOST=0.0.0.0 \
    PORT=8080

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "torch>=2.2" \
    && pip install --no-cache-dir -r requirements.txt

COPY grader.py server.py ./

# Cache model artifacts in the immutable image so a scale-from-zero cold start
# does not depend on Hugging Face availability or download 1.3 GB at runtime.
RUN python -c "from grader import Grader; Grader()"

# Set AFTER the caching step above, not in the initial ENV block — that step
# needs real network access the first time to actually populate HF_HOME.
# Once cached, every subsequent Grader() load (i.e. every cold start) still
# defaults to a network round-trip to huggingface.co to check the cached
# files are current before falling back to them — real latency on a request
# path that already has the exact same weights sitting on local disk. These
# force local-cache-only loading, cutting that round-trip entirely.
ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

RUN useradd --create-home --uid 10001 mdd \
    && chown -R mdd:mdd /app /opt/huggingface
USER mdd

EXPOSE 8080
CMD ["python", "server.py"]
