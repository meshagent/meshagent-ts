import { expect } from "chai";

import {
    Connector,
    MCPHeader,
    MCPServer,
    mcpConnectorsFromRoomServices,
    ServiceSpec,
} from "../index";

describe("toolkit config", () => {
    describe("Connector.buildConnectorRef", () => {
        it("coerces legacy header maps into strict header entries", () => {
            const server = MCPServer.fromJson({
                server_label: "custom",
                headers: { "Meshagent-OAuth-Client-Secret-Id": "secret-123" },
            });

            expect(server.headers?.map((header) => header.toJson())).to.deep.equal([
                { name: "Meshagent-OAuth-Client-Secret-Id", value: "secret-123" },
            ]);
            expect(server.toJson().headers).to.deep.equal([
                { name: "Meshagent-OAuth-Client-Secret-Id", value: "secret-123" },
            ]);
        });

        it("returns null for public MCP server with only server_url", () => {
            const server = new MCPServer({
                serverLabel: "deepwiki",
                serverUrl: "https://mcp.deepwiki.com/mcp",
            });

            expect(Connector.buildConnectorRef({ server })).to.equal(null);
        });

        it("builds ref when OAuth config is provided with server_url", () => {
            const server = new MCPServer({
                serverLabel: "mcp",
                serverUrl: "https://mcp.notion.com/mcp",
            });

            const connectorRef = Connector.buildConnectorRef({
                server,
                oauth: {
                    client_id: "client-id",
                    authorization_endpoint: "https://auth.example.com/authorize",
                    token_endpoint: "https://auth.example.com/token",
                },
            });

            expect(connectorRef).to.deep.equal({
                openaiConnectorId: null,
                serverUrl: "https://mcp.notion.com/mcp",
                clientSecretId: null,
            });
        });

        it("builds ref when openai connector id is provided", () => {
            const server = new MCPServer({
                serverLabel: "dropbox",
                openaiConnectorId: "connector_dropbox",
            });

            expect(Connector.buildConnectorRef({ server })?.openaiConnectorId).to.equal("connector_dropbox");
        });

        it("builds ref when custom OAuth secret header is present", () => {
            const server = new MCPServer({
                serverLabel: "custom",
                serverUrl: "https://mcp.example.com",
                headers: [new MCPHeader({ name: "Meshagent-OAuth-Client-Secret-Id", value: "secret-123" })],
            });

            const connectorRef = Connector.buildConnectorRef({ server });

            expect(connectorRef?.clientSecretId).to.equal("secret-123");
            expect(connectorRef?.serverUrl).to.equal("https://mcp.example.com");
        });
    });

    describe("mcpConnectorsFromRoomServices", () => {
        it("builds MCP connectors from matching room services", () => {
            const services: ServiceSpec[] = [
                {
                    version: "v1",
                    kind: "Service",
                    metadata: { name: "local-mcp" },
                    ports: [
                        {
                            num: 8080,
                            endpoints: [
                                {
                                    path: "/mcp",
                                    mcp: {
                                        label: "Local MCP",
                                        require_approval: "always",
                                        headers: { Authorization: "Bearer token" },
                                        openai_connector_id: "connector_local",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    version: "v1",
                    kind: "Service",
                    metadata: {
                        name: "external-mcp",
                        annotations: { "meshagent.agent.filter": "chatbot" },
                    },
                    external: { url: "mcp.example.com/root" },
                    ports: [
                        {
                            num: 443,
                            endpoints: [
                                {
                                    path: "remote",
                                    mcp: {
                                        label: "External MCP",
                                        openai_connector_id: "connector_external",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    version: "v1",
                    kind: "Service",
                    metadata: {
                        name: "filtered-out",
                        annotations: { "meshagent.agent.filter": "other-agent" },
                    },
                    ports: [
                        {
                            num: 9090,
                            endpoints: [
                                {
                                    path: "/ignored",
                                    mcp: { label: "Ignored MCP" },
                                },
                            ],
                        },
                    ],
                },
            ];

            const connectors = mcpConnectorsFromRoomServices({ services, agentName: "chatbot" });

            expect(connectors.map((connector) => connector.name)).to.deep.equal(["Local MCP", "External MCP"]);
            expect(connectors[0].server.serverUrl).to.equal("http://localhost:8080/mcp");
            expect(connectors[0].server.requireApproval).to.equal("always");
            expect(connectors[0].server.openaiConnectorId).to.equal("connector_local");
            expect(connectors[0].server.headers?.map((header) => header.toJson())).to.deep.equal([
                { name: "Authorization", value: "Bearer token" },
            ]);
            expect(connectors[1].server.serverUrl).to.equal("https://mcp.example.com:443/root/remote");
        });
    });
});
