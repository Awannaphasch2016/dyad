#!/usr/bin/env bash
# Build or reuse the experiment images. Tags always start with harness-.
# This script does not push the live preview tag, the commit tag, or the live context tag.
set -euo pipefail

prefix="${IMAGE_TAG_PREFIX:-harness}"
owner="awannaphasch2016"
gascity_repo="https://github.com/Awannaphasch2016/gascity.git"

case "${prefix}" in
  harness | harness-gha) ;;
  *)
    echo "refusing prefix ${prefix}" >&2
    exit 1
    ;;
esac

refuse_tag() {
  local tag="$1"
  case "${tag}" in
    ghcr.io/"${owner}"/gascity:"${prefix}"-* | \
      ghcr.io/"${owner}"/gascity-base:"${prefix}"-* | \
      ghcr.io/"${owner}"/dyad:"${prefix}"-*) ;;
    *)
      echo "refusing tag ${tag}" >&2
      exit 1
      ;;
  esac
  case "${tag}" in
    *:preview | *:preview-* | *:sha-*)
      echo "refusing live tag ${tag}" >&2
      exit 1
      ;;
  esac
}

registry_has() {
  local tag="$1"
  if docker buildx imagetools inspect "${tag}" >/dev/null 2>&1; then
    return 0
  fi
  DOCKER_CLI_EXPERIMENTAL=enabled docker manifest inspect "${tag}" >/dev/null 2>&1
}

image_digest() {
  local tag="$1"
  local digest
  digest="$(docker buildx imagetools inspect "${tag}" 2>/dev/null | awk 'tolower($1) == "digest:" { print $2; exit }')"
  if [[ -z "${digest}" ]]; then
    digest="$(docker image inspect --format '{{index .RepoDigests 0}}' "${tag}" 2>/dev/null || true)"
  fi
  printf '%s\n' "${digest}"
}

print_config() {
  local tag="$1"
  docker image inspect --format 'entrypoint={{json .Config.Entrypoint}}' "${tag}"
  docker image inspect --format 'user={{json .Config.User}}' "${tag}"
  docker image inspect --format 'ports={{json .Config.ExposedPorts}}' "${tag}"
  docker image inspect --format 'env={{json .Config.Env}}' "${tag}"
  docker image inspect --format 'healthcheck={{json .Config.Healthcheck.Test}}' "${tag}"
}

install_go() {
  if command -v go >/dev/null 2>&1 && [[ "$(go env GOVERSION 2>/dev/null || true)" == "go1.26.6" ]]; then
    return 0
  fi
  local prefix_dir="${HOME}/.local/go"
  mkdir -p "${prefix_dir}"
  curl -fsSL "https://go.dev/dl/go1.26.6.linux-amd64.tar.gz" -o /tmp/go.tgz
  tar -xzf /tmp/go.tgz -C "${prefix_dir}" --strip-components=1
  export PATH="${prefix_dir}/bin:${PATH}"
  hash -r
  test "$(go env GOVERSION)" = "go1.26.6"
}

install_node_if_missing() {
  if command -v node >/dev/null 2>&1; then
    return 0
  fi
  local prefix_dir="${HOME}/.local/node"
  mkdir -p "${prefix_dir}"
  curl -fsSL "https://nodejs.org/dist/v24.13.1/node-v24.13.1-linux-x64.tar.xz" -o /tmp/node.tar.xz
  tar -xJf /tmp/node.tar.xz -C "${prefix_dir}" --strip-components=1
  export PATH="${prefix_dir}/bin:${PATH}"
  hash -r
  test "$(node -v)" = "v24.13.1"
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker_missing"
    exit 1
  fi
  export DOCKER_BUILDKIT=1
}

build_gascity() {
  local work sha base_tag agent_tag
  work="$(mktemp -d)"
  git clone --depth 1 --branch main "${gascity_repo}" "${work}/gascity"
  sha="$(git -C "${work}/gascity" rev-parse HEAD)"
  base_tag="ghcr.io/${owner}/gascity-base:${prefix}-${sha}"
  agent_tag="ghcr.io/${owner}/gascity:${prefix}-${sha}"
  refuse_tag "${base_tag}"
  refuse_tag "${agent_tag}"
  echo "gascity_sha=${sha}"
  echo "base_tag=${base_tag}"
  echo "agent_tag=${agent_tag}"
  if registry_has "${agent_tag}"; then
    echo "decision=reuse"
    docker pull "${agent_tag}"
    print_config "${agent_tag}"
    docker run --rm --entrypoint /usr/local/bin/gc "${agent_tag}" version
    echo "digest=$(image_digest "${agent_tag}")"
    return 0
  fi
  echo "decision=build"
  install_go
  (
    cd "${work}/gascity"
    CGO_ENABLED=0 go build -trimpath -o gc ./cmd/gc
    ./gc version
    set -a
    # shellcheck disable=SC1091
    source ./deps.env
    set +a
    BR_INSTALL_BIN_DIR="${HOME}/.local/bin" bash .github/scripts/install-br-archive.sh "${BR_VERSION}"
    cp "${HOME}/.local/bin/br" ./br
    chmod 755 ./br ./gc
    docker build -f contrib/k8s/Dockerfile.base -t "${base_tag}" .
    docker push "${base_tag}"
    docker build -f contrib/k8s/Dockerfile.agent --build-arg "BASE_IMAGE=${base_tag}" -t "${agent_tag}" .
    docker push "${agent_tag}"
  )
  print_config "${agent_tag}"
  docker run --rm --entrypoint /usr/local/bin/gc "${agent_tag}" version
  echo "digest=$(image_digest "${agent_tag}")"
}

retag_or_push() {
  local source="$1"
  local target="$2"
  if docker buildx imagetools create --tag "${target}" "${source}"; then
    echo "retag_method=imagetools"
    return 0
  fi
  echo "retag_method=pull"
  docker pull "${source}"
  docker tag "${source}" "${target}"
  docker push "${target}"
}

probe_dyad_health() {
  local tag="$1"
  local name="dyad-harness-health-$$"
  docker rm -f "${name}" >/dev/null 2>&1 || true
  docker run -d --name "${name}" --shm-size=1024m \
    -e NOVNC_PASSWORD=probe \
    -e GAS_CITY_HOST_BRIDGE_ENABLED=true \
    -e GAS_CITY_HOST_BRIDGE_TOKEN=probe \
    "${tag}" >/dev/null
  local code="" ready=0
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
    if docker exec "${name}" curl --fail --silent "http://127.0.0.1:6080/vnc.html" >/dev/null; then
      code="$(docker exec "${name}" curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:32100/v1/apps/0/factory-state" || true)"
      echo "factory_state_status=${code}"
      if [[ "${code}" == "401" ]]; then
        ready=1
        break
      fi
    fi
    sleep 10
  done
  docker rm -f "${name}" >/dev/null 2>&1 || true
  if [[ "${ready}" != "1" ]]; then
    echo "health=fail"
    return 1
  fi
  echo "health=pass"
}

build_dyad() {
  local root sha hash ctx_tag sha_tag
  root="$(cd "$(dirname "$0")/../.." && pwd)"
  cd "${root}"
  install_node_if_missing
  sha="$(git rev-parse HEAD)"
  hash="$(node scripts/gascity/preview-image-id.mjs)"
  ctx_tag="ghcr.io/${owner}/dyad:${prefix}-ctx-${hash}"
  sha_tag="ghcr.io/${owner}/dyad:${prefix}-${sha}"
  refuse_tag "${ctx_tag}"
  refuse_tag "${sha_tag}"
  echo "dyad_sha=${sha}"
  echo "context_hash=${hash}"
  echo "ctx_tag=${ctx_tag}"
  echo "sha_tag=${sha_tag}"
  if registry_has "${ctx_tag}"; then
    echo "decision=reuse"
    retag_or_push "${ctx_tag}" "${sha_tag}"
    echo "digest=$(image_digest "${sha_tag}")"
    return 0
  fi
  echo "decision=build"
  docker build -f Dockerfile.gascity -t "${ctx_tag}" -t "${sha_tag}" .
  docker push "${ctx_tag}"
  docker push "${sha_tag}"
  print_config "${sha_tag}"
  echo "digest=$(image_digest "${sha_tag}")"
  probe_dyad_health "${sha_tag}"
}

main() {
  ensure_docker
  echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "tag_prefix=${prefix}"
  case "${1:-}" in
    gascity) build_gascity ;;
    dyad) build_dyad ;;
    *)
      echo "usage: harness-image.sh gascity|dyad" >&2
      exit 2
      ;;
  esac
  echo "finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

main "$@"
