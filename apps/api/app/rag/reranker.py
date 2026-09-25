from __future__ import annotations

import re

from .types import GroundingPassage

_TERM = re.compile(r"\w+", re.UNICODE)


def _terms(value: str) -> set[str]:
    return set(_TERM.findall(value.casefold()))


def rerank_candidates(
    query: str,
    candidates: list[GroundingPassage],
    max_candidates: int,
) -> list[GroundingPassage]:
    bounded = candidates[:max_candidates]
    query_terms = _terms(query)
    ranked = []
    for index, passage in enumerate(bounded):
        overlap = len(query_terms & _terms(passage.text))
        ranked.append((passage, index, overlap))
    ranked.sort(key=lambda item: (-item[2], -item[0].score, item[1]))
    return [passage for passage, _, _ in ranked]
