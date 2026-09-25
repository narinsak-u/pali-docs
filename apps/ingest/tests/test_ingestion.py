from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from pathlib import Path

import pytest

from app.chunk import chunk_text
from app.config import IngestSettings
from app.manifest import ManifestError, ManifestStore, build_manifest
from app.pipeline import run_pipeline
from app.publisher import PineconePublisher, PublishError, PublishReport
from app.source import load_source, normalize_source, parse_frontmatter
from app.types import ChunkingPolicy


def _document(text: str, source_id: str = "content/docs/guide"):
    return normalize_source(
        f"---\ntitle: Guide\n---\n{text}", source_id=source_id
    )


def _manifest(document, *, status: str = "validated"):
    chunks = chunk_text(
        document.text,
        source_id=document.source_id,
        source_version=document.source_version,
        title=document.title,
    )
    return build_manifest(
        [document],
        chunks,
        embedding_model="embed-v1",
        embedding_input_type="passage",
        retrieval_policy_version="v1",
        created_at="2026-01-01T00:00:00Z",
        status=status,
    )


def test_source_frontmatter_and_identity(tmp_path: Path) -> None:
    parsed = parse_frontmatter("---\ntitle:  Guide\ndescription: Intro\n---\n# Ignored\n\nBody  \n")
    assert parsed.metadata == {"title": "Guide", "description": "Intro"}
    assert parsed.text == "# Ignored\n\nBody"

    path = tmp_path / "guide.mdx"
    path.write_text("---\ntitle: Guide\n---\nBody\n", encoding="utf-8")
    document = load_source(path, source_root=tmp_path, source_prefix="docs", source_version_chars=8)
    assert document.source_id == "docs/guide"
    assert document.title == "Guide"
    assert document.source_version == document.content_hash[:8]
    assert document.acl_metadata == {"visibility": "public"}


def test_chunk_overlap_and_ids_are_stable() -> None:
    policy = ChunkingPolicy(version="test-v1", max_characters=10, overlap_characters=3)
    kwargs = dict(source_id="docs/guide", source_version="abc123", title="Guide", policy=policy)
    first = chunk_text("abcdefghij klmnopqrst", **kwargs)
    second = chunk_text("abcdefghij klmnopqrst", **kwargs)
    assert len(first) == 3
    assert first[0].text[-3:] == first[1].text[:3]
    assert [chunk.id for chunk in first] == [chunk.id for chunk in second]
    assert [chunk.index for chunk in first] == [0, 1, 2]


def test_publisher_stages_metadata_and_rejects_dimension_mismatch() -> None:
    chunks = chunk_text("one", source_id="docs/guide", source_version="abc123", title="Guide", acl_metadata={"visibility": "private", "section": "intro"})
    seen: list[tuple[list[dict[str, object]], str]] = []

    def embed(texts: list[str]) -> dict[str, object]:
        return {"data": [{"values": [float(index), 1.0]} for index, _ in enumerate(texts)]}

    def upsert(records, namespace: str) -> dict[str, int]:
        seen.append((list(records), namespace))
        return {"upserted_count": len(records)}

    publisher = PineconePublisher(
        IngestSettings(embedding_batch_size=2),
        embed_fn=embed,
        upsert_fn=upsert,
        stats_fn=lambda namespace: {"namespaces": {namespace: {"vector_count": 1}}},
    )
    report = asyncio.run(publisher.publish(chunks, "rev-abc"))
    assert report.namespace == "staging-rev-abc"
    assert seen[0][1] == "staging-rev-abc"
    assert seen[0][0][0]["metadata"] == {
        "visibility": "private",
        "section": "intro",
        "text": "one",
        "source": "docs/guide",
        "title": "Guide",
        "corpusRevision": "rev-abc",
        "sourceId": "docs/guide",
        "sourceVersion": "abc123",
    }

    bad = PineconePublisher(
        IngestSettings(),
        embed_fn=lambda texts: {"data": [{"values": [1.0]}, {"values": [1.0, 2.0]}]},
        upsert_fn=upsert,
    )
    with pytest.raises(PublishError, match="dimensions"):
        asyncio.run(
            bad.publish(
                chunk_text(
                    "one\n\ntwo",
                    source_id="docs/guide",
                    source_version="abc123",
                    title="Guide",
                    policy=ChunkingPolicy(max_characters=3, overlap_characters=0),
                ),
                "rev-bad",
            )
        )


def test_manifest_immutable_promote_rollback_and_recovery(tmp_path: Path) -> None:
    store = ManifestStore(tmp_path)
    first = _manifest(_document("first"))
    second = _manifest(_document("second"))
    store.write_manifest(first)
    with pytest.raises(ManifestError, match="different contents"):
        store.write_manifest(replace(first, created_at="2026-01-02T00:00:00Z"))
    store.write_manifest(second)

    store.promote(first.revision, promoted_at="2026-01-01T00:00:00Z")
    store.promote(second.revision, promoted_at="2026-01-02T00:00:00Z")
    assert store.rollback().revision == first.revision
    assert store.active.revision == first.revision
    assert store.previous.revision == second.revision

    active = {"revision": second.revision, "namespace": f"staging-{second.revision}", "promotedAt": "2026-01-03T00:00:00Z"}
    previous = {"revision": first.revision, "namespace": f"staging-{first.revision}", "promotedAt": "2026-01-02T00:00:00Z"}
    (tmp_path / "pointer-transaction.json").write_text(json.dumps({"active": active, "previous": previous}), encoding="utf-8")
    assert store.read_pointer().revision == second.revision
    assert not (tmp_path / "pointer-transaction.json").exists()


def test_pipeline_rerun_is_idempotent(tmp_path: Path) -> None:
    source_root = tmp_path / "docs"
    source_root.mkdir()
    (source_root / "guide.mdx").write_text("---\ntitle: Guide\n---\nStable body\n", encoding="utf-8")
    settings = IngestSettings(source_root=source_root, state_dir=tmp_path / "state")

    class FakePublisher:
        def __init__(self) -> None:
            self.publishes = 0

        async def publish(self, chunks, revision: str) -> PublishReport:
            self.publishes += 1
            return PublishReport(revision, f"staging-{revision}", len(chunks), len(chunks), len(chunks))

        async def check_staging_integrity(self, revision: str, expected_count: int) -> int:
            return expected_count

    publisher = FakePublisher()
    first = asyncio.run(run_pipeline(settings, publisher=publisher))
    second = asyncio.run(run_pipeline(settings, publisher=publisher))
    assert first.revision == second.revision
    assert first.promotion_pointer.revision == second.promotion_pointer.revision
    assert publisher.publishes == 2
    assert len(list((tmp_path / "state" / "manifests").glob("*.json"))) == 1
