import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { win32 } from "node:path";
import type { ProviderId } from "../../shared/contracts.ts";
import { openCodeYoloEnvironment } from "./openCodeConfig.ts";

export interface TerminalLaunch {
  command: string;
  args: string[] | string;
  environment?: Record<string, string>;
}

interface LaunchResolutionOptions {
  platform?: NodeJS.Platform;
  environment?: Readonly<NodeJS.ProcessEnv>;
  homeDirectory?: string;
  fileExists?: (path: string) => boolean;
}

const WINDOWS_NATIVE_EXTENSIONS = [".exe", ".com"];
const WINDOWS_SCRIPT_EXTENSIONS = [".cmd", ".bat"];

export function resolveTerminalLaunch(
  provider: ProviderId,
  profile: "normal" | "yolo",
  agentBrowserArgs: string[] = [],
  options: LaunchResolutionOptions = {}
): TerminalLaunch {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const fileExists = options.fileExists ?? existsSync;

  if (provider === "terminal") {
    return platform === "win32"
      ? resolveWindowsShell(environment, fileExists)
      : { command: environment.SHELL || "/bin/bash", args: ["-l"] };
  }

  const launchEnvironment = profile === "yolo" && provider === "opencode"
    ? openCodeYoloEnvironment(environment)
    : undefined;
  const providerArgs = [
    ...(profile === "yolo" && provider !== "opencode" ? dangerousArguments(provider) : []),
    ...agentBrowserArgs
  ];
  if (platform !== "win32") {
    return {
      command: provider,
      args: providerArgs,
      ...(launchEnvironment ? { environment: launchEnvironment } : {})
    };
  }

  const homeDirectory = options.homeDirectory ?? homedir();
  const resolved = resolveWindowsProvider(provider, environment, homeDirectory, fileExists);
  if (!WINDOWS_SCRIPT_EXTENSIONS.includes(win32.extname(resolved).toLowerCase())) {
    return {
      command: resolved,
      args: providerArgs,
      ...(launchEnvironment ? { environment: launchEnvironment } : {})
    };
  }

  const commandPrompt = resolveWindowsCommandPrompt(environment, fileExists);
  return {
    command: commandPrompt,
    args: windowsBatchCommandLine(resolved, providerArgs),
    ...(launchEnvironment ? { environment: launchEnvironment } : {})
  };
}

function dangerousArguments(provider: Exclude<ProviderId, "terminal" | "opencode">): string[] {
  if (provider === "codex") return ["--dangerously-bypass-approvals-and-sandbox"];
  if (provider === "claude") return ["--dangerously-skip-permissions"];
  if (provider === "grok") return ["--always-approve"];
  return ["--yolo"];
}

function resolveWindowsShell(
  environment: Readonly<NodeJS.ProcessEnv>,
  fileExists: (path: string) => boolean
): TerminalLaunch {
  const systemRoot = environment.SystemRoot || environment.WINDIR;
  if (systemRoot) {
    const windowsPowerShell = win32.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    if (fileExists(windowsPowerShell)) {
      return { command: windowsPowerShell, args: ["-NoLogo", "-NoProfile"] };
    }
  }

  const modernPowerShell = findWindowsCommand(
    "pwsh",
    environment,
    fileExists,
    WINDOWS_NATIVE_EXTENSIONS
  );
  if (modernPowerShell) {
    return { command: modernPowerShell, args: ["-NoLogo", "-NoProfile"] };
  }

  return { command: resolveWindowsCommandPrompt(environment, fileExists), args: ["/d"] };
}

function resolveWindowsProvider(
  provider: Exclude<ProviderId, "terminal">,
  environment: Readonly<NodeJS.ProcessEnv>,
  homeDirectory: string,
  fileExists: (path: string) => boolean
): string {
  const knownDirectories = knownProviderDirectories(provider, environment, homeDirectory);
  const native = findWindowsCommand(provider, environment, fileExists, WINDOWS_NATIVE_EXTENSIONS)
    ?? findInDirectories(provider, knownDirectories, fileExists, WINDOWS_NATIVE_EXTENSIONS);
  if (native) return native;

  const script = findWindowsCommand(provider, environment, fileExists, WINDOWS_SCRIPT_EXTENSIONS)
    ?? findInDirectories(provider, knownDirectories, fileExists, WINDOWS_SCRIPT_EXTENSIONS);
  if (script) return script;

  throw new Error(
    `${providerLabel(provider)} CLI was not found on Windows. Install it, then restart CanvasTTY. `
    + `Checked PATH and these directories: ${knownDirectories.join(", ")}. `
    + "Supported launchers: .exe, .com, .cmd, and .bat."
  );
}

function knownProviderDirectories(
  provider: Exclude<ProviderId, "terminal">,
  environment: Readonly<NodeJS.ProcessEnv>,
  homeDirectory: string
): string[] {
  const directories: string[] = [];
  if (provider === "codex") {
    const localAppData = environment.LOCALAPPDATA ?? win32.join(homeDirectory, "AppData", "Local");
    directories.push(win32.join(localAppData, "Programs", "OpenAI", "Codex", "bin"));
  }
  if (provider === "kimi") directories.push(win32.join(homeDirectory, ".kimi-code", "bin"));
  if (provider === "grok") directories.push(win32.join(homeDirectory, ".grok", "bin"));
  directories.push(win32.join(homeDirectory, ".local", "bin"));
  const roamingAppData = environment.APPDATA ?? win32.join(homeDirectory, "AppData", "Roaming");
  directories.push(win32.join(roamingAppData, "npm"));
  return uniqueWindowsPaths(directories);
}

function resolveWindowsCommandPrompt(
  environment: Readonly<NodeJS.ProcessEnv>,
  fileExists: (path: string) => boolean
): string {
  const configured = environment.ComSpec || environment.COMSPEC;
  if (configured && fileExists(configured)) return configured;

  const fromPath = findWindowsCommand(
    "cmd",
    environment,
    fileExists,
    WINDOWS_NATIVE_EXTENSIONS
  );
  if (fromPath) return fromPath;

  const systemRoot = environment.SystemRoot || environment.WINDIR;
  const systemCommandPrompt = systemRoot ? win32.join(systemRoot, "System32", "cmd.exe") : null;
  if (systemCommandPrompt && fileExists(systemCommandPrompt)) return systemCommandPrompt;
  throw new Error("No supported Windows shell was found (PowerShell, pwsh, or cmd.exe).");
}

function findWindowsCommand(
  command: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  fileExists: (path: string) => boolean,
  extensions: string[]
): string | null {
  return findInDirectories(command, windowsPathEntries(environment), fileExists, extensions);
}

function findInDirectories(
  command: string,
  directories: string[],
  fileExists: (path: string) => boolean,
  extensions: string[]
): string | null {
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = win32.join(directory, `${command}${extension}`);
      if (fileExists(candidate)) return candidate;
    }
  }
  return null;
}

function windowsPathEntries(environment: Readonly<NodeJS.ProcessEnv>): string[] {
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path");
  if (!pathKey) return [];
  return uniqueWindowsPaths(
    (environment[pathKey] ?? "")
      .split(";")
      .map((entry) => entry.trim().replace(/^"|"$/g, ""))
      .filter(Boolean)
  );
}

function uniqueWindowsPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = win32.normalize(path).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function providerLabel(provider: Exclude<ProviderId, "terminal">): string {
  if (provider === "opencode") return "OpenCode";
  return `${provider[0].toUpperCase()}${provider.slice(1)}`;
}

function windowsBatchCommandLine(command: string, args: string[]): string {
  const shellCommand = [escapeCommandPromptCommand(command), ...args.map(escapeCommandPromptArgument)].join(" ");
  return `/d /s /c "${shellCommand}"`;
}

const COMMAND_PROMPT_META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/g;

function escapeCommandPromptCommand(value: string): string {
  return value.replace(COMMAND_PROMPT_META_CHARACTERS, "^$1");
}

function escapeCommandPromptArgument(value: string): string {
  // Follow the same two-stage escaping used by cross-spawn for cmd.exe wrappers:
  // first Windows argv quoting, then protection from command prompt metacharacters.
  let escaped = value.replace(/(?=(\\+?)?)\1"/g, "$1$1\\\"");
  escaped = escaped.replace(/(?=(\\+?)?)\1$/, "$1$1");
  return `"${escaped}"`.replace(COMMAND_PROMPT_META_CHARACTERS, "^$1");
}
