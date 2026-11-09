#!/usr/bin/env python3
"""Cricket local English caption worker.

stdin/stdout: newline-delimited JSON {id, audio: base64(wav)} -> {id, text}.
The model runs on the same machine as Cricket's Node server. Neither raw audio
nor recognized words are written to disk or logged by this module.
"""
from __future__ import annotations

import base64
import io
import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "data" / "caption-models"
ALLOWED_MODELS = ("base.en", "tiny.en")
MODEL_NAME = os.environ.get("CRICKET_CAPTIONS_MODEL", "base.en").strip()
if MODEL_NAME not in ALLOWED_MODELS:
    print("Unsupported caption model (use base.en or tiny.en)", file=sys.stderr)
    sys.exit(2)

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

def initialize(warmup: bool):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("Install local captions first: .\\setup-captions.ps1", file=sys.stderr)
        sys.exit(2)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    marker = MODEL_DIR / (MODEL_NAME + ".ready")
    # Transcription never triggers a model download during a call.
    model = WhisperModel(
        MODEL_NAME,
        device="cpu",
        compute_type="int8",
        download_root=str(MODEL_DIR),
        local_files_only=not warmup,
        cpu_threads=min(8, max(1, (os.cpu_count() or 2) // 2)),
    )
    if warmup:
        marker.write_text("ready\n", encoding="ascii")
    return model

def main():
    warmup = "--warmup" in sys.argv[1:]
    model = initialize(warmup)
    if warmup:
        print("Cricket English caption model ready: " + MODEL_NAME)
        return
    print(json.dumps({"type": "ready", "model": MODEL_NAME}), flush=True)
    for line in sys.stdin:
        if len(line) > 650000:
            continue
        request = {}
        try:
            request = json.loads(line)
            request_id = request.get("id")
            audio = base64.b64decode(request["audio"], validate=True)
            if not isinstance(request_id, int) or len(audio) > 400000:
                raise ValueError("Invalid caption segment")
            segments, _ = model.transcribe(
                io.BytesIO(audio),
                language="en",
                task="transcribe",
                beam_size=1,
                temperature=0,
                condition_on_previous_text=False,
                vad_filter=False,
                no_speech_threshold=0.6,
            )
            # Evaluate the generator while its in-memory audio buffer is valid.
            caption = " ".join(segment.text.strip() for segment in segments).strip()
            answer = {"id": request_id, "text": caption[:2500]}
        except Exception:
            # Never send raw audio or exception details to an employee browser.
            answer = {"id": request.get("id") if isinstance(request, dict) else None,
                      "error": "Local transcription could not process this segment"}
        print(json.dumps(answer, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
