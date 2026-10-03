#!/usr/bin/env python3
"""Write EC2_SSH_KEY to a mode-600 file for ssh. Does not print the key."""

import os
import stat
import sys


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write("usage: write_ssh_key.py OUTPUT\n")
        return 2
    value = os.environ.get("EC2_SSH_KEY", "")
    if not value.strip():
        sys.stderr.write(
            "EC2_SSH_KEY is empty. Doppler's GitHub sync must provide it.\n"
        )
        return 1
    if "\n" not in value and "\\n" in value:
        value = value.replace("\\n", "\n")
    if not value.endswith("\n"):
        value += "\n"
    with open(sys.argv[1], "w", encoding="utf-8") as handle:
        handle.write(value)
    os.chmod(sys.argv[1], stat.S_IRUSR | stat.S_IWUSR)
    return 0


if __name__ == "__main__":
    sys.exit(main())
