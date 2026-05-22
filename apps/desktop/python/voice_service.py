"""
Xuanshen Voice TTS Service.

Engines:
  - edge_tts: Microsoft Edge online TTS, zero download, many voices
  - qwen_tts: Qwen3-TTS local model (0.6B/1.7B), voice clone + custom voice
"""
import os
import sys
import signal
import argparse
import logging
import asyncio
import threading
import time
import tempfile
from typing import Optional

import uvicorn
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice_service")

app = FastAPI(title="Xuanshen Voice Service")

# ============ Configuration ============
VOICE_DATA_DIR = os.environ.get("VOICE_DATA_DIR", os.path.expanduser("~/.xuanshen/voices"))
os.makedirs(VOICE_DATA_DIR, exist_ok=True)

# ============ Parent Process Watchdog ============
_parent_pid: Optional[int] = None


def _watchdog_thread():
    """Monitor parent process. Exit if parent dies."""
    while True:
        time.sleep(3)
        if _parent_pid and _parent_pid > 1:
            try:
                os.kill(_parent_pid, 0)
            except OSError:
                logger.info("Parent process %d gone, shutting down", _parent_pid)
                os._exit(0)


# ============ Engine State ============
qwen_model = None
qwen_model_id = None
qwen_loading = False
current_engine_id = "edge_tts"


# ============ Edge-TTS ============
EDGE_TTS_VOICES = [
    {"id": "zh-CN-XiaoxiaoNeural", "name": "晓晓 (女声-温柔)", "lang": "zh"},
    {"id": "zh-CN-YunxiNeural", "name": "云希 (男声-阳光)", "lang": "zh"},
    {"id": "zh-CN-YunjianNeural", "name": "云健 (男声-沉稳)", "lang": "zh"},
    {"id": "zh-CN-XiaoyiNeural", "name": "晓依 (女声-活泼)", "lang": "zh"},
    {"id": "zh-CN-YunyangNeural", "name": "云扬 (男声-新闻)", "lang": "zh"},
    {"id": "zh-TW-HsiaoChenNeural", "name": "曉臻 (女声-台湾)", "lang": "zh"},
    {"id": "en-US-JennyNeural", "name": "Jenny (Female-EN)", "lang": "en"},
    {"id": "en-US-GuyNeural", "name": "Guy (Male-EN)", "lang": "en"},
    {"id": "ja-JP-NanamiNeural", "name": "七海 (女声-日语)", "lang": "ja"},
]


async def edge_tts_speak(text: str, voice: str = "zh-CN-XiaoxiaoNeural") -> str:
    import edge_tts
    output_path = os.path.join(tempfile.gettempdir(), f"xs_edge_{os.getpid()}_{int(time.time())}.mp3")
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_path)
    return output_path


# ============ Qwen3-TTS ============
# Supported models:
#   - Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice  (preset voices, small)
#   - Qwen/Qwen3-TTS-12Hz-0.6B-Base          (voice clone, small)
#   - Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice  (preset voices, large)
#   - Qwen/Qwen3-TTS-12Hz-1.7B-Base          (voice clone, large)

QWEN_MODELS = {
    "qwen_tts_0.6b": {
        "custom_voice": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
        "base": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
        "name": "Qwen3-TTS 0.6B (本地)",
        "size_hint": "~1.2GB",
        "description": "Qwen3-TTS 0.6B 本地语音合成+克隆，支持中英日韩等10语言",
    },
    "qwen_tts_1.7b": {
        "custom_voice": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
        "base": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        "name": "Qwen3-TTS 1.7B (本地-高质量)",
        "size_hint": "~3.5GB",
        "description": "Qwen3-TTS 1.7B 高质量语音合成+克隆+语音设计，效果更好",
    },
}

# Qwen3-TTS preset speakers
QWEN_SPEAKERS = [
    {"id": "Vivian", "name": "Vivian (女声-明亮)", "lang": "zh"},
    {"id": "Serena", "name": "Serena (女声-温暖)", "lang": "zh"},
    {"id": "Uncle_Fu", "name": "Uncle Fu (男声-沉稳)", "lang": "zh"},
    {"id": "Dylan", "name": "Dylan (男声-北京)", "lang": "zh"},
    {"id": "Eric", "name": "Eric (男声-四川)", "lang": "zh"},
    {"id": "Ryan", "name": "Ryan (Male-EN)", "lang": "en"},
    {"id": "Aiden", "name": "Aiden (Male-EN)", "lang": "en"},
    {"id": "Ono_Anna", "name": "Ono Anna (女声-日语)", "lang": "ja"},
    {"id": "Sohee", "name": "Sohee (女声-韩语)", "lang": "ko"},
]


def is_qwen_tts_installed() -> bool:
    try:
        import qwen_tts  # noqa: F401
        return True
    except ImportError:
        return False


def _get_torch_device():
    """Get best available device for the platform."""
    import torch
    if torch.cuda.is_available():
        return "cuda:0"
    # MPS has a 65536 output channel limit which Qwen TTS can exceed during generation.
    # Fall back to CPU to avoid the error.
    return "cpu"


def load_qwen_model(model_key: str, mode: str = "custom_voice"):
    """
    Load a Qwen3-TTS model.
    model_key: 'qwen_tts_0.6b' or 'qwen_tts_1.7b'
    mode: 'custom_voice' or 'base' (for voice clone)
    """
    global qwen_model, qwen_model_id, qwen_loading

    target_id = QWEN_MODELS[model_key][mode]
    if qwen_model is not None and qwen_model_id == target_id:
        return qwen_model

    if qwen_loading:
        raise RuntimeError("模型正在加载中，请稍等")

    qwen_loading = True
    try:
        import torch
        from qwen_tts import Qwen3TTSModel

        device = _get_torch_device()
        dtype = torch.bfloat16 if device != "cpu" else torch.float32
        logger.info(f"Loading Qwen3-TTS model: {target_id} on {device} ({dtype})")

        qwen_model = Qwen3TTSModel.from_pretrained(
            target_id,
            device_map=device,
            dtype=dtype,
        )
        qwen_model_id = target_id
        logger.info(f"Qwen3-TTS model loaded: {target_id}")
        return qwen_model
    except Exception as e:
        logger.error(f"Failed to load Qwen3-TTS: {e}")
        raise
    finally:
        qwen_loading = False


def qwen_custom_voice_speak(text: str, speaker: str, model_key: str, language: str = "Chinese") -> str:
    """Generate speech with Qwen3-TTS CustomVoice model (preset speakers)."""
    import soundfile as sf
    model = load_qwen_model(model_key, "custom_voice")
    output_path = os.path.join(tempfile.gettempdir(), f"xs_qwen_{os.getpid()}_{int(time.time())}.wav")

    wavs, sr = model.generate_custom_voice(
        text=text,
        language=language,
        speaker=speaker,
    )
    sf.write(output_path, wavs[0], sr)
    return output_path


def qwen_voice_clone_speak(text: str, ref_audio: str, ref_text: str, model_key: str, language: str = "Chinese") -> str:
    """Generate speech with Qwen3-TTS Base model (voice clone)."""
    import soundfile as sf
    model = load_qwen_model(model_key, "base")
    output_path = os.path.join(tempfile.gettempdir(), f"xs_qwen_clone_{os.getpid()}_{int(time.time())}.wav")

    kwargs = dict(
        text=text,
        language=language,
        ref_audio=ref_audio,
    )
    # ref_text is required for ICL mode; if not provided, use x_vector_only mode
    if ref_text and ref_text.strip():
        kwargs["ref_text"] = ref_text
    else:
        kwargs["x_vector_only_mode"] = True

    wavs, sr = model.generate_voice_clone(**kwargs)
    sf.write(output_path, wavs[0], sr)
    return output_path


# ============ Pydantic Models ============
class SpeakRequest(BaseModel):
    text: str
    engine: Optional[str] = None
    voice_id: Optional[str] = None
    language: str = "Chinese"


class ModelInfo(BaseModel):
    id: str
    name: str
    installed: bool
    downloaded: bool
    size_hint: str
    description: str


# ============ Routes ============
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "current_engine": current_engine_id,
        "qwen_loaded": qwen_model is not None,
        "qwen_model_id": qwen_model_id,
    }


def is_qwen_model_cached(model_key: str) -> bool:
    """Check if model weights are already cached locally."""
    try:
        from huggingface_hub import scan_cache_dir
        cache_info = scan_cache_dir()
        model_name = QWEN_MODELS[model_key]["custom_voice"]  # e.g. Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice
        repo_name = model_name.split("/")[-1]
        for repo in cache_info.repos:
            if repo_name in repo.repo_id:
                return True
        return False
    except Exception:
        return False


@app.get("/models")
async def list_models():
    installed = is_qwen_tts_installed()
    models = [
        ModelInfo(
            id="edge_tts",
            name="Edge TTS (在线)",
            installed=True,
            downloaded=True,
            size_hint="0MB",
            description="微软在线语音合成，无需下载，多种中/英/日声线",
        ),
    ]
    for key, info in QWEN_MODELS.items():
        downloaded = is_qwen_model_cached(key) if installed else False
        models.append(ModelInfo(
            id=key,
            name=info["name"],
            installed=installed,
            downloaded=downloaded,
            size_hint=info["size_hint"],
            description=info["description"],
        ))
    return {"models": [m.dict() for m in models]}


@app.post("/models/{model_id}/download")
async def download_model(model_id: str):
    """Download/prepare a model. For Qwen-TTS this triggers model download on first load."""
    if model_id == "edge_tts":
        return {"status": "already_downloaded"}
    elif model_id in QWEN_MODELS:
        if not is_qwen_tts_installed():
            raise HTTPException(
                status_code=400,
                detail="qwen-tts 未安装。请在终端运行: pip install qwen-tts torch soundfile"
            )
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, load_qwen_model, model_id, "custom_voice")
            return {"status": "downloaded"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    else:
        raise HTTPException(status_code=404, detail="Unknown model")


@app.post("/models/{model_id}/select")
async def select_model(model_id: str):
    global current_engine_id
    valid = ["edge_tts"] + list(QWEN_MODELS.keys())
    if model_id not in valid:
        raise HTTPException(status_code=404, detail="Unknown model")
    current_engine_id = model_id
    return {"status": "ok", "current_engine": current_engine_id}


@app.get("/voices")
async def list_voices():
    voices = []

    # Edge TTS preset voices
    for v in EDGE_TTS_VOICES:
        voices.append({
            "id": v["id"],
            "name": v["name"],
            "type": "edge_tts",
            "lang": v["lang"],
        })

    # Qwen3-TTS preset speakers
    for s in QWEN_SPEAKERS:
        voices.append({
            "id": f"qwen:{s['id']}",
            "name": s["name"],
            "type": "qwen_tts",
            "lang": s["lang"],
        })

    # Custom voice profiles (reference audio for voice cloning)
    if os.path.isdir(VOICE_DATA_DIR):
        for f in sorted(os.listdir(VOICE_DATA_DIR)):
            if f.endswith((".wav", ".mp3", ".flac", ".ogg")):
                voices.append({
                    "id": f"custom:{f}",
                    "name": f"🎙 {os.path.splitext(f)[0]}",
                    "type": "custom",
                    "lang": "any",
                })

    return {"voices": voices}


@app.post("/voices/upload")
async def upload_voice(file: UploadFile = File(...)):
    """Upload a voice reference sample for Qwen3-TTS cloning."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename")

    safe_name = "".join(c for c in file.filename if c.isalnum() or c in "._- ")
    if not safe_name:
        safe_name = "voice_sample.wav"

    dest = os.path.join(VOICE_DATA_DIR, safe_name)
    base, ext = os.path.splitext(safe_name)
    counter = 1
    while os.path.exists(dest):
        dest = os.path.join(VOICE_DATA_DIR, f"{base}_{counter}{ext}")
        counter += 1

    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 50MB)")

    with open(dest, "wb") as out:
        out.write(content)

    final_name = os.path.basename(dest)
    return {"id": f"custom:{final_name}", "name": os.path.splitext(final_name)[0], "path": dest}


@app.delete("/voices/{voice_id:path}")
async def delete_voice(voice_id: str):
    if not voice_id.startswith("custom:"):
        raise HTTPException(status_code=400, detail="Can only delete custom voices")
    filename = voice_id.replace("custom:", "", 1)
    path = os.path.join(VOICE_DATA_DIR, filename)
    if os.path.isfile(path):
        os.remove(path)
        return {"status": "deleted"}
    raise HTTPException(status_code=404, detail="Voice not found")


@app.post("/speak")
async def speak(request: SpeakRequest):
    """Generate speech. Returns audio file."""
    engine = request.engine or current_engine_id
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    output_path = None

    try:
        if engine == "edge_tts":
            voice = request.voice_id or "zh-CN-XiaoxiaoNeural"
            if voice.startswith("custom:") or voice.startswith("qwen:"):
                voice = "zh-CN-XiaoxiaoNeural"
            output_path = await edge_tts_speak(text, voice)

        elif engine in QWEN_MODELS:
            if not is_qwen_tts_installed():
                raise HTTPException(status_code=400, detail="qwen-tts 未安装")

            voice_id = request.voice_id or ""
            loop = asyncio.get_event_loop()

            if voice_id.startswith("custom:"):
                # Voice clone mode
                filename = voice_id.replace("custom:", "", 1)
                ref_path = os.path.join(VOICE_DATA_DIR, filename)
                if not os.path.isfile(ref_path):
                    raise HTTPException(status_code=404, detail="参考音频不存在")
                output_path = await loop.run_in_executor(
                    None, qwen_voice_clone_speak, text, ref_path, "", engine, request.language
                )
            else:
                # Custom voice (preset speaker) mode
                speaker = "Vivian"  # default
                if voice_id.startswith("qwen:"):
                    speaker = voice_id.replace("qwen:", "", 1)
                output_path = await loop.run_in_executor(
                    None, qwen_custom_voice_speak, text, speaker, engine, request.language
                )

        else:
            raise HTTPException(status_code=400, detail=f"Unknown engine: {engine}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TTS generation failed ({engine}): {e}")
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")

    if not output_path or not os.path.isfile(output_path):
        raise HTTPException(status_code=500, detail="生成文件失败")

    media_type = "audio/mpeg" if output_path.endswith(".mp3") else "audio/wav"
    return FileResponse(output_path, media_type=media_type, filename=os.path.basename(output_path))


# ============ Entrypoint ============
def main():
    parser = argparse.ArgumentParser(description="Xuanshen Voice Service")
    parser.add_argument("--port", type=int, default=17599)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--parent-pid", type=int, default=None)
    args = parser.parse_args()

    global _parent_pid
    _parent_pid = args.parent_pid
    if _parent_pid:
        t = threading.Thread(target=_watchdog_thread, daemon=True)
        t.start()
        logger.info(f"Watchdog monitoring parent PID {_parent_pid}")

    if sys.platform != "win32":
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    logger.info(f"Starting voice service on {args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
