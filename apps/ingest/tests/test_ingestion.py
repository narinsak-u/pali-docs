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


def test_chunks_publish_deterministic_hierarchy_metadata() -> None:
    chunks = chunk_text(
        "# Grammar\n\nFirst paragraph.\n\nSecond paragraph.\n\n# Examples\n\nA related example.",
        source_id="docs/guide",
        source_version="abc123",
        title="Guide",
        policy=ChunkingPolicy(version="hierarchical-v1", max_characters=30, overlap_characters=0),
    )

    grammar_chunks = [chunk for chunk in chunks if chunk.section == "Grammar"]
    example_chunks = [chunk for chunk in chunks if chunk.section == "Examples"]

    assert grammar_chunks[0].parent_text == "First paragraph.\n\nSecond paragraph."
    assert example_chunks[0].parent_text == "A related example."
    assert len({chunk.parent_id for chunk in grammar_chunks}) == 1
    assert len({chunk.parent_id for chunk in example_chunks}) == 1
    assert grammar_chunks[0].parent_id != example_chunks[0].parent_id
    assert [chunk.id for chunk in chunks] == [
        chunk.id
        for chunk in chunk_text(
            "# Grammar\n\nFirst paragraph.\n\nSecond paragraph.\n\n# Examples\n\nA related example.",
            source_id="docs/guide",
            source_version="abc123",
            title="Guide",
            policy=ChunkingPolicy(
                version="hierarchical-v1", max_characters=30, overlap_characters=0
            ),
        )
    ]


def test_chunk_ids_include_source_version_and_chunking_policy() -> None:
    text = "# Grammar\n\nA passage."
    base = chunk_text(
        text,
        source_id="docs/guide",
        source_version="version-a",
        title="Guide",
        policy=ChunkingPolicy(version="policy-a"),
    )

    assert base[0].id != chunk_text(
        text,
        source_id="docs/guide",
        source_version="version-b",
        title="Guide",
        policy=ChunkingPolicy(version="policy-a"),
    )[0].id
    assert base[0].id != chunk_text(
        text,
        source_id="docs/guide",
        source_version="version-a",
        title="Guide",
        policy=ChunkingPolicy(version="policy-b"),
    )[0].id
def test_chunk_identity_includes_complete_policy_and_position_metadata() -> None:
    text = "# Grammar\n\nA passage that is long enough to split."
    base = chunk_text(
        text,
        source_id="docs/guide",
        source_version="version-a",
        title="Guide",
        policy=ChunkingPolicy(version="policy-a", max_characters=20, overlap_characters=2),
    )

    assert base[0].id != chunk_text(
        text,
        source_id="docs/guide",
        source_version="version-a",
        title="Guide",
        policy=ChunkingPolicy(version="policy-a", max_characters=21, overlap_characters=2),
    )[0].id
    assert base[0].id != chunk_text(
        text,
        source_id="docs/guide",
        source_version="version-a",
        title="Guide",
        policy=ChunkingPolicy(version="policy-a", max_characters=20, overlap_characters=3),
    )[0].id
    assert [chunk.index for chunk in base] == list(range(len(base)))
    assert all(chunk.chunking_policy.to_dict() == {
        "version": "policy-a",
        "maxCharacters": 20,
        "overlapCharacters": 2,
    } for chunk in base)


def test_manifest_rejects_incomplete_chunk_hierarchy_metadata() -> None:
    document = _document("# Intro\n\nA passage.")
    chunks = chunk_text(document.text, source_id=document.source_id, source_version=document.source_version, title=document.title)
    with pytest.raises(ManifestError, match="section"):
        build_manifest(
            [document],
            [replace(chunks[0], section=None)],
            embedding_model="embed-v1",
            embedding_input_type="passage",
            retrieval_policy_version="v1",
        )


def test_manifest_revision_includes_complete_chunking_policy() -> None:
    document = _document("A passage.")
    first = chunk_text(
        document.text,
        source_id=document.source_id,
        source_version=document.source_version,
        title=document.title,
        policy=ChunkingPolicy(version="policy-a", max_characters=100, overlap_characters=2),
    )
    second = chunk_text(
        document.text,
        source_id=document.source_id,
        source_version=document.source_version,
        title=document.title,
        policy=ChunkingPolicy(version="policy-a", max_characters=101, overlap_characters=2),
    )
    first_manifest = build_manifest(
        [document], first, chunking_policy=ChunkingPolicy(version="policy-a", max_characters=100, overlap_characters=2),
        embedding_model="embed-v1", embedding_input_type="passage", retrieval_policy_version="v1",
    )
    second_manifest = build_manifest(
        [document], second, chunking_policy=ChunkingPolicy(version="policy-a", max_characters=101, overlap_characters=2),
        embedding_model="embed-v1", embedding_input_type="passage", retrieval_policy_version="v1",
    )
    assert first_manifest.revision != second_manifest.revision



def test_publisher_includes_hierarchy_metadata() -> None:
    chunks = chunk_text(
        "# Intro\n\nA passage.",
        source_id="docs/guide",
        source_version="abc123",
        title="Guide",
    )
    seen: list[dict[str, object]] = []

    publisher = PineconePublisher(
        IngestSettings(),
        embed_fn=lambda _texts: {"data": [{"values": [1.0, 2.0]}]},
        upsert_fn=lambda records, _namespace: (
            seen.extend(record["metadata"] for record in records) or {"upserted_count": len(records)}
        ),
        stats_fn=lambda _namespace: {"namespaces": {"staging-rev-abc": {"vector_count": 1}}},
    )

    asyncio.run(publisher.publish(chunks, "rev-abc"))

    assert seen[0]["parentId"] == chunks[0].parent_id
    assert seen[0]["section"] == "Intro"
    assert seen[0]["parentText"] == chunks[0].parent_text


def test_publisher_bounds_parent_context_before_upsert() -> None:
    chunks = chunk_text(
        "# Intro\n\n" + ("long parent context " * 300),
        source_id="docs/guide",
        source_version="abc123",
        title="Guide",
    )
    seen: list[dict[str, object]] = []
    publisher = PineconePublisher(
        IngestSettings(max_parent_context_chars=120),
        embed_fn=lambda _texts: {"data": [{"values": [1.0, 2.0]} for _ in _texts]},
        upsert_fn=lambda records, _namespace: (
            seen.extend(record["metadata"] for record in records)
            or {"upserted_count": len(records)}
        ),
        stats_fn=lambda _namespace: {"namespaces": {"staging-rev-abc": {"vector_count": len(seen)}}},
    )

    asyncio.run(publisher.publish(chunks, "rev-abc"))

    assert len(seen[0]["parentText"]) == 120
    assert str(seen[0]["parentText"]).startswith("long parent context")

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
        "parentId": chunks[0].parent_id,
        "parentText": chunks[0].parent_text,
        "position": 0.0,
        "embeddingModel": "llama-text-embed-v2",
        "embeddingInputType": "passage",
        "chunkingPolicy": '{"maxCharacters":1600,"overlapCharacters":200,"version":"hierarchical-v1"}',
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


def test_publisher_rejects_incomplete_metadata_before_embedding() -> None:
    document = _document("one")
    chunks = chunk_text(
        document.text,
        source_id=document.source_id,
        source_version=document.source_version,
        title=document.title,
    )
    calls = 0

    def embed(_texts: list[str]) -> dict[str, object]:
        nonlocal calls
        calls += 1
        return {"data": [{"values": [1.0]}]}

    publisher = PineconePublisher(
        IngestSettings(),
        embed_fn=embed,
        upsert_fn=lambda records, _namespace: {"upserted_count": len(records)},
    )
    with pytest.raises(PublishError, match="section"):
        asyncio.run(publisher.publish([replace(chunks[0], section=None)], "rev-abc"))
    assert calls == 0
def test_publisher_rejects_missing_parent_text_before_embedding() -> None:
    document = _document("one")
    chunk = chunk_text(
        document.text,
        source_id=document.source_id,
        source_version=document.source_version,
        title=document.title,
    )[0]
    calls = 0

    def embed(_texts: list[str]) -> dict[str, object]:
        nonlocal calls
        calls += 1
        return {"data": [{"values": [1.0]}]}

    publisher = PineconePublisher(
        IngestSettings(),
        embed_fn=embed,
        upsert_fn=lambda records, _namespace: {"upserted_count": len(records)},
    )
    with pytest.raises(PublishError, match="parent_text"):
        asyncio.run(publisher.publish([replace(chunk, parent_text=None)], "rev-abc"))
    assert calls == 0


def test_publisher_rejects_forged_child_identity_before_embedding() -> None:
    document = _document("one")
    chunk = chunk_text(
        document.text,
        source_id=document.source_id,
        source_version=document.source_version,
        title=document.title,
    )[0]
    calls = 0

    def embed(_texts: list[str]) -> dict[str, object]:
        nonlocal calls
        calls += 1
        return {"data": [{"values": [1.0]}]}

    publisher = PineconePublisher(
        IngestSettings(),
        embed_fn=embed,
        upsert_fn=lambda records, _namespace: {"upserted_count": len(records)},
    )
    with pytest.raises(PublishError, match="identity"):
        asyncio.run(publisher.publish([replace(chunk, id="forged-child-id")], "rev-abc"))
    assert calls == 0


def test_publisher_rejects_forged_parent_identity_before_external_calls() -> None:
    document = _document("# Intro\n\none")
    chunk = chunk_text(
        document.text,
        source_id=document.source_id,
        source_version=document.source_version,
        title=document.title,
    )[0]
    calls: list[str] = []

    publisher = PineconePublisher(
        IngestSettings(),
        embed_fn=lambda _texts: calls.append("embed") or {"data": [{"values": [1.0]}]},
        upsert_fn=lambda _records, _namespace: calls.append("upsert")
        or {"upserted_count": 1},
    )
    with pytest.raises(PublishError, match="parent identity"):
        asyncio.run(
            publisher.publish([replace(chunk, parent_id="forged-parent-id")], "rev-abc")
        )
    assert calls == []



def test_manifest_rejects_sources_without_chunks() -> None:
    first = _document("first", source_id="content/docs/first")
    second = _document("second", source_id="content/docs/second")
    chunks = chunk_text(
        first.text,
        source_id=first.source_id,
        source_version=first.source_version,
        title=first.title,
    )
    with pytest.raises(ManifestError, match="source IDs"):
        build_manifest(
            [first, second],
            chunks,
            embedding_model="embed-v1",
            embedding_input_type="passage",
            retrieval_policy_version="v1",
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
