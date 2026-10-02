import time

import dagger
from dagger import dag, function, object_type


def _hex_sha(commit: str) -> str:
    cleaned = commit.strip().lower()
    if (
        not cleaned
        or len(cleaned) < 7
        or len(cleaned) > 40
        or any(char not in "0123456789abcdef" for char in cleaned)
    ):
        raise ValueError("commit must be a hex sha")
    return cleaned


@object_type
class Gascity:
    """Host rollout for the Gas City Dyad container."""

    def _docker_cli(self, docker: dagger.Socket) -> dagger.Container:
        # The module client has no dag.host(), so the caller passes the socket.
        return (
            dag.container()
            .from_("docker:27-cli")
            .with_unix_socket("/var/run/docker.sock", docker)
            .with_env_variable("CACHEBUST", str(time.time_ns()))
        )

    @function
    async def preflight(self, docker: dagger.Socket) -> str:
        """Check the host Docker engine and the running Gas City image."""
        client = self._docker_cli(docker)
        version = await client.with_exec(
            ["docker", "info", "--format", "{{.ServerVersion}}"]
        ).stdout()
        image = await client.with_exec(
            [
                "docker",
                "image",
                "inspect",
                "--format",
                "{{.Id}}",
                "weaver-plus:gascity",
            ]
        ).stdout()
        return f"docker {version.strip()} image {image.strip()}"

    @function
    async def rollout(self, commit: str, docker: dagger.Socket) -> str:
        """Fast-forward the host checkout and rebuild weaver-plus:gascity.

        The commit is a hex sha. ``docker`` is the host engine socket. The
        host script reads Doppler's env file itself; this function does not.
        """
        commit = _hex_sha(commit)
        return await (
            self._docker_cli(docker)
            .with_exec(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--privileged",
                    "--pid=host",
                    "--network=host",
                    "-v",
                    "/:/host",
                    "debian:bookworm-slim",
                    "chroot",
                    "/host",
                    "/bin/bash",
                    "/opt/gascity/weaver-plus/scripts/gascity/rollout.sh",
                    commit,
                ]
            )
            .stdout()
        )
