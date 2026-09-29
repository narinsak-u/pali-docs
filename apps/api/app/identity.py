from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Mapping

TOKEN_VERSION = "v1"
ISSUER = "pali-docs-bff"
AUDIENCE = "pali-docs-api"
MAX_TOKEN_LIFETIME_SECONDS = 300
_CLOCK_SKEW_SECONDS = 30
_MAX_STRING_LENGTH = 200
_MAX_LIST_LENGTH = 20


class IdentityValidationError(ValueError):
    """Raised when an internal Principal token cannot authorize a request."""


@dataclass(frozen=True, slots=True)
class AccessScope:
    tenant: str
    roles: tuple[str, ...] = ()
    permissions: tuple[str, ...] = ()
    document_ids: tuple[str, ...] = ()
    visibility: str | None = None

    def as_dict(self) -> dict[str, object]:
        scope: dict[str, object] = {"tenant": self.tenant}
        if self.roles:
            scope["roles"] = list(self.roles)
        if self.permissions:
            scope["permissions"] = list(self.permissions)
        if self.document_ids:
            scope["documentIds"] = list(self.document_ids)
        if self.visibility is not None:
            scope["visibility"] = self.visibility
        return scope


@dataclass(frozen=True, slots=True)
class Principal:
    subject: str
    access: AccessScope
    issued_at: int
    expires_at: int

    def access_scope(self) -> dict[str, object]:
        return self.access.as_dict()


def _decode_segment(value: str) -> object:
    try:
        padding = "=" * (-len(value) % 4)
        return json.loads(base64.urlsafe_b64decode(value + padding))
    except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise IdentityValidationError("invalid Principal token encoding") from error


def _required_string(claims: Mapping[str, object], key: str) -> str:
    value = claims.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > _MAX_STRING_LENGTH:
        raise IdentityValidationError("invalid Principal claims")
    return value.strip()


def _string_list(claims: Mapping[str, object], key: str) -> tuple[str, ...]:
    value = claims.get(key, [])
    if not isinstance(value, list) or len(value) > _MAX_LIST_LENGTH:
        raise IdentityValidationError("invalid Principal claims")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip() or len(item) > _MAX_STRING_LENGTH:
            raise IdentityValidationError("invalid Principal claims")
        result.append(item.strip())
    return tuple(result)


def decode_principal_token(
    token: str,
    secret: str,
    *,
    now: int | float | None = None,
) -> Principal:
    if not isinstance(token, str) or not token.strip() or not isinstance(secret, str) or not secret.strip():
        raise IdentityValidationError("Principal token and secret are required")
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != TOKEN_VERSION:
        raise IdentityValidationError("invalid Principal token")
    try:
        signing_input = f"{parts[0]}.{parts[1]}".encode("ascii")
        supplied_signature = base64.urlsafe_b64decode(
            parts[2] + "=" * (-len(parts[2]) % 4)
        )
    except (UnicodeEncodeError, ValueError, TypeError) as error:
        raise IdentityValidationError("invalid Principal token signature") from error
    expected_signature = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(supplied_signature, expected_signature):
        raise IdentityValidationError("invalid Principal token signature")

    payload = _decode_segment(parts[1])
    if not isinstance(payload, dict):
        raise IdentityValidationError("Principal token payload must be an object")
    claims: Mapping[str, object] = payload
    if claims.get("iss") != ISSUER or claims.get("aud") != AUDIENCE:
        raise IdentityValidationError("invalid Principal token issuer or audience")

    issued_at = claims.get("iat")
    expires_at = claims.get("exp")
    if (
        isinstance(issued_at, bool)
        or not isinstance(issued_at, (int, float))
        or isinstance(expires_at, bool)
        or not isinstance(expires_at, (int, float))
    ):
        raise IdentityValidationError("invalid Principal token timestamps")
    issued_at_int = int(issued_at)
    expires_at_int = int(expires_at)
    current_time = int(time.time() if now is None else now)
    if (
        issued_at_int > current_time + _CLOCK_SKEW_SECONDS
        or expires_at_int <= current_time
        or expires_at_int <= issued_at_int
        or expires_at_int - issued_at_int > MAX_TOKEN_LIFETIME_SECONDS
    ):
        raise IdentityValidationError("expired or invalid Principal token timestamps")

    visibility = claims.get("visibility")
    if visibility is not None and (
        not isinstance(visibility, str)
        or not visibility.strip()
        or len(visibility) > _MAX_STRING_LENGTH
    ):
        raise IdentityValidationError("invalid Principal claims")
    access = AccessScope(
        tenant=_required_string(claims, "tenantId"),
        roles=_string_list(claims, "roles"),
        permissions=_string_list(claims, "permissions"),
        document_ids=_string_list(claims, "documentIds"),
        visibility=visibility.strip() if isinstance(visibility, str) else None,
    )
    return Principal(
        subject=_required_string(claims, "sub"),
        access=access,
        issued_at=issued_at_int,
        expires_at=expires_at_int,
    )
