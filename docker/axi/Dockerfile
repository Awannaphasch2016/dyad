# AXI toolbox: gh, gh-axi, and a slot for this repo's operations AXI.
#
# The image carries no credentials. Pass GH_TOKEN at run time or mount a
# read-only gh config at /home/agent/.config/gh. Versions come from
# docker/axi/tools.env; see docs/axi-toolbox.md for how to bump them.

# The operations AXI slot. Without a named context this stage holds only the
# stub. The workflow builds with
#   --build-context ops-axi=packages/ops-axi
# and the package contents replace this stage.
FROM scratch AS ops-axi
COPY docker/axi/ops-axi-stub.sh /ops-axi-stub.sh

FROM node:24-bookworm-slim

ARG GH_VERSION
ARG GH_AXI_VERSION
ARG DEFAULT_REPO=Awannaphasch2016/dyad

ENV DEBIAN_FRONTEND=noninteractive

RUN test -n "$GH_VERSION" && test -n "$GH_AXI_VERSION" \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        jq \
    && rm -rf /var/lib/apt/lists/* \
    && arch="$(dpkg --print-architecture)" \
    && deb="gh_${GH_VERSION}_linux_${arch}.deb" \
    && base="https://github.com/cli/cli/releases/download/v${GH_VERSION}" \
    && curl -fsSL "${base}/${deb}" -o "/tmp/${deb}" \
    && curl -fsSL "${base}/gh_${GH_VERSION}_checksums.txt" -o /tmp/gh_checksums.txt \
    && (cd /tmp && grep " ${deb}\$" gh_checksums.txt | sha256sum -c -) \
    && dpkg -i "/tmp/${deb}" \
    && rm -f "/tmp/${deb}" /tmp/gh_checksums.txt \
    && useradd --create-home --uid 10001 --shell /bin/bash agent

# Global npm installs live under /opt/axi, owned by root. The image runs as
# agent, so `gh-axi update` cannot rewrite the tool inside a container.
ENV PATH=/opt/axi/bin:$PATH \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN npm install -g --prefix /opt/axi --ignore-scripts "gh-axi@${GH_AXI_VERSION}" \
    && npm cache clean --force \
    && rm -rf /root/.npm /tmp/* \
    && test "$(gh-axi --version)" = "${GH_AXI_VERSION}"

COPY --from=ops-axi / /opt/axi/local/
RUN if [ -f /opt/axi/local/bin/ops-axi.js ]; then \
        chmod 755 /opt/axi/local/bin/ops-axi.js \
        && ln -s /opt/axi/local/bin/ops-axi.js /opt/axi/bin/ops-axi; \
    else \
        chmod 755 /opt/axi/local/ops-axi-stub.sh \
        && ln -s /opt/axi/local/ops-axi-stub.sh /opt/axi/bin/ops-axi; \
    fi \
    && ops-axi --help >/dev/null

COPY docker/axi/entrypoint.sh /opt/axi/entrypoint.sh
RUN chmod 755 /opt/axi/entrypoint.sh

ENV HOME=/home/agent \
    GH_REPO=${DEFAULT_REPO} \
    AXI_SKILL_DIR=/opt/axi/lib/node_modules/gh-axi/skills/gh-axi

USER agent
WORKDIR /work

# Session hooks for Claude Code, Codex, and OpenCode, plus the gh-axi skill,
# are written into the image user's home. The entrypoint repairs them when a
# caller mounts another home over /home/agent.
RUN gh-axi setup hooks >/dev/null \
    && mkdir -p /home/agent/.agents/skills /home/agent/.claude/skills \
    && ln -s "$AXI_SKILL_DIR" /home/agent/.agents/skills/gh-axi \
    && ln -s "$AXI_SKILL_DIR" /home/agent/.claude/skills/gh-axi \
    && test -f /home/agent/.claude/settings.json

ENTRYPOINT ["/opt/axi/entrypoint.sh"]
CMD ["gh-axi"]
