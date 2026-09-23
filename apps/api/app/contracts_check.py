"""Check that the framework-neutral contracts required by the API exist."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "packages" / "contracts"

REQUIRED_EVENT_FIELDS = {
    "schemaVersion",
    "runId",
    "eventId",
    "sequence",
    "eventType",
    "timestamp",
    "payload",
}


def _fail(message: str) -> None:
    raise SystemExit(f"contracts check failed: {message}")


def _load_openapi(path: Path) -> dict[str, Any]:
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
        _fail(f"cannot parse {path}: {exc}")
    if not isinstance(value, dict):
        _fail(f"{path} must contain a YAML object")
    return value


def _load_event_schema(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        _fail(f"cannot parse {path}: {exc}")
    if not isinstance(value, dict):
        _fail(f"{path} must contain a JSON object")
    return value


def _check_event_schema(schema: dict[str, Any], path: Path) -> None:
    if schema.get("type") != "object":
        _fail(f"{path} must declare an object schema")

    required = schema.get("required")
    if (
        not isinstance(required, list)
        or any(not isinstance(field, str) for field in required)
        or not REQUIRED_EVENT_FIELDS.issubset(required)
    ):
        _fail(f"{path} is missing required event fields")

    properties = schema.get("properties")
    if not isinstance(properties, dict):
        _fail(f"{path} must declare event properties")

    schema_version = properties.get("schemaVersion")
    if (
        not isinstance(schema_version, dict)
        or schema_version.get("type") != "string"
        or schema_version.get("pattern") != r"^v[0-9]+$"
    ):
        _fail(f"{path}.schemaVersion must be a versioned string")

    for field in ("runId", "eventId", "eventType"):
        property_schema = properties.get(field)
        if (
            not isinstance(property_schema, dict)
            or property_schema.get("type") != "string"
            or type(property_schema.get("minLength")) is not int
            or property_schema["minLength"] < 1
        ):
            _fail(f"{path}.{field} must be a non-empty string")

    sequence = properties.get("sequence")
    if (
        not isinstance(sequence, dict)
        or sequence.get("type") != "integer"
        or type(sequence.get("minimum")) is not int
        or sequence["minimum"] != 0
    ):
        _fail(f"{path}.sequence must be a non-negative integer")

    timestamp = properties.get("timestamp")
    if (
        not isinstance(timestamp, dict)
        or timestamp.get("type") != "string"
        or timestamp.get("format") != "date-time"
    ):
        _fail(f"{path}.timestamp must be a date-time string")

    payload = properties.get("payload")
    if not isinstance(payload, dict) or payload.get("type") != "object":
        _fail(f"{path}.payload must be an object")


def main() -> None:
    openapi_path = CONTRACTS_DIR / "openapi.yaml"
    event_path = CONTRACTS_DIR / "events.schema.json"

    for path in (openapi_path, event_path):
        if not path.is_file():
            _fail(f"missing contract file: {path}")

    openapi = _load_openapi(openapi_path)
    if openapi.get("openapi") != "3.1.0":
        _fail(f"{openapi_path} must declare OpenAPI 3.1.0")

    info = openapi.get("info")
    if (
        not isinstance(info, dict)
        or not isinstance(info.get("title"), str)
        or not isinstance(info.get("version"), str)
    ):
        _fail(f"{openapi_path} must declare info.title and info.version")

    paths = openapi.get("paths")
    if not isinstance(paths, dict):
        _fail(f"{openapi_path} must declare a paths object")
    healthz = paths.get("/healthz")
    get_healthz = healthz.get("get") if isinstance(healthz, dict) else None
    if not isinstance(get_healthz, dict):
        _fail(f"{openapi_path} must define GET /healthz")

    responses = get_healthz.get("responses")
    response_200 = responses.get("200") if isinstance(responses, dict) else None
    if not isinstance(response_200, dict):
        _fail(f"{openapi_path} GET /healthz must define a 200 response")

    content = response_200.get("content")
    json_content = content.get("application/json") if isinstance(content, dict) else None
    response_schema = json_content.get("schema") if isinstance(json_content, dict) else None
    if (
        not isinstance(response_schema, dict)
        or response_schema.get("$ref") != "#/components/schemas/HealthResponse"
    ):
        _fail(f"{openapi_path} GET /healthz must reference HealthResponse JSON")

    components = openapi.get("components")
    schemas = components.get("schemas") if isinstance(components, dict) else None
    health_schema = schemas.get("HealthResponse") if isinstance(schemas, dict) else None
    if not isinstance(health_schema, dict) or health_schema.get("type") != "object":
        _fail(f"{openapi_path} must define HealthResponse as an object")
    health_required = health_schema.get("required")
    health_properties = health_schema.get("properties")
    if (
        not isinstance(health_required, list)
        or any(not isinstance(field, str) for field in health_required)
        or not {"status", "service"}.issubset(health_required)
        or not isinstance(health_properties, dict)
    ):
        _fail(f"{openapi_path} HealthResponse must require status and service")
    status_schema = health_properties.get("status")
    service_schema = health_properties.get("service")
    if (
        not isinstance(status_schema, dict)
        or status_schema.get("const") != "ok"
        or not isinstance(service_schema, dict)
        or service_schema.get("const") != "api"
    ):
        _fail(f"{openapi_path} HealthResponse must use status=ok and service=api")

    _check_event_schema(_load_event_schema(event_path), event_path)
    print(f"contracts check passed: {openapi_path} and {event_path}")


if __name__ == "__main__":
    main()
