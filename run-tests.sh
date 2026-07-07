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
    if ! command -v cargo >/dev/null 2>&1; then
        echo "cargo must be available when running meshagent-ts tests with server setup enabled." >&2
        exit 1
    fi

    ROOM_INTERNAL_API_PORT=8078

    export MESHAGENT_API_URL=http://localhost:${ROOM_INTERNAL_API_PORT}
    export MESHAGENT_API_KEY="ma-.j.DnM2qR6WWEq4.mYmfuQ-_B55PLVWSWu_B4GCuETgWA-test-secret-secure-secret-sample2560binarykey"
    export MESHAGENT_SECRET="test-secret-secure-secret-sample2560binarykey"
    export MESHAGENT_PROJECT_ID="fc1e793c-b556-496b-bf07-8182b844e058"
    export MESHAGENT_KEY_ID="fa3f839c-cdaa-47a5-9612-ae3e99899fb9"
    SERVER_STORAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/meshagent-ts-room-server.XXXXXX")"
    SQLITE_STORAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/meshagent-ts-sqlite.XXXXXX")"
    export MESHAGENT_SERVER_CLI_FILES_STORAGE_PATH="$SERVER_STORAGE_DIR"
    export SQLITE_ROOM_STORAGE="file://$SQLITE_STORAGE_DIR"

    cargo run --manifest-path "../../rust/Cargo.toml" -p room-server-cli &
    CLI_PID=$!
    # When this script exits (for any reason), kill the background job
    trap 'kill $CLI_PID 2>/dev/null || true; rm -rf "$SERVER_STORAGE_DIR" "$SQLITE_STORAGE_DIR"' EXIT

    SERVER_READY=false
    for _ in $(seq 1 180); do
        if curl -fsS "$MESHAGENT_API_URL/" >/dev/null; then
            SERVER_READY=true
            break
        fi

        if ! kill -0 $CLI_PID 2>/dev/null; then
            wait $CLI_PID
            echo "MeshAgent test server exited during startup." >&2
            exit 1
        fi

        sleep 0.5
    done

    if ! $SERVER_READY; then
        echo "MeshAgent test server did not become ready at $MESHAGENT_API_URL." >&2
        exit 1
    fi
fi

npm run build && npx mocha dist/node/test/*.js
