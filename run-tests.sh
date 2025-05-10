#!/bin/bash
export MESHAGENT_API_URL=http://localhost:8080
export MESHAGENT_SECRET=testsecret
export MESHAGENT_PROJECT_ID=testproject
export MESHAGENT_KEY_ID=testkey
export MESHAGENT_SERVER_CLI_FILES_STORAGE_PATH=".local_server_documents"

VIRTUAL_ENV=`pwd`/venv
python3 -m venv $VIRTUAL_ENV
PATH="$VIRTUAL_ENV/bin:$PATH"

pip install --no-cache-dir \
            ../meshagent-api \
            ../meshagent-agents \
            ../meshagent-tools \
            ../meshagent-openai \
            ../../meshagent-cloud \
            ../../meshagent-server 

python3 ../../meshagent-server/meshagent/server/cli/cli.py &
CLI_PID=$!
# When this script exits (for any reason), kill the background job
trap 'kill $CLI_PID 2>/dev/null || true' EXIT
npm run build && npx mocha dist/node/test/*.js
