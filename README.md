# [Meshagent](https://www.meshagent.com)

## MeshAgent Typescript SDK

MeshAgent is your platform to create, deploy, and manage AI agents collaboratively and at scale, securely and in real time. 

MeshAgent removes the infrastructure headaches of building and shipping AI Agents. It spins up secure, real-time "Rooms" that connect humans, agents, and shared context -- letting you launch, share, and refine agents in hours instead of weeks.

---

**Documentation**: [docs.meshagent.com](https://docs.meshagent.com/)

**Website**: [www.meshagent.com](https://www.meshagent.com/)

**MeshAgent Studio**: [studio.meshagent.com](https://studio.meshagent.com/)

---

## Get Started

Install the MeshAgent CLI, connect it to your account, then run a minimal toolkit locally with the TypeScript SDK.

### 1. Install the MeshAgent CLI

If you are using a Python-based install path, MeshAgent currently requires **Python 3.13**. Python 3.14 is not supported yet, and earlier versions are not tested.

If you do not already have Python 3.13, the simplest setup is:

#### Install uv on Linux or macOS
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

#### or Install uv on windows (PowerShell):
```bash
powershelliwr -useb https://astral.sh/uv/install.ps1 | iex
```


#### Download and manage Python 3.13
```bash
uv python install 3.13
```

#### Verify the version
```bash
uv run --python 3.13 python --version
```

Use the install path that matches your environment:

```bash
# macOS
brew tap meshagent/homebrew-meshagent
brew install meshagent

# Windows
choco install meshagent

# Other platforms
uv tool install --python 3.13 "meshagent[cli]"
```

Then sign in and activate a project:

```bash
meshagent setup
```

### 2. Install the TypeScript SDK

```bash
npm install @meshagent/meshagent
```

### 3. Create `example.js`

```js
const process = require("node:process");

const {
    JsonContent,
    RoomClient,
    Tool,
    Toolkit,
    startHostedToolkit,
} = require("@meshagent/meshagent");

const inputSchema = {
    type: "object",
    required: ["message"],
    additionalProperties: false,
    properties: {
        message: {
            type: "string",
            description: "Message to echo back.",
        },
    },
};

class EchoTool extends Tool {
    constructor() {
        super({
            name: "echo",
            title: "Echo",
            description: "Echoes a message and adds the hosting participant name.",
            inputSchema,
        });
    }

    async execute({ message }) {
        return new JsonContent({
            json: {
                message,
                hostedBy: process.env.MESHAGENT_PARTICIPANT_NAME ?? "toolkit-host",
            },
        });
    }
}

async function main() {
    let room;
    let hostedToolkit;

    try {
        room = new RoomClient();
        await room.start();

        const toolkit = new Toolkit({
            name: "simple-echo",
            title: "Simple Echo Toolkit",
            description: "A minimal toolkit hosted from a Node process.",
            tools: [new EchoTool()],
        });

        hostedToolkit = await startHostedToolkit({
            room,
            toolkit,
            public_: true,
        });

        const result = await room.agents.invokeTool({
            toolkit: "simple-echo",
            tool: "echo",
            arguments: {
                message: "hello from startHostedToolkit",
            },
        });

        if (!(result instanceof JsonContent)) {
            throw new Error(`Expected JsonContent, got ${result.constructor.name}.`);
        }

        process.stdout.write(`${JSON.stringify(result.json, null, 2)}\n`);
    } finally {
        await hostedToolkit?.stop();
        room?.dispose();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
```

### 4. Run the example

```bash
meshagent room connect --room <your-room-name> -- node example.js
```

`meshagent room connect` starts the local Node process with the MeshAgent room environment already configured, so `RoomClient()` can connect without any extra setup in your code. If you already activated a project with `meshagent setup`, you can omit `--project-id`.

## Deploy With a Dockerfile

For deployment, package your toolkit as a long-running Node process. Use the same `RoomClient` and `startHostedToolkit` setup from the local example, but do not invoke the tool and exit; keep the process alive until it receives `SIGTERM` or `SIGINT`.

Create a `Dockerfile` for your toolkit service:

```dockerfile
FROM node:22-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

CMD ["node", "service.js"]
```

Build and push the image to a registry that MeshAgent can pull:

```bash
docker buildx build . \
  -t "<REGISTRY>/<NAMESPACE>/simple-echo-toolkit:<TAG>" \
  --platform linux/amd64 \
  --push
```

Then create a `meshagent.yaml` service manifest that runs the image and injects a room token:

```yaml
kind: Service
version: v1
metadata:
  name: simple-echo-toolkit
  description: "Simple Echo Toolkit hosted from a Node container"
  annotations:
    meshagent.service.id: simple-echo-toolkit
agents:
  - name: simple-echo-toolkit
    description: "Hosts the Simple Echo Toolkit"
container:
  image: "<REGISTRY>/<NAMESPACE>/simple-echo-toolkit:<TAG>"
  command: node service.js
  environment:
    - name: MESHAGENT_TOKEN
      token:
        identity: simple-echo-toolkit
```

Validate and deploy it to a room:

```bash
meshagent service validate --file meshagent.yaml
meshagent service create --file meshagent.yaml --room <your-room-name>
```

After the service starts, the toolkit name you passed to `new Toolkit({ name: ... })` is available in that room.

## Next Steps and Examples

To see examples of agents in action and to start building your own agents check out the MeshAgent docs at [docs.meshagent.com](https://docs.meshagent.com/)

See an example: https://github.com/meshagent/meshagent-tailwind/tree/main/example
