#!/bin/bash
SETUP_SERVER=true

# Parse flags (add more cases if you need other options)
for arg in "$@"; do
  case "$arg" in
    --skip-server-setup) SETUP_SERVER=false ;;
    *) ;;                 # ignore unknown args
  esac
done

if $SETUP_SERVER; then
    export MESHAGENT_API_URL=http://localhost:8080
    export MESHAGENT_API_KEY="ma-.j.DnM2qR6WWEq4.mYmfuQ-_B55PLVWSWu_B4GCuETgWA-test-secret-secure-secret-sample2560binarykey"
    export MESHAGENT_SECRET="test-secret-secure-secret-sample2560binarykey"
    export MESHAGENT_PROJECT_ID="fc1e793c-b556-496b-bf07-8182b844e058"
    export MESHAGENT_KEY_ID="fa3f839c-cdaa-47a5-9612-ae3e99899fb9"
    export MESHAGENT_SERVER_CLI_FILES_STORAGE_PATH=".local_server_documents"

    VIRTUAL_ENV=`pwd`/venv
    python3 -m venv $VIRTUAL_ENV
    PATH="$VIRTUAL_ENV/bin:$PATH"

    pip3 install uv
    uv pip install --no-cache-dir \
                ../meshagent-api \
                ../meshagent-agents \
                ../meshagent-tools \
                ../meshagent-openai \
                ../meshagent-otel \
                ../../meshagent-cloud \
                ../../meshagent-server 

    uv run python ../../meshagent-server/meshagent/server/cli/cli.py &
    CLI_PID=$!
    # When this script exits (for any reason), kill the background job
    trap 'kill $CLI_PID 2>/dev/null || true' EXIT
fi

npm run build && npx mocha dist/node/test/*.js
