from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping

from .types import Chunk, ChunkingPolicy, JsonValue, SourceDocument


class ChunkError(ValueError):
    """Raised when chunking would produce invalid output."""


_PARAGRAPH_BREAK = re.compile(r"\n[ \t]*\n+")


def _split_long_paragraph(paragraph: str, policy: ChunkingPolicy) -> list[str]:
    if len(paragraph) <= policy.max_characters:
        return [paragraph]
    chunks: list[str] = []
    start = 0
    while start < len(paragraph):
        end = min(start + policy.max_characters, len(paragraph))
        piece = paragraph[start:end]
        if piece.strip():
            chunks.append(piece)
        if end >= len(paragraph):
            break
        next_start = end - policy.overlap_characters
        if next_start <= start:
            raise ChunkError("chunk overlap does not make progress")
        start = next_start
    return chunks


def _paragraphs(text: str) -> list[str]:
    return [part.strip() for part in _PARAGRAPH_BREAK.split(text) if part.strip()]


def _chunk_id(source_id: str, index: int, text: str) -> str:
    payload = f"{source_id}\0{index}\0{text}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def chunk_text(
    text: str,
    *,
    source_id: str,
    source_version: str,
    title: str,
    policy: ChunkingPolicy | None = None,
    acl_metadata: Mapping[str, JsonValue] | None = None,
) -> tuple[Chunk, ...]:
    """Create stable, paragraph-aware chunks without interpreting Markdown/MDX."""
    selected_policy = policy or ChunkingPolicy()
    if not text.strip():
        raise ChunkError("cannot chunk empty text")
    if not source_id.strip() or not source_version.strip() or not title.strip():
        raise ChunkError("source identity and title must be non-empty")

    paragraphs = _paragraphs(text)
    pieces: list[str] = []
    for paragraph in paragraphs:
        pieces.extend(_split_long_paragraph(paragraph, selected_policy))

    chunks: list[Chunk] = []
    current: list[str] = []
    current_length = 0
    for piece in pieces:
        separator_length = 2 if current else 0
        if current and current_length + separator_length + len(piece) > selected_policy.max_characters:
            chunk_text_value = "\n\n".join(current)
            chunks.append(
                Chunk(
                    id=_chunk_id(source_id, len(chunks), chunk_text_value),
                    source_id=source_id,
                    source_version=source_version,
                    index=len(chunks),
                    text=chunk_text_value,
                    title=title,
                    acl_metadata=dict(acl_metadata or {"visibility": "public"}),
                )
            )
            current = []
            current_length = 0
        current.append(piece)
        current_length += (2 if len(current) > 1 else 0) + len(piece)

    if current:
        chunk_text_value = "\n\n".join(current)
        chunks.append(
            Chunk(
                id=_chunk_id(source_id, len(chunks), chunk_text_value),
                source_id=source_id,
                source_version=source_version,
                index=len(chunks),
                text=chunk_text_value,
                title=title,
                acl_metadata=dict(acl_metadata or {"visibility": "public"}),
            )
        )
    if not chunks:
        raise ChunkError("chunking produced no chunks")
    return tuple(chunks)


def chunk_document(
    document: SourceDocument, policy: ChunkingPolicy | None = None
) -> tuple[Chunk, ...]:
    return chunk_text(
        document.text,
        source_id=document.source_id,
        source_version=document.source_version,
        title=document.title,
        policy=policy,
        acl_metadata=document.acl_metadata,
    )
