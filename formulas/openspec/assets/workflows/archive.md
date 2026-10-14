Archive the change at {{artifact_root}} only after the delivery verdict is approve.
When the openspec CLI is on PATH, run openspec archive for this change.
When it is not, move the delta specs into the main spec tree and record the archive path as gc.build.archive_path on the workflow root.
