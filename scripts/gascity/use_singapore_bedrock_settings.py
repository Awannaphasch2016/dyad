#!/usr/bin/env python3
"""Point saved Bedrock settings at the Singapore global inference profile.

Deletes providerSettings.bedrock.apiKey without printing it. Rewrites
selectedModel.name only when it is still the US Sonnet 4.5 profile.
"""

import json
import sys
from pathlib import Path

US_SONNET = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
GLOBAL_SONNET = "global.anthropic.claude-sonnet-4-5-20250929-v1:0"


def main() -> int:
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        sys.stderr.write(
            "usage: use_singapore_bedrock_settings.py USER_SETTINGS_JSON [--select-bedrock]\n"
        )
        return 2
    path = Path(args[0])
    select_bedrock = "--select-bedrock" in args[1:]
    if not path.exists():
        if not select_bedrock:
            sys.stderr.write("settings file is missing\n")
            return 2
        data = {}
    else:
        data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        sys.stderr.write("user settings must be a JSON object\n")
        return 2
    if select_bedrock:
        model = data.get("selectedModel")
        provider = model.get("provider") if isinstance(model, dict) else None
        if provider in (None, "auto"):
            data["selectedModel"] = {"provider": "bedrock", "name": GLOBAL_SONNET}
    model = data.get("selectedModel")
    if (
        isinstance(model, dict)
        and model.get("provider") == "bedrock"
        and model.get("name") == US_SONNET
    ):
        model["name"] = GLOBAL_SONNET
    providers = data.get("providerSettings")
    if isinstance(providers, dict):
        bedrock = providers.get("bedrock")
        if isinstance(bedrock, dict) and "apiKey" in bedrock:
            del bedrock["apiKey"]
            if not bedrock:
                del providers["bedrock"]
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print("bedrock settings updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
