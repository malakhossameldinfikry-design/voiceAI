from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
import shutil
import uuid
import base64
import asyncio
from dotenv import load_dotenv
from groq import Groq
import edge_tts
import rag

load_dotenv()
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Groq(api_key="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")
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

import re

VOICE_MAP = {
    ("female", "en"): "en-US-AvaNeural",
    ("male", "en"): "en-US-GuyNeural",
    ("female", "ar"): "ar-EG-SalmaNeural",
    ("male", "ar"): "ar-EG-ShakirNeural",
}

def detect_language(text: str) -> str:
    return "ar" if re.search(r'[\u0600-\u06FF]', text) else "en"

async def synthesize_speech(text: str, gender: str) -> str:
    lang = detect_language(text)
    voice = VOICE_MAP.get((gender, lang), "en-US-AvaNeural")
    print(f"[TTS] Starting synthesis: voice={voice}, text len={len(text)}")
    try:
        communicate = edge_tts.Communicate(text, voice=voice)
        audio_bytes = b""

        async def collect():
            nonlocal audio_bytes
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_bytes += chunk["data"]

        await asyncio.wait_for(collect(), timeout=15)
        print(f"[TTS] Done, got {len(audio_bytes)} bytes")
        return base64.b64encode(audio_bytes).decode("utf-8")
    except asyncio.TimeoutError:
        print("[TTS] TIMED OUT after 15s")
        raise
    except Exception as e:
        print(f"[TTS] FAILED: {repr(e)}")
        raise


@app.get("/")
def read_root():
    return {"status": "ok"}


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    ext = file.filename.split(".")[-1].lower()
    if ext == "pdf":
        file_type = "pdf"
    elif ext in ["jpg", "jpeg", "png", "webp"]:
        file_type = "image"
    else:
        raise HTTPException(status_code=400, detail="Only PDF and image files supported right now")

    doc_id = str(uuid.uuid4())
    save_path = os.path.join(UPLOAD_DIR, f"{doc_id}.{ext}")

    with open(save_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    num_chunks = rag.add_document(doc_id, save_path, file_type)
    return {"doc_id": doc_id, "chunks_indexed": num_chunks}


@app.post("/context")
def get_context(query: str):
    context = rag.search(query)
    return {"context": context}


def build_system_prompt(agent_name: str) -> str:
    return (
        f"Your name is {agent_name}. You are a warm, natural, conversational voice "
        f"assistant. If asked your name, say it's {agent_name}. Always respond to "
        "whatever the user says, even casual remarks or small talk, never wait for a "
        "formal question. Detect whether the user is speaking Arabic or English and "
        "always reply in that same language. Keep replies conversational and fairly "
        "brief, as if speaking out loud. If document context is provided below, use "
        "it to answer accurately; otherwise just have a natural conversation."
    )


@app.post("/voice")
async def voice_turn(
    audio: UploadFile = File(...),
    agent_name: str = Form("Lyra"),
    gender: str = Form("female"),
):
    ext = audio.filename.split(".")[-1] if audio.filename and "." in audio.filename else "webm"
    temp_path = os.path.join(UPLOAD_DIR, f"voice_{uuid.uuid4()}.{ext}")

    try:
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(audio.file, f)

        with open(temp_path, "rb") as f:
            transcript = client.audio.transcriptions.create(
                model="whisper-large-v3",
                file=(audio.filename, f.read()),
            )
        user_text = transcript.text

        context = rag.search(user_text)
        user_content = f"Document context:\n{context}\n\nUser said: {user_text}" if context else user_text

        chat_resp = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": build_system_prompt(agent_name)},
                {"role": "user", "content": user_content},
            ],
        )
        reply_text = chat_resp.choices[0].message.content

        audio_b64 = await synthesize_speech(reply_text, gender)

        return JSONResponse({
            "transcript": user_text,
            "reply_text": reply_text,
            "audio_base64": audio_b64,
        })
    except Exception as e:
        print("ERROR:", repr(e))
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/greeting")
async def get_greeting(agent_name: str = Form(...), gender: str = Form("female")):
    try:
        greeting_text = f"Hey, I'm {agent_name}. How can I help you today?"
        audio_b64 = await synthesize_speech(greeting_text, gender)
        return JSONResponse({"text": greeting_text, "audio_base64": audio_b64})
    except Exception as e:
        print("ERROR:", repr(e))
        raise HTTPException(status_code=500, detail=str(e))