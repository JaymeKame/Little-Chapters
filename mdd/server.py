"""Decoding-grader HTTP service.

    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python server.py            # listens on 127.0.0.1:8010

First run downloads the ~1.3 GB phoneme model from HuggingFace. CPU inference
takes ~1-2 s per clip. The Next.js app talks to this via
/api/reading/decode (env MDD_SERVER_URL, default http://127.0.0.1:8010) —
protect hosted inference with MDD_API_KEY; browsers should never call it
directly.

    POST /assess?text=<reference text>   body: WAV bytes (any rate, 16-bit)
    -> {recognized, words: [{word, per, score, expected, heard}], sentence_score}
    GET /healthz -> {ok, model}
"""
import os
import secrets

import uvicorn
from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from grader import MODEL_ID, Grader

MAX_BODY_BYTES = 32 * 1024 * 1024
MAX_TEXT_CHARS = 600  # alignment is O(text·audio) pure Python

app = FastAPI()
grader = None
API_KEY = os.environ.get('MDD_API_KEY', '')


@app.on_event('startup')
def load():
    global grader
    grader = Grader()


@app.get('/healthz')
def healthz():
    return {'ok': grader is not None, 'model': MODEL_ID}


@app.post('/assess')
async def assess(request: Request):
    if API_KEY:
        authorization = request.headers.get('authorization', '')
        scheme, _, supplied = authorization.partition(' ')
        if scheme.lower() != 'bearer' or not secrets.compare_digest(supplied, API_KEY):
            return JSONResponse({'error': 'UNAUTHORIZED'}, status_code=401)
    # query_params is already percent-decoded — do NOT unquote again.
    text = (request.query_params.get('text') or '').strip()
    if not text:
        return JSONResponse({'error': 'MISSING_TEXT', 'hint': 'pass ?text=<reference text>'}, status_code=400)
    if len(text) > MAX_TEXT_CHARS:
        return JSONResponse({'error': 'TEXT_TOO_LONG', 'hint': f'max {MAX_TEXT_CHARS} characters'}, status_code=400)
    wav = await request.body()
    if len(wav) < 100:
        return JSONResponse({'error': 'MISSING_AUDIO', 'hint': 'POST WAV bytes as the request body'}, status_code=400)
    if len(wav) > MAX_BODY_BYTES:
        return JSONResponse({'error': 'AUDIO_TOO_LARGE'}, status_code=413)
    try:
        # Threadpool keeps the event loop (and /healthz) responsive during the
        # 1–2 s CPU-bound inference; eval-mode no_grad forwards are safe.
        return await run_in_threadpool(grader.assess, wav, text)
    except KeyError as e:
        return JSONResponse(
            {'error': 'UNKNOWN_WORD', 'word': str(e).strip("'"),
             'hint': 'not in CMUdict — add it to MANUAL_PRONS or MDD_EXTRA_PRONS'},
            status_code=422,
        )
    except Exception as e:  # malformed WAV etc.
        return JSONResponse({'error': 'ASSESS_FAILED', 'hint': str(e)}, status_code=400)


if __name__ == '__main__':
    uvicorn.run(
        app,
        host=os.environ.get('MDD_HOST', '127.0.0.1'),
        port=int(os.environ.get('PORT', os.environ.get('MDD_PORT', '8010'))),
    )
