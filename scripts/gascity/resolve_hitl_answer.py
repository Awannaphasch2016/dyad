#!/usr/bin/env python3
"""Close one Gas City gate for a saved Wewebplus answer, then start Dyad.

Selects wewebplus.answers whose gate_resolved_at is empty, runs hitl.py
respond and then release, and stamps the row only after both succeed.
After the stamp, POSTs the stored prompt to the factory bridge. A refused
POST records runtime_run_id as "refused" and does not clear the stamp, so
the next pass does not release or POST again.
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

DEFAULT_RIG = "multi tenant HITL"
REFUSED = "refused"


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


def row_from(fetched):
    return {
        "id": fetched[0],
        "run_id": fetched[1],
        "step_id": fetched[2],
        "answered_by_name": fetched[3],
        "gate_resolved_at": fetched[4],
        "phase": fetched[5],
        "body": fetched[6],
        "idempotency_key": fetched[7],
        "runtime_run_id": fetched[8],
    }


PENDING_SQL = """
        select a.id, q.run_id, q.step_id, q.answered_by_name, a.gate_resolved_at,
               q.phase, q.body, q.idempotency_key, a.runtime_run_id
        from wewebplus.answers a
        join wewebplus.questions q on q.id = a.question_id
        where a.gate_resolved_at is null
          and a.runtime_run_id is null
          and q.run_id <> ''
          and q.step_id <> ''
          and q.answered_by_name is not null
          and q.answered_by_name <> ''
        order by a.created_at
        for update of a skip locked
        """

UNPOSTED_SQL = """
        select a.id, q.run_id, q.step_id, q.answered_by_name, a.gate_resolved_at,
               q.phase, q.body, q.idempotency_key, a.runtime_run_id
        from wewebplus.answers a
        join wewebplus.questions q on q.id = a.question_id
        where a.gate_resolved_at is not null
          and a.runtime_run_id is null
          and q.body <> ''
          and q.idempotency_key <> ''
        order by a.created_at
        for update of a skip locked
        """


def select_pending(connection):
    return connection.execute(PENDING_SQL).fetchall()


def select_unposted(connection):
    return connection.execute(UNPOSTED_SQL).fetchall()


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


def mark_runtime(connection, answer_id, value):
    connection.execute(
        """
        update wewebplus.answers
        set runtime_run_id = %s
        where id = %s
          and runtime_run_id is null
        """,
        (value, answer_id),
    )


def default_post(row):
    """POST the factory run. No Origin header. Returns (ok, run_id)."""
    app_id = os.environ.get("FACTORY_APP_ID", "").strip()
    base = os.environ.get("WEAVER_BASE_URL", "").rstrip("/")
    token = os.environ.get("GAS_CITY_HOST_BRIDGE_TOKEN", "").strip()
    phase = row.get("phase") or ""
    prompt = row.get("body") or ""
    key = row.get("idempotency_key") or ""
    if (
        not app_id.isdigit()
        or not base
        or not token
        or phase not in ("discovery", "implementation", "delivery")
        or not prompt
        or not key
    ):
        return False, None
    url = f"{base}/v1/apps/{app_id}/phases/{phase}/runs"
    request = urllib.request.Request(
        url,
        data=json.dumps({"prompt": prompt, "idempotencyKey": key}).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read().decode()
            parsed = json.loads(raw) if raw else {}
            run_id = parsed.get("runId")
            if not isinstance(run_id, str) or not run_id:
                return False, None
            return True, run_id
    except urllib.error.HTTPError:
        return False, None
    except Exception:
        return False, None


def deliver(connection, record, post):
    ok, run_id = post(record)
    mark_runtime(connection, record["id"], run_id if ok and run_id else REFUSED)


def close_pending(connection, run=run_hitl, script=None, post=None):
    poster = post or default_post
    stamped = []
    for fetched in select_pending(connection):
        record = row_from(fetched)
        if close_answer(record, run=run, script=script):
            stamp(connection, record["id"])
            stamped.append(record["id"])
            deliver(connection, record, poster)
    for fetched in select_unposted(connection):
        deliver(connection, row_from(fetched), poster)
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
