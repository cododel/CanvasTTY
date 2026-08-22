import { MCP_SERVER_NAME } from "../../agent-browser/tool-catalog.mjs";

export const OPENCODE_CONFIG_CONTENT = "OPENCODE_CONFIG_CONTENT";

interface OpenCodeStdioHelper {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

type OpenCodeConfig = Record<string, unknown>;

export function openCodeBrowserEnvironment(
  helper: OpenCodeStdioHelper,
  environment: Readonly<Record<string, string | undefined>> = process.env
): Record<string, string> {
  const config = parseInlineConfig(environment[OPENCODE_CONFIG_CONTENT]);
  const mcp = objectField(config.mcp, "mcp");
  return {
    [OPENCODE_CONFIG_CONTENT]: JSON.stringify({
      ...config,
      mcp: {
        ...mcp,
        [MCP_SERVER_NAME]: {
          type: "local",
          command: [helper.command, ...helper.args],
          enabled: true,
          ...(helper.env && Object.keys(helper.env).length > 0
            ? { environment: helper.env }
            : {})
        }
      },
      permission: allowBrowserTools(config.permission)
    })
  };
}

export function openCodeYoloEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env
): Record<string, string> {
  const config = parseInlineConfig(environment[OPENCODE_CONFIG_CONTENT]);
  return {
    [OPENCODE_CONFIG_CONTENT]: JSON.stringify({ ...config, permission: "allow" })
  };
}

function parseInlineConfig(raw: string | undefined): OpenCodeConfig {
  if (!raw || raw.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OPENCODE_CONFIG_CONTENT must contain valid JSON before CanvasTTY can extend it.");
  }
  if (!isObject(parsed)) {
    throw new Error("OPENCODE_CONFIG_CONTENT must contain a JSON object before CanvasTTY can extend it.");
  }
  return parsed;
}

function objectField(value: unknown, name: string): OpenCodeConfig {
  if (value === undefined) return {};
  if (!isObject(value)) {
    throw new Error(`OpenCode inline config field ${name} must be an object.`);
  }
  return value;
}

function allowBrowserTools(permission: unknown): OpenCodeConfig {
  if (permission === undefined) return { [`${MCP_SERVER_NAME}_*`]: "allow" };
  if (permission === "allow") return { "*": "allow", [`${MCP_SERVER_NAME}_*`]: "allow" };
  if (permission === "ask" || permission === "deny") {
    return { "*": permission, [`${MCP_SERVER_NAME}_*`]: "allow" };
  }
  return {
    ...objectField(permission, "permission"),
    [`${MCP_SERVER_NAME}_*`]: "allow"
  };
}

function isObject(value: unknown): value is OpenCodeConfig {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
