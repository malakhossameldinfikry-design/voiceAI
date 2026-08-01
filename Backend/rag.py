import fitz  # pymupdf
import numpy as np
from openai import OpenAI
import os
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key="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")

# Simple in-memory store: {doc_id: [(chunk_text, embedding_vector), ...]}
# Fine for MVP / single-user testing. Swap for pgvector/Chroma later for production.
STORE = {}


def extract_text_from_pdf(file_path: str) -> str:
    doc = fitz.open(file_path)
    text = ""
    for page in doc:
        text += page.get_text()
    doc.close()
    return text


def extract_text_from_image(file_path: str) -> str:
    """Uses GPT-4o vision to describe/read the image (handles photos of documents too)."""
    import base64
    with open(file_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": "Describe this image in detail and transcribe any visible text exactly, in its original language (Arabic or English)."},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
            ]
        }]
    )
    return response.choices[0].message.content


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 100):
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start = end - overlap
    return [c for c in chunks if c.strip()]


def embed_texts(texts: list[str]):
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=texts
    )
    return [item.embedding for item in response.data]


def add_document(doc_id: str, file_path: str, file_type: str):
    if file_type == "pdf":
        text = extract_text_from_pdf(file_path)
    elif file_type == "image":
        text = extract_text_from_image(file_path)
    else:
        raise ValueError("Unsupported file type")

    chunks = chunk_text(text)
    embeddings = embed_texts(chunks)
    STORE[doc_id] = list(zip(chunks, embeddings))
    return len(chunks)


def search(query: str, top_k: int = 3) -> str:
    """Search across ALL uploaded documents, return the most relevant chunks joined as context."""
    if not STORE:
        return ""

    query_embedding = np.array(embed_texts([query])[0])

    all_chunks = []
    for doc_id, chunks in STORE.items():
        for text, emb in chunks:
            emb = np.array(emb)
            similarity = np.dot(query_embedding, emb) / (
                np.linalg.norm(query_embedding) * np.linalg.norm(emb)
            )
            all_chunks.append((similarity, text))

    all_chunks.sort(key=lambda x: x[0], reverse=True)
    top_chunks = [text for _, text in all_chunks[:top_k]]
    return "\n\n---\n\n".join(top_chunks)