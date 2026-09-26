from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping

from .types import Chunk, ChunkingPolicy, JsonValue, SourceDocument


class ChunkError(ValueError):
    """Raised when chunking would produce invalid output."""


_PARAGRAPH_BREAK = re.compile(r"\n[ \t]*\n+")
_SECTION_HEADING = re.compile(r"^#{1,6}[ \t]+(.+?)\s*$")


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


def _sections(text: str) -> list[tuple[int, str | None, str]]:
    sections: list[tuple[int, str | None, str]] = []
    title: str | None = None
    lines: list[str] = []

    def flush() -> None:
        body = "\n".join(lines).strip()
        if body:
            sections.append((len(sections), title, body))

    for line in text.splitlines():
        heading = _SECTION_HEADING.match(line.strip())
        if heading:
            flush()
            title = heading.group(1).strip()
            lines = []
        else:
            lines.append(line)
    flush()
    if not sections:
        return [(0, None, text.strip())]
    return sections

def _chunk_id(
    source_id: str,
    source_version: str,
    policy: ChunkingPolicy,
    index: int,
    text: str,
) -> str:
    serialized_policy = json.dumps(
        policy.to_dict(), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    payload = f"{source_id}\0{source_version}\0{serialized_policy}\0{index}\0{text}".encode(
        "utf-8"
    )
    return hashlib.sha256(payload).hexdigest()


def _parent_id(
    source_id: str,
    source_version: str,
    section_index: int,
    section: str | None,
) -> str:
    payload = f"{source_id}\0{source_version}\0{section_index}\0{section or ''}".encode(
        "utf-8"
    )
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
    """Create stable, section-aware child chunks with parent provenance."""
    selected_policy = policy or ChunkingPolicy()
    if not text.strip():
        raise ChunkError("cannot chunk empty text")
    if not source_id.strip() or not source_version.strip() or not title.strip():
        raise ChunkError("source identity and title must be non-empty")

    acl = dict(acl_metadata or {"visibility": "public"})
    acl_section = acl.get("section")
    fallback_section = acl_section.strip() if isinstance(acl_section, str) else None
    chunks: list[Chunk] = []

    for section_index, heading, section_body in _sections(text):
        section = heading or fallback_section or "document"
        parent_id = _parent_id(source_id, source_version, section_index, section)
        pieces: list[str] = []
        for paragraph in _paragraphs(section_body):
            pieces.extend(_split_long_paragraph(paragraph, selected_policy))

        current: list[str] = []
        current_length = 0
        for piece in pieces:
            separator_length = 2 if current else 0
            if current and current_length + separator_length + len(piece) > selected_policy.max_characters:
                chunk_text_value = "\n\n".join(current)
                chunks.append(
                    Chunk(
                        id=_chunk_id(
                            source_id,
                            source_version,
                            selected_policy,
                            len(chunks),
                            chunk_text_value,
                        ),
                        parent_id=parent_id,
                        source_id=source_id,
                        source_version=source_version,
                        index=len(chunks),
                        text=chunk_text_value,
                        title=title,
                        section=section,
                        parent_text=section_body,
                        acl_metadata=acl,
                        chunking_policy=selected_policy,
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
                    id=_chunk_id(
                        source_id,
                        source_version,
                        selected_policy,
                        len(chunks),
                        chunk_text_value,
                    ),
                    parent_id=parent_id,
                    source_id=source_id,
                    source_version=source_version,
                    index=len(chunks),
                    text=chunk_text_value,
                    title=title,
                    section=section,
                    parent_text=section_body,
                    acl_metadata=acl,
                    chunking_policy=selected_policy,
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
