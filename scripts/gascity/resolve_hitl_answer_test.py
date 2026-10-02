#!/usr/bin/env python3
"""Worker tests for resolve_hitl_answer.py. No Postgres and no Gas City."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import resolve_hitl_answer as worker

FAKE_HITL = """
import json
import os
import sys

with open(os.environ["FAKE_HITL_LOG"], "a", encoding="utf-8") as handle:
    handle.write(json.dumps({
        "argv": sys.argv[1:],
        "rig": os.environ.get("RIG"),
    }) + "\\n")
if os.environ.get("FAKE_HITL_FAIL") == sys.argv[1]:
    raise SystemExit(1)
"""


class Store:
    def __init__(self, rows):
        self.rows = rows

    def execute(self, sql, params=None):
        text = " ".join(sql.split())
        if text.startswith("select"):
            pending = [
                row
                for row in self.rows
                if row["gate_resolved_at"] is None
                and row["run_id"]
                and row["step_id"]
                and row["answered_by_name"]
            ]
            pending.sort(key=lambda row: row["created_at"])
            return Result([
                (
                    row["id"],
                    row["run_id"],
                    row["step_id"],
                    row["answered_by_name"],
                    row["gate_resolved_at"],
                )
                for row in pending
            ])
        if text.startswith("update"):
            answer_id = params[0]
            for row in self.rows:
                if row["id"] == answer_id and row["gate_resolved_at"] is None:
                    row["gate_resolved_at"] = "stamped"
            return Result([])
        raise AssertionError(text)


class Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


def pending_row():
    return {
        "id": "ans-1",
        "run_id": "run-1",
        "step_id": "plan-approve",
        "answered_by_name": "Project Manager",
        "gate_resolved_at": None,
        "created_at": "2026-10-02T00:00:00Z",
    }


class ResolveHitlAnswerTest(unittest.TestCase):
    def setUp(self):
        self._env = {
            key: os.environ.get(key)
            for key in ("RIG", "FAKE_HITL_LOG", "FAKE_HITL_FAIL", "HITL_PY")
        }
        os.environ.pop("RIG", None)
        os.environ.pop("FAKE_HITL_FAIL", None)

    def tearDown(self):
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_fake_hitl_records_respond_then_release_and_stamps_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "hitl.py"
            log = Path(tmp) / "log"
            script.write_text(FAKE_HITL, encoding="utf-8")
            os.environ["FAKE_HITL_LOG"] = str(log)
            store = Store([pending_row()])
            stamped = worker.close_pending(
                store, run=worker.run_hitl, script=str(script)
            )
            self.assertEqual(stamped, ["ans-1"])
            self.assertEqual(store.rows[0]["gate_resolved_at"], "stamped")
            records = [
                json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(
                [record["argv"] for record in records],
                [
                    [
                        "respond",
                        "--as",
                        "Project Manager",
                        "--step",
                        "plan-approve",
                        "--run",
                        "run-1",
                    ],
                    ["release", "--run", "run-1"],
                ],
            )
            self.assertEqual(
                {record["rig"] for record in records}, {"multi tenant HITL"}
            )
            again = worker.close_pending(
                store, run=worker.run_hitl, script=str(script)
            )
            self.assertEqual(again, [])
            self.assertEqual(len(log.read_text(encoding="utf-8").splitlines()), 2)

    def test_failing_respond_does_not_release_or_stamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "hitl.py"
            log = Path(tmp) / "log"
            script.write_text(FAKE_HITL, encoding="utf-8")
            os.environ["FAKE_HITL_LOG"] = str(log)
            os.environ["FAKE_HITL_FAIL"] = "respond"
            store = Store([pending_row()])
            stamped = worker.close_pending(
                store, run=worker.run_hitl, script=str(script)
            )
            self.assertEqual(stamped, [])
            self.assertIsNone(store.rows[0]["gate_resolved_at"])
            records = [
                json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual([record["argv"][0] for record in records], ["respond"])

    def test_stamped_row_produces_no_command(self):
        row = pending_row()
        row["gate_resolved_at"] = "already"
        calls = []

        def run(argv):
            calls.append(argv)
            return 0

        stamped = worker.close_pending(Store([row]), run=run, script="hitl.py")
        self.assertEqual(stamped, [])
        self.assertEqual(calls, [])
        self.assertFalse(worker.close_answer(row, run=run, script="hitl.py"))
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
