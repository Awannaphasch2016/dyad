#!/usr/bin/env sh
# Stands in for the operations AXI until packages/ops-axi exists.
cat <<'EOF'
ops-axi:
  status: not installed in this image
help[1]:
  Build packages/ops-axi and rebuild docker/axi/Dockerfile to include it
EOF
exit 0
