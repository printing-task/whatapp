"""
Voice Processing & Transcription Pipeline (Hindi / Hinglish / English support).
Uses Groq Whisper (`whisper-large-v3-turbo`) with confidence/empty checks.
"""

import os
import logging
from typing import Any, Dict
import httpx

logger = logging.getLogger("voice_service")

GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions"


def transcribe_audio_with_groq(local_path: str, groq_api_key: str = "") -> Dict[str, Any]:
    """
    Transcribe a local WhatsApp audio/voice file via Groq Whisper.
    Returns `{ok, text, language, confidence, reason}`.
    """
    key = (groq_api_key or os.getenv("GROQ_API_KEY", "")).strip()
    if not key or key.startswith("gsk_your"):
        return {
            "ok": False,
            "text": "",
            "language": "",
            "confidence": 0.0,
            "reason": "GROQ_API_KEY not configured for voice transcription",
        }

    if not local_path or not os.path.exists(local_path):
        return {
            "ok": False,
            "text": "",
            "language": "",
            "confidence": 0.0,
            "reason": "Audio file missing on disk",
        }

    try:
        fname = os.path.basename(local_path)
        headers = {"Authorization": f"Bearer {key}"}
        data = {
            "model": "whisper-large-v3-turbo",
            "response_format": "verbose_json",
            "temperature": "0",
            "prompt": "Hindi, Hinglish, and English customer support conversation for Indian businesses.",
        }
        with open(local_path, "rb") as f:
            files = {"file": (fname, f, "application/octet-stream")}
            with httpx.Client(timeout=30.0) as client:
                res = client.post(GROQ_TRANSCRIPTION_URL, headers=headers, data=data, files=files)

        if res.status_code != 200:
            return {
                "ok": False,
                "text": "",
                "language": "",
                "confidence": 0.0,
                "reason": f"Groq Whisper HTTP {res.status_code}: {res.text[:160]}",
            }

        payload = res.json() if res.content else {}
        text = str(payload.get("text") or "").strip()
        language = str(payload.get("language") or "en")
        segments = payload.get("segments") or []

        # Estimate speech confidence from average no_speech_prob across segments
        avg_no_speech = 0.0
        if isinstance(segments, list) and segments:
            probs = [float(s.get("no_speech_prob", 0.0) or 0.0) for s in segments if isinstance(s, dict)]
            if probs:
                avg_no_speech = sum(probs) / len(probs)
        confidence = round(max(0.0, min(1.0, 1.0 - avg_no_speech)), 3)

        if not text or avg_no_speech > 0.78:
            return {
                "ok": False,
                "text": text,
                "language": language,
                "confidence": confidence,
                "reason": "Audio unclear or mostly background noise",
            }

        return {
            "ok": True,
            "text": text,
            "language": language,
            "confidence": confidence,
            "reason": "",
        }
    except Exception as e:
        logger.warning(f"[Voice] Transcription error: {e}")
        return {
            "ok": False,
            "text": "",
            "language": "",
            "confidence": 0.0,
            "reason": str(e),
        }
