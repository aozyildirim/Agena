#!/usr/bin/env python3
import json
from pathlib import Path

from api.main import app


def main() -> None:
    output = Path("docs/openapi.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    schema = app.openapi()
    output.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OpenAPI exported to: {output}")


if __name__ == "__main__":
    main()

