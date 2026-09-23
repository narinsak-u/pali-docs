from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

import yaml

from .types import JsonValue, SourceDocument


class SourceError(ValueError):
    """Raised when a source cannot be safely loaded or normalized."""


@dataclass(frozen=True, slots=True)
class ParsedSource:
    metadata: Mapping[str, Any]
    text: str


_FRONTMATTER_MARKER = re.compile(r"^---[ \t]*(?:\n|$)")
_HEADING = re.compile(r"^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$")


def _normalise_whitespace(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n")]
    return "\n".join(lines).strip()


def parse_frontmatter(raw_text: str) -> ParsedSource:
    """Parse YAML frontmatter and return the unexecuted MDX body."""
    normalized = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    if not _FRONTMATTER_MARKER.match(normalized):
        return ParsedSource(metadata={}, text=_normalise_whitespace(normalized))

    opening = _FRONTMATTER_MARKER.match(normalized)
    if opening is None:
        return ParsedSource(metadata={}, text=_normalise_whitespace(normalized))
    frontmatter_start = opening.end()
    closing_match = re.search(
        r"^---[ \t]*$|^\.\.\.[ \t]*$", normalized[frontmatter_start:], re.MULTILINE
    )
    if closing_match is None:
        raise SourceError("malformed frontmatter: missing closing delimiter")
    closing_start = frontmatter_start + closing_match.start()
    closing_end = frontmatter_start + closing_match.end()
    block = normalized[frontmatter_start:closing_start]
    try:
        metadata = yaml.safe_load(block)
    except yaml.YAMLError as exc:
        raise SourceError(f"malformed frontmatter: {exc}") from exc
    if metadata is None:
        metadata = {}
    if not isinstance(metadata, Mapping):
        raise SourceError("frontmatter must be a YAML mapping")
    body = normalized[closing_end:]
    if body.startswith("\n"):
        body = body[1:]
    return ParsedSource(metadata=dict(metadata), text=_normalise_whitespace(body))


def _heading_title(text: str) -> str | None:
    for line in text.splitlines():
        match = _HEADING.match(line)
        if match:
            title = match.group(1).strip()
            if title:
                return title
    return None


def _metadata_text(metadata: Mapping[str, Any], key: str) -> str | None:
    value = metadata.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise SourceError(f"frontmatter {key} must be a string")
    value = value.strip()
    return value or None


def _source_id(path: Path, root: Path, prefix: str) -> str:
    try:
        relative = path.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise SourceError(f"source path is outside source root: {path}") from exc
    if relative.suffix.lower() != ".mdx":
        raise SourceError(f"source must have .mdx extension: {path}")
    return f"{prefix.rstrip('/')}/{relative.with_suffix('').as_posix()}"


def normalize_source(
    raw_text: str,
    *,
    source_id: str,
    source_version_chars: int = 12,
    acl_metadata: Mapping[str, JsonValue] | None = None,
) -> SourceDocument:
    parsed = parse_frontmatter(raw_text)
    title = _metadata_text(parsed.metadata, "title") or _heading_title(parsed.text)
    if not title:
        raise SourceError(f"source {source_id} has no non-empty title")
    text = _normalise_whitespace(parsed.text)
    if not text:
        raise SourceError(f"source {source_id} has empty content")
    content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    if source_version_chars < 1:
        raise SourceError("source_version_chars must be positive")
    description = _metadata_text(parsed.metadata, "description")
    return SourceDocument(
        source_id=source_id,
        source_version=content_hash[:source_version_chars],
        title=title,
        description=description,
        text=text,
        content_hash=content_hash,
        acl_metadata=dict(acl_metadata or {"visibility": "public"}),
    )


def load_source(
    path: str | Path,
    *,
    source_root: str | Path = "apps/web/content/docs",
    source_prefix: str = "content/docs",
    source_version_chars: int = 12,
    acl_metadata: Mapping[str, JsonValue] | None = None,
) -> SourceDocument:
    root = Path(source_root)
    source_path = Path(path)
    if not source_path.is_absolute():
        source_path = Path.cwd() / source_path
    source_path = source_path.resolve()
    if not source_path.is_file():
        raise SourceError(f"source file does not exist: {source_path}")
    try:
        raw_text = source_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise SourceError(f"unable to read source {source_path}: {exc}") from exc
    return normalize_source(
        raw_text,
        source_id=_source_id(source_path, root, source_prefix),
        source_version_chars=source_version_chars,
        acl_metadata=acl_metadata,
    )


def load_sources(
    source_root: str | Path = "apps/web/content/docs",
    *,
    source_prefix: str = "content/docs",
    source_version_chars: int = 12,
    acl_metadata: Mapping[str, JsonValue] | None = None,
) -> tuple[SourceDocument, ...]:
    root = Path(source_root)
    if not root.is_dir():
        raise SourceError(f"source root does not exist: {root}")
    paths = sorted((path for path in root.rglob("*.mdx") if path.is_file()), key=lambda p: p.as_posix())
    documents = tuple(
        load_source(
            path,
            source_root=root,
            source_prefix=source_prefix,
            source_version_chars=source_version_chars,
            acl_metadata=acl_metadata,
        )
        for path in paths
    )
    source_ids = [document.source_id for document in documents]
    if len(source_ids) != len(set(source_ids)):
        raise SourceError("duplicate source IDs")
    return documents
