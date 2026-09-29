from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

import pytest

from app.identity import IdentityValidationError, decode_principal_token


def _token(payload: dict[str, object], secret: str = "identity-secret") -> str:
    def encode(value: object) -> str:
        raw = json.dumps(value, separators=(",", ":"), sort_keys=True).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    body = f"v1.{encode(payload)}"
    signature = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
    return f"{body}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}"


def _claims(**overrides: object) -> dict[str, object]:
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": "pali-docs-bff",
        "aud": "pali-docs-api",
        "sub": "principal-1",
        "tenantId": "tenant-1",
        "roles": ["learner"],
        "permissions": ["rag:read"],
        "iat": now - 1,
        "exp": now + 60,
    }
    claims.update(overrides)
    return claims


def test_decode_principal_token_derives_typed_access_scope() -> None:
    principal = decode_principal_token(_token(_claims()), "identity-secret")

    assert principal.subject == "principal-1"
    assert principal.access_scope() == {
        "tenant": "tenant-1",
        "roles": ["learner"],
        "permissions": ["rag:read"],
    }


@pytest.mark.parametrize(
    "claims",
    [
        {"exp": int(time.time()) - 1},
        {"aud": "other-service"},
        {"tenantId": ""},
        {"roles": ["learner", 1]},
    ],
)
def test_decode_principal_token_rejects_invalid_claims(claims: dict[str, object]) -> None:
    with pytest.raises(IdentityValidationError):
        decode_principal_token(_token(_claims(**claims)), "identity-secret")


def test_decode_principal_token_rejects_forged_signature() -> None:
    with pytest.raises(IdentityValidationError):
        decode_principal_token(_token(_claims()) + "x", "identity-secret")
