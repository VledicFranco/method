import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getNumber, setNumber } from "@method/core";

const setNumberInput = z.object({ value: z.number().describe("The new value.") });

const server = new Server(
  { name: "method", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_number",
      description: "Read the current number value.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "set_number",
      description: "Set the number to a new value.",
      inputSchema: {
        type: "object",
        properties: {
          value: { type: "number", description: "The new value." },
        },
        required: ["value"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_number") {
    return { content: [{ type: "text", text: String(getNumber()) }] };
  }

  if (name === "set_number") {
    const { value } = setNumberInput.parse(args);
    setNumber(value);
    return { content: [{ type: "text", text: `Number set to ${value}` }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
