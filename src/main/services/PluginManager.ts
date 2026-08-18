import { createHash, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  lstat,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import type {
  InstalledPlugin,
  PluginContribution,
  PluginInstallPreview,
  PluginManifest,
  PluginModule,
  PluginModuleAsset,
  PluginPermission,
  Size
} from "../../shared/contracts";
import {
  HOME_GRID_MAX_COLUMNS,
  HOME_GRID_MAX_ROWS,
  PLUGIN_API_VERSION
} from "../../shared/contracts.ts";

const MANIFEST_FILE = "canvastty.plugin.json";
const REGISTRY_FILE = "plugins.json";
const PREVIEW_TTL_MS = 10 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 90_000;
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_RETRY_DELAY_MS = 1_500;
const MAX_PACKAGE_ENTRIES = 500;
const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_STORAGE_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
const PLUGIN_INPUT_BRIDGE_URL = "canvastty-plugin://host/input-bridge.js";

export function injectPluginInputBridge(html: string): string {
  if (html.includes(PLUGIN_INPUT_BRIDGE_URL)) return html;
  const script = `<script src="${PLUGIN_INPUT_BRIDGE_URL}"></script>`;
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (!head || head.index === undefined) return `${script}${html}`;
  const offset = head.index + head[0].length;
  return `${html.slice(0, offset)}${script}${html.slice(offset)}`;
}

const PLUGIN_PERMISSIONS = new Set<PluginPermission>([
  "storage",
  "secrets",
  "sessions:read",
  "limits:read",
  "launcher:open",
  "external:open",
  "browser:open",
  "media:library",
  "playlists:read",
  "playlists:write",
  "network"
]);

interface StoredPluginRecord {
  sourceUrl: string;
  enabled: boolean;
  installedAt: number;
  selectedModules?: string[];
}

interface PendingInstall {
  directory: string;
  packageRoot: string;
  preview: PluginInstallPreview;
}

type DownloadRepository = (url: string, destination: string) => Promise<void>;
type DownloadModuleFiles = (
  url: string,
  destination: string,
  files: readonly PluginModuleAsset[]
) => Promise<void>;

export class PluginManager {
  private readonly pluginRoot: string;
  private readonly stagingRoot: string;
  private readonly storageRoot: string;
  private readonly registryPath: string;
  private readonly plugins = new Map<string, InstalledPlugin>();
  private readonly pending = new Map<string, PendingInstall>();
  private readonly storageWrites = new Map<string, Promise<void>>();
  private readonly downloadRepository: DownloadRepository;
  private readonly downloadFullRepository: DownloadRepository;
  private readonly downloadModuleFiles: DownloadModuleFiles;
  private registryWrite = Promise.resolve();

  constructor(
    userDataPath: string,
    downloadRepository?: DownloadRepository,
    downloadModuleFiles: DownloadModuleFiles = downloadGithubModuleFiles
  ) {
    this.pluginRoot = join(userDataPath, "plugins");
    this.stagingRoot = join(userDataPath, "plugin-staging");
    this.storageRoot = join(userDataPath, "plugin-storage");
    this.registryPath = join(userDataPath, REGISTRY_FILE);
    this.downloadRepository = downloadRepository ?? downloadGithubManifest;
    this.downloadFullRepository = downloadRepository ?? downloadGithubRepository;
    this.downloadModuleFiles = downloadModuleFiles;
  }

  async load(): Promise<InstalledPlugin[]> {
    await mkdir(this.pluginRoot, { recursive: true });
    await mkdir(this.storageRoot, { recursive: true });
    await rm(this.stagingRoot, { recursive: true, force: true });
    await mkdir(this.stagingRoot, { recursive: true });

    let registry: Record<string, StoredPluginRecord> = {};
    try {
      const raw = await readFile(this.registryPath, "utf8");
      const candidate: unknown = JSON.parse(raw);
      if (isRecord(candidate)) registry = candidate as Record<string, StoredPluginRecord>;
    } catch (error) {
      if (!isMissingFile(error)) {
        console.warn("CanvasTTY plugin registry could not be loaded; invalid entries are ignored.", error);
      }
    }

    this.plugins.clear();
    for (const [pluginId, record] of Object.entries(registry)) {
      if (!isStoredRecord(record) || !isPluginId(pluginId)) continue;
      try {
        const manifest = await readManifest(join(this.pluginRoot, pluginId));
        if (manifest.id !== pluginId) continue;
        this.plugins.set(pluginId, {
          manifest,
          sourceUrl: normalizeGithubUrl(record.sourceUrl),
          enabled: record.enabled,
          installedAt: record.installedAt,
          selectedModules: normalizeSelectedModules(manifest, record.selectedModules)
        });
      } catch (error) {
        console.warn(`CanvasTTY plugin ${pluginId} could not be loaded.`, error);
      }
    }

    await this.persistRegistry();
    return this.list();
  }

  list(): InstalledPlugin[] {
    return [...this.plugins.values()]
      .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))
      .map((plugin) => structuredClone(activePlugin(plugin)));
  }

  async previewInstall(sourceUrl: string): Promise<PluginInstallPreview> {
    this.cleanupExpiredPreviews();
    const canonicalUrl = normalizeGithubUrl(sourceUrl);
    const directory = await mkdtemp(join(this.stagingRoot, "preview-"));
    const packageRoot = join(directory, "repository");

    try {
      await this.downloadRepository(canonicalUrl, packageRoot);
      await inspectPackage(packageRoot);
      let manifest = await readManifest(packageRoot);
      if (this.plugins.has(manifest.id)) {
        throw new Error(`Plugin ${manifest.id} is already installed.`);
      }
      if (manifest.modules?.length) {
        assertModularContributionFiles(manifest);
      } else {
        try {
          await assertContributionAssets(packageRoot, manifest.contributions);
        } catch {
          await rm(packageRoot, { recursive: true, force: true });
          await this.downloadFullRepository(canonicalUrl, packageRoot);
          await inspectPackage(packageRoot);
          const downloadedManifest = await readManifest(packageRoot);
          if (JSON.stringify(downloadedManifest) !== JSON.stringify(manifest)) {
            throw new Error("Plugin manifest changed while its package was downloaded.");
          }
          manifest = downloadedManifest;
          await assertContributionAssets(packageRoot, manifest.contributions);
        }
      }

      const token = randomUUID();
      const preview: PluginInstallPreview = {
        token,
        sourceUrl: canonicalUrl,
        manifest,
        expiresAt: Date.now() + PREVIEW_TTL_MS
      };
      this.pending.set(token, { directory, packageRoot, preview });
      return structuredClone(preview);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async install(token: string, selectedModules?: string[]): Promise<InstalledPlugin> {
    this.cleanupExpiredPreviews();
    const pending = this.pending.get(token);
    if (!pending) throw new Error("Plugin installation preview expired. Inspect the GitHub link again.");
    this.pending.delete(token);

    const { preview, packageRoot, directory } = pending;
    const modules = normalizeSelectedModules(
      preview.manifest,
      selectedModules ?? preview.manifest.modules?.filter((module) => module.defaultSelected).map((module) => module.id)
    );
    const destination = join(this.pluginRoot, preview.manifest.id);
    if (this.plugins.has(preview.manifest.id)) {
      await rm(directory, { recursive: true, force: true });
      throw new Error(`Plugin ${preview.manifest.id} is already installed.`);
    }

    try {
      if (preview.manifest.modules?.length) {
        await materializeModularPackage(
          preview.sourceUrl,
          packageRoot,
          destination,
          preview.manifest,
          modules,
          this.downloadModuleFiles
        );
      } else {
        await rename(packageRoot, destination);
      }
      const installed: InstalledPlugin = {
        manifest: preview.manifest,
        sourceUrl: preview.sourceUrl,
        enabled: true,
        installedAt: Date.now(),
        selectedModules: modules
      };
      this.plugins.set(installed.manifest.id, installed);
      await this.persistRegistry();
      return structuredClone(activePlugin(installed));
    } catch (error) {
      this.plugins.delete(preview.manifest.id);
      await rm(destination, { recursive: true, force: true });
      throw error;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<InstalledPlugin> {
    const plugin = this.requirePlugin(pluginId);
    plugin.enabled = Boolean(enabled);
    await this.persistRegistry();
    return structuredClone(activePlugin(plugin));
  }

  async setModules(pluginId: string, selectedModules: string[]): Promise<InstalledPlugin> {
    const plugin = this.requirePlugin(pluginId);
    if (!plugin.manifest.modules?.length) throw new Error("Plugin does not declare optional modules.");
    const selected = normalizeSelectedModules(plugin.manifest, selectedModules);
    if (selected.length !== new Set(selectedModules).size) throw new Error("Plugin module selection is invalid.");
    const directory = await mkdtemp(join(this.stagingRoot, "modules-"));
    const nextRoot = join(directory, "next");
    const currentRoot = join(this.pluginRoot, pluginId);
    const backupRoot = join(directory, "previous");
    const previousSelection = [...plugin.selectedModules];
    let swapped = false;
    try {
      await materializeModularPackage(
        plugin.sourceUrl,
        currentRoot,
        nextRoot,
        plugin.manifest,
        selected,
        this.downloadModuleFiles
      );
      await rename(currentRoot, backupRoot);
      try {
        await rename(nextRoot, currentRoot);
        swapped = true;
      } catch (error) {
        await rename(backupRoot, currentRoot);
        throw error;
      }
      plugin.selectedModules = selected;
      await this.persistRegistry();
      return structuredClone(activePlugin(plugin));
    } catch (error) {
      if (swapped) {
        plugin.selectedModules = previousSelection;
        await rm(currentRoot, { recursive: true, force: true });
        await rename(backupRoot, currentRoot);
        await this.persistRegistry().catch(() => undefined);
      }
      throw error;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async uninstall(pluginId: string): Promise<void> {
    const plugin = this.requirePlugin(pluginId);
    this.plugins.delete(plugin.manifest.id);
    await this.persistRegistry();
    await rm(join(this.pluginRoot, plugin.manifest.id), { recursive: true, force: true });
    await rm(join(this.storageRoot, `${plugin.manifest.id}.json`), { force: true });
  }

  contribution(pluginId: string, contributionId: string): PluginContribution {
    const plugin = activePlugin(this.requireEnabledPlugin(pluginId));
    const contribution = plugin.manifest.contributions.find((candidate) => candidate.id === contributionId);
    if (!contribution) throw new Error("Plugin contribution does not exist.");
    return structuredClone(contribution);
  }

  hasPermission(pluginId: string, permission: PluginPermission): boolean {
    const plugin = activePlugin(this.requireEnabledPlugin(pluginId));
    return plugin.manifest.permissions.includes(permission);
  }

  assertPermission(pluginId: string, permission: PluginPermission): void {
    if (!this.hasPermission(pluginId, permission)) {
      throw new Error(`Plugin ${pluginId} does not have the ${permission} permission.`);
    }
  }

  async storageGet(pluginId: string, key: string): Promise<unknown> {
    this.assertPermission(pluginId, "storage");
    assertStorageKey(key);
    const storage = await this.readStorage(pluginId);
    return Object.prototype.hasOwnProperty.call(storage, key) ? structuredClone(storage[key]) : null;
  }

  async storageSet(pluginId: string, key: string, value: unknown): Promise<void> {
    this.assertPermission(pluginId, "storage");
    assertStorageKey(key);
    const previous = this.storageWrites.get(pluginId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const storage = await this.readStorage(pluginId);
      storage[key] = jsonClone(value);
      const snapshot = JSON.stringify(storage, null, 2);
      if (Buffer.byteLength(snapshot) > MAX_STORAGE_BYTES) {
        throw new Error("Plugin storage exceeds the 64 KB quota.");
      }
      const path = join(this.storageRoot, `${pluginId}.json`);
      const temporaryPath = `${path}.tmp`;
      await writeFile(temporaryPath, snapshot, "utf8");
      await rename(temporaryPath, path);
    });
    this.storageWrites.set(pluginId, next);
    try {
      await next;
    } finally {
      if (this.storageWrites.get(pluginId) === next) this.storageWrites.delete(pluginId);
    }
  }

  entryUrl(pluginId: string, contributionId: string): string {
    const contribution = this.contribution(pluginId, contributionId);
    return `canvastty-plugin://${pluginId}/${encodeAssetPath(contribution.entry)}`;
  }

  async protocolResponse(requestUrl: string): Promise<Response> {
    try {
      const url = new URL(requestUrl);
      if (url.protocol !== "canvastty-plugin:") return response("Unsupported protocol.", 400);
      if (url.hostname === "host" && url.pathname === "/sdk.js") {
        return new Response(PLUGIN_SDK_SOURCE, {
          status: 200,
          headers: resourceHeaders("application/javascript; charset=utf-8", false, false)
        });
      }
      if (url.hostname === "host" && url.pathname === "/input-bridge.js") {
        return new Response(PLUGIN_INPUT_BRIDGE_SOURCE, {
          status: 200,
          headers: resourceHeaders("application/javascript; charset=utf-8", false, false)
        });
      }

      const plugin = activePlugin(this.requireEnabledPlugin(url.hostname));
      const relativePath = decodeAssetPath(url.pathname);
      const root = join(this.pluginRoot, plugin.manifest.id);
      const path = await containedFile(root, relativePath);
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size > MAX_ASSET_BYTES) return response("Plugin asset is unavailable.", 404);
      const content = await readFile(path);
      const body = extname(path).toLowerCase() === ".html"
        ? injectPluginInputBridge(content.toString("utf8"))
        : content;
      return new Response(body, {
        status: 200,
        headers: resourceHeaders(
          mimeType(path),
          plugin.manifest.permissions.includes("network"),
          plugin.manifest.permissions.includes("media:library")
        )
      });
    } catch {
      return response("Plugin asset is unavailable.", 404);
    }
  }

  async dispose(): Promise<void> {
    const directories = [...this.pending.values()].map((pending) => pending.directory);
    this.pending.clear();
    await Promise.allSettled(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  }

  private requirePlugin(pluginId: string): InstalledPlugin {
    if (!isPluginId(pluginId)) throw new Error("Plugin identifier is invalid.");
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error("Plugin is not installed.");
    return plugin;
  }

  private requireEnabledPlugin(pluginId: string): InstalledPlugin {
    const plugin = this.requirePlugin(pluginId);
    if (!plugin.enabled) throw new Error("Plugin is disabled.");
    return plugin;
  }

  private async readStorage(pluginId: string): Promise<Record<string, unknown>> {
    const path = join(this.storageRoot, `${pluginId}.json`);
    try {
      const raw = await readFile(path, "utf8");
      if (Buffer.byteLength(raw) > MAX_STORAGE_BYTES) return {};
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? { ...parsed } : {};
    } catch (error) {
      if (!isMissingFile(error)) console.warn(`CanvasTTY plugin storage for ${pluginId} could not be read.`, error);
      return {};
    }
  }

  private cleanupExpiredPreviews(): void {
    const now = Date.now();
    for (const [token, pending] of this.pending) {
      if (pending.preview.expiresAt > now) continue;
      this.pending.delete(token);
      void rm(pending.directory, { recursive: true, force: true });
    }
  }

  private persistRegistry(): Promise<void> {
    const registry = Object.fromEntries([...this.plugins].map(([id, plugin]) => [id, {
      sourceUrl: plugin.sourceUrl,
      enabled: plugin.enabled,
      installedAt: plugin.installedAt,
      selectedModules: plugin.selectedModules
    }] satisfies [string, StoredPluginRecord]));
    const snapshot = JSON.stringify(registry, null, 2);
    const temporaryPath = `${this.registryPath}.tmp`;
    const write = this.registryWrite.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.registryPath), { recursive: true });
      await writeFile(temporaryPath, snapshot, "utf8");
      await rename(temporaryPath, this.registryPath);
    });
    this.registryWrite = write;
    return write;
  }
}

export function normalizeGithubUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 300) throw new Error("Enter a GitHub repository URL.");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid GitHub repository URL.");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Plugins can only be installed from an HTTPS github.com repository URL.");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("GitHub URL must not contain credentials, query, or fragment.");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) throw new Error("Use a repository root URL such as https://github.com/owner/repository.");
  const owner = parts[0];
  const repository = parts[1].replace(/\.git$/i, "");
  if (!isGithubName(owner) || !isGithubName(repository)) throw new Error("GitHub owner or repository name is invalid.");
  return `https://github.com/${owner}/${repository}.git`;
}

export function validatePluginManifest(candidate: unknown): PluginManifest {
  if (!isRecord(candidate)) throw new Error("Plugin manifest must be a JSON object.");
  if (candidate.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(`Plugin apiVersion must be ${PLUGIN_API_VERSION}.`);
  }
  const id = requiredString(candidate.id, "id", 80);
  if (!isPluginId(id) || id === "host") throw new Error("Plugin id must be a lowercase DNS-style identifier.");
  const name = requiredString(candidate.name, "name", 80);
  const version = requiredString(candidate.version, "version", 40);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Plugin version must be semantic version text.");
  const description = requiredString(candidate.description, "description", 280);
  const author = optionalString(candidate.author, "author", 120);
  const homepage = optionalWebUrl(candidate.homepage, "homepage");

  if (!Array.isArray(candidate.permissions)) throw new Error("Plugin permissions must be an array.");
  const permissions: PluginPermission[] = [];
  for (const permission of candidate.permissions) {
    if (!PLUGIN_PERMISSIONS.has(permission as PluginPermission)) throw new Error(`Unknown plugin permission: ${String(permission)}.`);
    if (!permissions.includes(permission as PluginPermission)) permissions.push(permission as PluginPermission);
  }

  const modules = validateModules(candidate.modules);
  const moduleIds = new Set(modules.map((module) => module.id));
  const coreFiles = candidate.coreFiles === undefined ? [] : validateModuleFiles(candidate.coreFiles, "coreFiles");
  if (modules.length > 0 && coreFiles.length === 0) {
    throw new Error("Modular plugins must declare at least one coreFiles asset.");
  }
  const ownedFiles = new Set(coreFiles.map((file) => file.path));
  for (const module of modules) {
    for (const file of module.files) {
      if (ownedFiles.has(file.path)) throw new Error(`Plugin module asset is declared more than once: ${file.path}.`);
      ownedFiles.add(file.path);
    }
  }

  if (!Array.isArray(candidate.contributions) || candidate.contributions.length === 0 || candidate.contributions.length > 32) {
    throw new Error("Plugin must declare between 1 and 32 contributions.");
  }
  const contributionIds = new Set<string>();
  const contributions = candidate.contributions.map((value) => {
    const contribution = validateContribution(value);
    if (contribution.module && !moduleIds.has(contribution.module)) {
      throw new Error(`Plugin contribution references an unknown module: ${contribution.module}.`);
    }
    if (contributionIds.has(contribution.id)) throw new Error(`Duplicate contribution id: ${contribution.id}.`);
    contributionIds.add(contribution.id);
    return contribution;
  });
  const settingsContribution = optionalString(candidate.settingsContribution, "settingsContribution", 64);
  if (settingsContribution) {
    const target = contributions.find((contribution) => contribution.id === settingsContribution);
    if (!target || target.kind !== "canvas-app") {
      throw new Error("Plugin settingsContribution must reference a canvas-app contribution.");
    }
  }

  return {
    apiVersion: PLUGIN_API_VERSION,
    id,
    name,
    version,
    description,
    ...(author ? { author } : {}),
    ...(homepage ? { homepage } : {}),
    permissions,
    contributions,
    ...(settingsContribution ? { settingsContribution } : {}),
    ...(coreFiles.length ? { coreFiles } : {}),
    ...(modules.length ? { modules } : {})
  };
}

function validateContribution(value: unknown): PluginContribution {
  if (!isRecord(value)) throw new Error("Every plugin contribution must be an object.");
  const id = requiredString(value.id, "contribution id", 64);
  if (!isContributionId(id)) throw new Error("Contribution id contains unsupported characters.");
  const title = requiredString(value.title, "contribution title", 80);
  const description = optionalString(value.description, "contribution description", 240);
  const entry = assetPath(requiredString(value.entry, "contribution entry", 180));
  if (extname(entry).toLowerCase() !== ".html") throw new Error("Contribution entry must be an HTML file.");
  const iconValue = optionalString(value.icon, "contribution icon", 180);
  const icon = iconValue ? assetPath(iconValue) : null;
  const module = optionalString(value.module, "contribution module", 64);
  if (module && !isContributionId(module)) throw new Error("Contribution module id contains unsupported characters.");
  const base = {
    id,
    title,
    ...(description ? { description } : {}),
    entry,
    ...(icon ? { icon } : {}),
    ...(module ? { module } : {})
  };

  if (value.kind === "home-widget") {
    return { ...base, kind: "home-widget", defaultSize: validateGridSize(value.defaultSize) };
  }
  if (value.kind === "canvas-app" || value.kind === "window") {
    const defaultSize = validateWindowSize(value.defaultSize, "defaultSize", 320, 220);
    const minSize = value.minSize === undefined
      ? null
      : validateWindowSize(value.minSize, "minSize", 240, 140);
    if (minSize && (minSize.width > defaultSize.width || minSize.height > defaultSize.height)) {
      throw new Error("Plugin contribution minSize must not exceed defaultSize.");
    }
    return { ...base, kind: value.kind, defaultSize, ...(minSize ? { minSize } : {}) };
  }
  throw new Error(`Unknown plugin contribution kind: ${String(value.kind)}.`);
}

async function readManifest(packageRoot: string): Promise<PluginManifest> {
  const path = join(packageRoot, MANIFEST_FILE);
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_MANIFEST_BYTES) throw new Error(`${MANIFEST_FILE} is missing or too large.`);
  const raw = await readFile(path, "utf8");
  return validatePluginManifest(JSON.parse(raw) as unknown);
}

async function inspectPackage(root: string): Promise<void> {
  let entryCount = 0;
  let totalBytes = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      entryCount += 1;
      if (entryCount > MAX_PACKAGE_ENTRIES) {
        throw new Error("Plugin package exceeds the 500 entry / 25 MB limit.");
      }
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw new Error("Plugin packages must not contain symbolic links.");
      if (metadata.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!metadata.isFile()) throw new Error("Plugin packages may contain only regular files and directories.");
      totalBytes += metadata.size;
      if (totalBytes > MAX_PACKAGE_BYTES) {
        throw new Error("Plugin package exceeds the 500 entry / 25 MB limit.");
      }
    }
  };
  await visit(root);
}

async function assertContributionAssets(root: string, contributions: readonly PluginContribution[]): Promise<void> {
  for (const contribution of contributions) {
    await containedFile(root, contribution.entry);
    if (contribution.icon) await containedFile(root, contribution.icon);
  }
}

async function containedFile(root: string, relativePath: string): Promise<string> {
  const decoded = assetPath(relativePath);
  const rootRealPath = await realpath(root);
  const candidate = resolve(rootRealPath, decoded);
  const candidateRealPath = await realpath(candidate);
  const relation = relative(rootRealPath, candidateRealPath);
  if (relation.startsWith(`..${sep}`) || relation === ".." || resolve(rootRealPath, relation) !== candidateRealPath) {
    throw new Error("Plugin asset escapes its package root.");
  }
  const metadata = await stat(candidateRealPath);
  if (!metadata.isFile()) throw new Error(`Plugin asset is not a file: ${decoded}.`);
  return candidateRealPath;
}

export async function downloadGithubRepository(sourceUrl: string, destination: string): Promise<void> {
  await retryGithubDownload(() => downloadGithubRepositoryOnce(sourceUrl, destination));
}

async function retryGithubDownload<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown = new Error("GitHub plugin download failed.");
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= DOWNLOAD_ATTEMPTS || !(error instanceof TransientGithubDownloadError)) break;
      await delay(DOWNLOAD_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

class TransientGithubDownloadError extends Error {}

async function downloadGithubRepositoryOnce(sourceUrl: string, destination: string): Promise<void> {
  const source = new URL(sourceUrl);
  const [owner, repositoryWithGit] = source.pathname.split("/").filter(Boolean);
  const repository = repositoryWithGit.replace(/\.git$/i, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  timer.unref();

  try {
    let response: Response;
    try {
      response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/tarball`, {
        redirect: "follow",
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "CanvasTTY plugin installer"
        },
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) throw new TransientGithubDownloadError("GitHub plugin download timed out.");
      throw new TransientGithubDownloadError("GitHub plugin download could not establish a connection.", { cause: error });
    }
    if (response.status === 404) throw new Error("GitHub repository was not found or is not public.");
    if (!response.ok || !response.body) {
      const message = `GitHub download failed with HTTP ${response.status}.`;
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new TransientGithubDownloadError(message);
      }
      throw new Error(message);
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_PACKAGE_BYTES) {
      throw new Error("Plugin archive exceeds the 25 MB download limit.");
    }
    let tarball: Buffer;
    try {
      tarball = await readGzipTarball(response.body);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new TransientGithubDownloadError("GitHub plugin download was interrupted.", { cause: error });
      }
      throw error;
    }
    await extractGithubTarball(tarball, destination);
  } finally {
    clearTimeout(timer);
  }
}

function delay(durationMs: number): Promise<void> {
  // Deliberately not unref'd: a pending download retry must keep the event
  // loop alive, otherwise bare Node contexts (tests, CLI) drain the loop and
  // abort before the retry fires.
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function readGzipTarball(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > MAX_PACKAGE_BYTES) {
        throw new Error("Plugin archive exceeds the 25 MB download limit.");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return gunzipSync(Buffer.concat(chunks, totalBytes), {
      maxOutputLength: MAX_PACKAGE_BYTES + MAX_PACKAGE_ENTRIES * 1_024
    });
  } catch (error) {
    throw new Error("GitHub plugin archive is not a valid bounded gzip tarball.", { cause: error });
  }
}

export async function extractGithubTarball(tarball: Buffer, destination: string): Promise<void> {
  let offset = 0;
  let archiveRoot: string | null = null;
  let entryCount = 0;
  let totalBytes = 0;
  await mkdir(destination, { recursive: true });

  while (offset + 512 <= tarball.length) {
    const header = tarball.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    assertTarChecksum(header);
    const size = tarOctal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] || 48);
    const name = tarText(header.subarray(0, 100));
    const prefix = tarText(header.subarray(345, 500));
    const archivePath = prefix ? `${prefix}/${name}` : name;
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tarball.length) throw new Error("GitHub plugin archive is truncated.");
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === "x" || type === "g") continue;
    if (type !== "0" && type !== "\0" && type !== "5") {
      throw new Error("Plugin archive contains a link or unsupported file type.");
    }

    const parts = safeArchiveParts(archivePath);
    if (parts.length === 0) continue;
    if (archiveRoot === null) archiveRoot = parts[0];
    if (parts[0] !== archiveRoot) throw new Error("GitHub plugin archive contains multiple roots.");
    const relativeParts = parts.slice(1);
    if (relativeParts.length === 0) continue;
    const target = join(destination, ...relativeParts);
    entryCount += 1;
    if (entryCount > MAX_PACKAGE_ENTRIES) {
      throw new Error("Plugin package exceeds the 500 entry / 25 MB limit.");
    }

    if (type === "5") {
      await mkdir(target, { recursive: true });
      continue;
    }

    totalBytes += size;
    if (totalBytes > MAX_PACKAGE_BYTES) {
      throw new Error("Plugin package exceeds the 500 entry / 25 MB limit.");
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, tarball.subarray(dataStart, dataEnd));
  }
}

function validateGridSize(value: unknown): { columns: number; rows: number } {
  if (!isRecord(value) || !Number.isInteger(value.columns) || !Number.isInteger(value.rows)) {
    throw new Error("Home widget defaultSize must contain integer columns and rows.");
  }
  const columns = value.columns as number;
  const rows = value.rows as number;
  if (columns < 1 || columns > HOME_GRID_MAX_COLUMNS || rows < 1 || rows > HOME_GRID_MAX_ROWS) {
    throw new Error("Home widget defaultSize does not fit the Home grid.");
  }
  return { columns, rows };
}

async function downloadGithubManifest(sourceUrl: string, destination: string): Promise<void> {
  const repository = await githubRepositoryMetadata(sourceUrl);
  const url = githubRawUrl(repository.owner, repository.name, repository.branch, MANIFEST_FILE);
  const content = await fetchBoundedGithubFile(url, MAX_MANIFEST_BYTES);
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, MANIFEST_FILE), content);
}

async function downloadGithubModuleFiles(
  sourceUrl: string,
  destination: string,
  files: readonly PluginModuleAsset[]
): Promise<void> {
  const repository = await githubRepositoryMetadata(sourceUrl);
  for (const file of files) {
    const content = await fetchBoundedGithubFile(
      githubRawUrl(repository.owner, repository.name, repository.branch, file.path),
      file.bytes
    );
    if (content.length !== file.bytes || createHash("sha256").update(content).digest("hex") !== file.sha256) {
      throw new Error(`Plugin module asset failed integrity verification: ${file.path}.`);
    }
    const path = join(destination, ...file.path.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
}

async function githubRepositoryMetadata(sourceUrl: string): Promise<{ owner: string; name: string; branch: string }> {
  return retryGithubDownload(() => githubRepositoryMetadataOnce(sourceUrl));
}

async function githubRepositoryMetadataOnce(sourceUrl: string): Promise<{ owner: string; name: string; branch: string }> {
  const source = new URL(sourceUrl);
  const [owner, repositoryWithGit] = source.pathname.split("/").filter(Boolean);
  const name = repositoryWithGit.replace(/\.git$/i, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  timer.unref();
  try {
    let response: Response;
    try {
      response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
        redirect: "follow",
        headers: { accept: "application/vnd.github+json", "user-agent": "CanvasTTY plugin installer" },
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) throw new TransientGithubDownloadError("GitHub metadata request timed out.");
      throw new TransientGithubDownloadError("GitHub metadata request could not establish a connection.", { cause: error });
    }
    const finalUrl = new URL(response.url || `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
    if (finalUrl.protocol !== "https:" || finalUrl.hostname !== "api.github.com") {
      throw new Error("GitHub metadata request redirected outside api.github.com.");
    }
    if (response.status === 404) throw new Error("GitHub repository was not found or is not public.");
    if (!response.ok) {
      const message = `GitHub metadata request failed with HTTP ${response.status}.`;
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new TransientGithubDownloadError(message);
      }
      throw new Error(message);
    }
    const value: unknown = await response.json();
    if (!isRecord(value) || typeof value.default_branch !== "string" || value.default_branch.length > 200) {
      throw new Error("GitHub repository metadata is invalid.");
    }
    return { owner, name, branch: value.default_branch };
  } finally {
    clearTimeout(timer);
  }
}

function githubRawUrl(owner: string, repository: string, branch: string, path: string): string {
  return [
    "https://raw.githubusercontent.com",
    encodeURIComponent(owner),
    encodeURIComponent(repository),
    encodeURIComponent(branch),
    ...assetPath(path).split("/").map(encodeURIComponent)
  ].join("/");
}

async function fetchBoundedGithubFile(url: string, maximumBytes: number): Promise<Buffer> {
  return retryGithubDownload(() => fetchBoundedGithubFileOnce(url, maximumBytes));
}

async function fetchBoundedGithubFileOnce(url: string, maximumBytes: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  timer.unref();
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": "CanvasTTY plugin installer" },
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) throw new TransientGithubDownloadError("GitHub plugin file download timed out.");
      throw new TransientGithubDownloadError("GitHub plugin file download could not establish a connection.", { cause: error });
    }
    const finalUrl = new URL(response.url || url);
    if (finalUrl.protocol !== "https:" || finalUrl.hostname !== "raw.githubusercontent.com") {
      throw new Error("GitHub plugin file redirected outside raw.githubusercontent.com.");
    }
    if (!response.ok || !response.body) {
      const message = `GitHub file download failed with HTTP ${response.status}.`;
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new TransientGithubDownloadError(message);
      }
      throw new Error(message);
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maximumBytes) throw new Error("Plugin file exceeds its declared size.");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > maximumBytes) throw new Error("Plugin file exceeds its declared size.");
        chunks.push(chunk);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new TransientGithubDownloadError("GitHub plugin file download timed out.", { cause: error });
      }
      if (error instanceof TypeError) {
        throw new TransientGithubDownloadError("GitHub plugin file download was interrupted.", { cause: error });
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timer);
  }
}

function assertModularContributionFiles(manifest: PluginManifest): void {
  const coreFiles = new Set((manifest.coreFiles ?? []).map((file) => file.path));
  const moduleFiles = new Map((manifest.modules ?? []).map((module) => [
    module.id,
    new Set(module.files.map((file) => file.path))
  ]));
  for (const contribution of manifest.contributions) {
    const available = contribution.module ? moduleFiles.get(contribution.module) : coreFiles;
    if (!available?.has(contribution.entry) || (contribution.icon && !available.has(contribution.icon))) {
      throw new Error(`Contribution assets must belong to its declared module: ${contribution.id}.`);
    }
  }
}

async function materializeModularPackage(
  sourceUrl: string,
  previewRoot: string,
  destination: string,
  manifest: PluginManifest,
  selectedModules: readonly string[],
  downloadFiles: DownloadModuleFiles
): Promise<void> {
  const selected = new Set(selectedModules);
  const files = [
    ...(manifest.coreFiles ?? []),
    ...(manifest.modules ?? []).filter((module) => selected.has(module.id)).flatMap((module) => module.files)
  ];
  if (files.length > MAX_PACKAGE_ENTRIES || files.reduce((total, file) => total + file.bytes, 0) > MAX_PACKAGE_BYTES) {
    throw new Error("Selected plugin modules exceed the package limits.");
  }
  await mkdir(destination, { recursive: true });
  await copyFile(join(previewRoot, MANIFEST_FILE), join(destination, MANIFEST_FILE));
  await downloadFiles(sourceUrl, destination, files);
  await inspectPackage(destination);
  await assertContributionAssets(destination, activeManifest(manifest, selectedModules).contributions);
}

function activeManifest(manifest: PluginManifest, selectedModules: readonly string[]): PluginManifest {
  const selected = new Set(selectedModules);
  const contributions = manifest.contributions.filter((contribution) => !contribution.module || selected.has(contribution.module));
  const permissions = [
    ...manifest.permissions,
    ...(manifest.modules ?? []).filter((module) => selected.has(module.id)).flatMap((module) => module.permissions)
  ];
  const { settingsContribution, ...rest } = manifest;
  return {
    ...rest,
    permissions: [...new Set(permissions)],
    contributions,
    ...(settingsContribution && contributions.some((item) => item.id === settingsContribution)
      ? { settingsContribution }
      : {})
  };
}

function validateModules(value: unknown): PluginModule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) throw new Error("Plugin modules must be an array of at most 16 items.");
  const ids = new Set<string>();
  return value.map((candidate) => {
    if (!isRecord(candidate)) throw new Error("Every plugin module must be an object.");
    const id = requiredString(candidate.id, "module id", 64);
    if (!isContributionId(id) || ids.has(id)) throw new Error(`Plugin module id is invalid or duplicated: ${id}.`);
    ids.add(id);
    const title = requiredString(candidate.title, "module title", 80);
    const description = optionalString(candidate.description, "module description", 240);
    if (!Array.isArray(candidate.permissions)) throw new Error(`Plugin module ${id} permissions must be an array.`);
    const permissions: PluginPermission[] = [];
    for (const permission of candidate.permissions) {
      if (!PLUGIN_PERMISSIONS.has(permission as PluginPermission)) {
        throw new Error(`Unknown plugin module permission: ${String(permission)}.`);
      }
      if (!permissions.includes(permission as PluginPermission)) permissions.push(permission as PluginPermission);
    }
    return {
      id,
      title,
      ...(description ? { description } : {}),
      defaultSelected: candidate.defaultSelected !== false,
      permissions,
      files: validateModuleFiles(candidate.files, `module ${id} files`)
    };
  });
}

function normalizeSelectedModules(manifest: PluginManifest, value: unknown): string[] {
  const available = new Set((manifest.modules ?? []).map((module) => module.id));
  if (!Array.isArray(value)) return [];
  const selected: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !available.has(id) || selected.includes(id)) continue;
    selected.push(id);
  }
  return selected;
}

function activePlugin(plugin: InstalledPlugin): InstalledPlugin {
  return {
    ...plugin,
    manifest: activeManifest(plugin.manifest, plugin.selectedModules)
  };
}

function validateModuleFiles(value: unknown, label: string): PluginModuleAsset[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PACKAGE_ENTRIES) {
    throw new Error(`Plugin ${label} must contain between 1 and ${MAX_PACKAGE_ENTRIES} files.`);
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  return value.map((candidate) => {
    if (!isRecord(candidate)) throw new Error(`Every plugin ${label} entry must be an object.`);
    const path = assetPath(requiredString(candidate.path, `${label} path`, 180));
    if (path === MANIFEST_FILE || seen.has(path)) throw new Error(`Plugin module asset is invalid or duplicated: ${path}.`);
    seen.add(path);
    if (!Number.isInteger(candidate.bytes) || (candidate.bytes as number) < 0 || (candidate.bytes as number) > MAX_ASSET_BYTES) {
      throw new Error(`Plugin module asset size is invalid: ${path}.`);
    }
    const bytes = candidate.bytes as number;
    totalBytes += bytes;
    if (totalBytes > MAX_PACKAGE_BYTES) throw new Error("Plugin module assets exceed the 25 MB package limit.");
    const sha256 = requiredString(candidate.sha256, `${label} sha256`, 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Plugin module asset hash is invalid: ${path}.`);
    return { path, bytes, sha256 };
  });
}

function validateWindowSize(
  value: unknown,
  label: "defaultSize" | "minSize",
  minimumWidth: number,
  minimumHeight: number
): Size {
  if (!isRecord(value) || !Number.isFinite(value.width) || !Number.isFinite(value.height)) {
    throw new Error(`Plugin window ${label} must contain a finite width and height.`);
  }
  const width = Math.round(value.width as number);
  const height = Math.round(value.height as number);
  if (width < minimumWidth || width > 1_600 || height < minimumHeight || height > 1_100) {
    throw new Error(`Plugin window ${label} is outside the supported bounds.`);
  }
  return { width, height };
}

function assetPath(value: string): string {
  if (value.includes("\\") || value.startsWith("/") || value.includes("\0")) throw new Error("Plugin asset path is invalid.");
  const parts = value.split("/");
  if (parts.length === 0 || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("Plugin asset path is invalid.");
  }
  return parts.join("/");
}

function encodeAssetPath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function decodeAssetPath(pathname: string): string {
  try {
    return assetPath(pathname.replace(/^\/+/, "").split("/").map(decodeURIComponent).join("/"));
  } catch {
    throw new Error("Plugin asset URL is invalid.");
  }
}

function resourceHeaders(mime: string, network: boolean, mediaLibrary: boolean): Headers {
  const connectSources = [
    ...(mediaLibrary ? ["canvastty-media:"] : []),
    ...(network ? ["https:", "http://127.0.0.1:*", "http://localhost:*"] : [])
  ].join(" ") || "'none'";
  const remoteMedia = network ? " https:" : "";
  const localMedia = mediaLibrary ? " canvastty-media:" : "";
  return new Headers({
    "content-type": mime,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
    "content-security-policy": [
      "default-src 'none'",
      "script-src 'self' canvastty-plugin://host",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob:${remoteMedia}`,
      `media-src 'self' data: blob:${localMedia}${remoteMedia}`,
      "font-src 'self' data:",
      `connect-src ${connectSources}`,
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'"
    ].join("; ")
  });
}

function response(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
  });
}

function mimeType(path: string): string {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav"
  } as Record<string, string>)[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new Error(`Plugin ${field} is missing or too long.`);
  }
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

function optionalString(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined) return null;
  return requiredString(value, field, maxLength);
}

function optionalWebUrl(value: unknown, field: string): string | null {
  const text = optionalString(value, field, 300);
  if (!text) return null;
  const url = new URL(text);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`Plugin ${field} must be an HTTP(S) URL.`);
  return url.toString();
}

function isPluginId(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 3
    && value.length <= 80
    && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value)
    && !value.includes("..");
}

function isContributionId(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 64
    && /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(value);
}

function isGithubName(value: string): boolean {
  return value.length > 0 && value.length <= 100 && /^[A-Za-z0-9_.-]+$/.test(value) && value !== "." && value !== "..";
}

function isStoredRecord(value: unknown): value is StoredPluginRecord {
  return Boolean(
    isRecord(value)
    && typeof value.sourceUrl === "string"
    && typeof value.enabled === "boolean"
    && typeof value.installedAt === "number"
    && Number.isFinite(value.installedAt)
    && (value.selectedModules === undefined || (
      Array.isArray(value.selectedModules) && value.selectedModules.every((item) => typeof item === "string")
    ))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function assertStorageKey(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(value)) {
    throw new Error("Plugin storage key is invalid.");
  }
}

function jsonClone(value: unknown): unknown {
  if (value === undefined) throw new Error("Plugin storage value must be JSON serializable.");
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    throw new Error("Plugin storage value must be JSON serializable.");
  }
}

function tarText(value: Buffer): string {
  const end = value.indexOf(0);
  return value.subarray(0, end < 0 ? value.length : end).toString("utf8").trim();
}

function tarOctal(value: Buffer): number {
  const text = tarText(value).replace(/^\s+|\s+$/g, "");
  if (!/^[0-7]+$/.test(text)) throw new Error("Plugin archive contains an invalid tar size.");
  const parsed = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Plugin archive contains an invalid tar size.");
  return parsed;
}

function assertTarChecksum(header: Buffer): void {
  const expected = tarOctal(header.subarray(148, 156));
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index];
  }
  if (actual !== expected) throw new Error("Plugin archive tar checksum is invalid.");
}

function safeArchiveParts(value: string): string[] {
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error("Plugin archive contains an unsafe path.");
  }
  const parts = value.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === ".." || part.includes(":"))) {
    throw new Error("Plugin archive contains an unsafe path.");
  }
  return parts;
}

const PLUGIN_SDK_SOURCE = `(() => {
  const pending = new Map();
  const listeners = new Set();
  const storageListeners = new Set();
  let nextId = 1;
  const post = (message) => parent.postMessage({ source: "canvastty-plugin", ...message }, "*");
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = String(nextId++);
    pending.set(requestId, { resolve, reject });
    post({ type: "request", requestId, method, params });
  });
  addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== parent || !message || message.source !== "canvastty-host") return;
    if (message.type === "response") {
      const handler = pending.get(message.requestId);
      if (!handler) return;
      pending.delete(message.requestId);
      message.ok ? handler.resolve(message.value) : handler.reject(new Error(message.error || "Plugin request failed."));
      return;
    }
    if (message.type === "context") listeners.forEach((listener) => listener(message.value));
    if (message.type === "storage-change") {
      storageListeners.forEach((listener) => listener(message.key, message.value));
    }
  });
  window.CanvasTTYPlugin = Object.freeze({
    ready: () => post({ type: "ready" }),
    request,
    storage: Object.freeze({
      get: (key) => request("storage.get", { key }),
      set: (key, value) => request("storage.set", { key, value })
    }),
    secrets: Object.freeze({
      get: (key) => request("secrets.get", { key }),
      set: (key, value) => request("secrets.set", { key, value }),
      delete: (key) => request("secrets.delete", { key })
    }),
    canvas: Object.freeze({
      open: (contributionId) => request("canvas.open", { contributionId })
    }),
    media: Object.freeze({
      pickLibrary: () => request("media.pickLibrary"),
      listLibraries: () => request("media.listLibraries"),
      scanLibrary: (libraryId) => request("media.scanLibrary", { libraryId }),
      revokeLibrary: (libraryId) => request("media.revokeLibrary", { libraryId })
    }),
    playlists: Object.freeze({
      list: (libraryId) => request("playlists.list", { libraryId }),
      read: (libraryId, playlistId) => request("playlists.read", { libraryId, playlistId }),
      write: (libraryId, name, content) => request("playlists.write", { libraryId, name, content })
    }),
    onContext: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onStorageChange: (listener) => {
      storageListeners.add(listener);
      return () => storageListeners.delete(listener);
    }
  });
  addEventListener("DOMContentLoaded", () => post({ type: "ready" }), { once: true });
})();`;

const PLUGIN_INPUT_BRIDGE_SOURCE = `(() => {
  if (parent === window) return;
  let captureWheel = false;
  addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== parent || !message || message.source !== "canvastty-host") return;
    if (message.type === "canvas-input-policy") captureWheel = message.captureWheel === true;
  });
  addEventListener("wheel", (event) => {
    if (!captureWheel) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    parent.postMessage({
      source: "canvastty-plugin",
      type: "canvas-wheel",
      clientX: event.clientX,
      clientY: event.clientY,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey
    }, "*");
  }, { capture: true, passive: false });
  addEventListener("pointerdown", () => {
    parent.postMessage({ source: "canvastty-plugin", type: "canvas-focus" }, "*");
  }, { capture: true });
  addEventListener("pointerover", (event) => {
    if (event.relatedTarget !== null) return;
    parent.postMessage({ source: "canvastty-plugin", type: "canvas-hover", active: true }, "*");
  }, { capture: true });
  addEventListener("pointerout", (event) => {
    if (event.relatedTarget !== null) return;
    parent.postMessage({ source: "canvastty-plugin", type: "canvas-hover", active: false }, "*");
  }, { capture: true });
})();`;
