#!/usr/bin/env python3
"""Close one Gas City gate for a saved Wewebplus answer.

Selects wewebplus.answers whose gate_resolved_at is empty, runs hitl.py
respond and then release, and stamps the row only after both succeed.
"""

import os
import subprocess
import sys

DEFAULT_RIG = "multi tenant HITL"


def rig_name():
    value = os.environ.get("RIG", "").strip()
    return value or DEFAULT_RIG


def hitl_path():
    value = os.environ.get("HITL_PY", "").strip()
    if not value:
        raise SystemExit("HITL_PY is required")
    return value


def is_pending(row):
    if row.get("gate_resolved_at"):
        return False
    return bool(
        row.get("run_id") and row.get("step_id") and row.get("answered_by_name")
    )


def commands_for(row, script):
    name = row["answered_by_name"]
    step = row["step_id"]
    run = row["run_id"]
    return [
        [script, "respond", "--as", name, "--step", step, "--run", run],
        [script, "release", "--run", run],
    ]


def run_hitl(argv):
    result = subprocess.run(
        [sys.executable, *argv],
        env={**os.environ, "RIG": rig_name()},
        check=False,
    )
    return result.returncode


def close_answer(row, run=run_hitl, script=None):
    """Return True when the answer should be stamped."""
    if not is_pending(row):
        return False
    respond, release = commands_for(row, script or hitl_path())
    if run(respond) != 0:
        return False
    if run(release) != 0:
        return False
    return True


def select_pending(connection):
    return connection.execute(
        """
        select a.id, q.run_id, q.step_id, q.answered_by_name, a.gate_resolved_at
        from wewebplus.answers a
        join wewebplus.questions q on q.id = a.question_id
        where a.gate_resolved_at is null
          and q.run_id <> ''
          and q.step_id <> ''
          and q.answered_by_name is not null
          and q.answered_by_name <> ''
        order by a.created_at
        for update of a skip locked
        """
    ).fetchall()


def stamp(connection, answer_id):
    connection.execute(
        """
        update wewebplus.answers
        set gate_resolved_at = now()
        where id = %s
          and gate_resolved_at is null
        """,
        (answer_id,),
    )


def close_pending(connection, run=run_hitl, script=None):
    stamped = []
    for row in select_pending(connection):
        record = {
            "id": row[0],
            "run_id": row[1],
            "step_id": row[2],
            "answered_by_name": row[3],
            "gate_resolved_at": row[4],
        }
        if close_answer(record, run=run, script=script):
            stamp(connection, record["id"])
            stamped.append(record["id"])
    return stamped


def main():
    url = os.environ.get("WEWEBPLUS_DATABASE_URL", "").strip()
    if not url:
        raise SystemExit("WEWEBPLUS_DATABASE_URL is required")
    script = hitl_path()
    import psycopg

    with psycopg.connect(url) as connection:
        stamped = close_pending(connection, script=script)
        connection.commit()
    for answer_id in stamped:
        print(answer_id)


if __name__ == "__main__":
    main()
