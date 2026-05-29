import { useEffect, useMemo, useRef, useState } from "react";
import { parse as parseToml } from "smol-toml";
import { useTranslation } from "react-i18next";
import JsonEditor from "@/components/JsonEditor";
import { FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { normalizeTomlText } from "@/utils/textNormalization";

type GrokApiBackend = "chat_completions" | "responses" | "messages";
type GrokAuthScheme = "bearer" | "x_api_key";

interface GrokDraft {
  installer: string;
  autoUpdate: boolean;
  defaultModelId: string;
  displayName: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  envKey: string;
  apiBackend: GrokApiBackend;
  authScheme: GrokAuthScheme;
}

interface GrokFormFieldsProps {
  settingsConfig: string;
  onSettingsConfigChange: (value: string) => void;
}

const DEFAULT_GROK_DRAFT: GrokDraft = {
  installer: "internal",
  autoUpdate: true,
  defaultModelId: "gpt-4o",
  displayName: "",
  model: "gpt-4o",
  baseUrl: "https://api.example.com/v1",
  apiKey: "",
  envKey: "",
  apiBackend: "chat_completions",
  authScheme: "bearer",
};

const stringOr = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const boolOr = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const tomlString = (value: string) => JSON.stringify(value);

const tomlKey = (key: string) =>
  /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);

const normalizeApiBackend = (value: unknown): GrokApiBackend => {
  if (
    value === "responses" ||
    value === "messages" ||
    value === "chat_completions"
  ) {
    return value;
  }
  return "chat_completions";
};

const normalizeAuthScheme = (value: unknown): GrokAuthScheme =>
  value === "x_api_key" || value === "x-api-key" ? "x_api_key" : "bearer";

const extractTomlFromSettings = (settingsConfig: string): string => {
  try {
    const parsed = JSON.parse(settingsConfig || "{}");
    return typeof parsed?.config === "string" ? parsed.config : "";
  } catch {
    return "";
  }
};

const wrapTomlSettings = (toml: string) =>
  JSON.stringify({ config: toml }, null, 2);

const parseGrokToml = (
  toml: string,
): { draft: GrokDraft; error?: string } => {
  if (!toml.trim()) {
    return { draft: DEFAULT_GROK_DRAFT };
  }

  try {
    const parsed = parseToml(normalizeTomlText(toml)) as Record<
      string,
      unknown
    >;
    const cli =
      parsed.cli && typeof parsed.cli === "object"
        ? (parsed.cli as Record<string, unknown>)
        : {};
    const models =
      parsed.models && typeof parsed.models === "object"
        ? (parsed.models as Record<string, unknown>)
        : {};
    const modelTables =
      parsed.model && typeof parsed.model === "object"
        ? (parsed.model as Record<string, unknown>)
        : {};
    const firstModelId =
      Object.keys(modelTables).find((key) => key !== "grok-build") ||
      DEFAULT_GROK_DRAFT.defaultModelId;
    const defaultModelId = stringOr(models.default, firstModelId).trim();
    const modelTable =
      modelTables[defaultModelId] && typeof modelTables[defaultModelId] === "object"
        ? (modelTables[defaultModelId] as Record<string, unknown>)
        : modelTables[firstModelId] && typeof modelTables[firstModelId] === "object"
          ? (modelTables[firstModelId] as Record<string, unknown>)
          : {};

    return {
      draft: {
        installer: stringOr(cli.installer, DEFAULT_GROK_DRAFT.installer),
        autoUpdate: boolOr(cli.auto_update, DEFAULT_GROK_DRAFT.autoUpdate),
        defaultModelId: defaultModelId || DEFAULT_GROK_DRAFT.defaultModelId,
        displayName: stringOr(modelTable.name),
        model: stringOr(modelTable.model, defaultModelId || firstModelId),
        baseUrl: stringOr(modelTable.base_url),
        apiKey: stringOr(modelTable.api_key),
        envKey: stringOr(modelTable.env_key),
        apiBackend: normalizeApiBackend(modelTable.api_backend),
        authScheme: normalizeAuthScheme(modelTable.auth_scheme),
      },
    };
  } catch (error) {
    return {
      draft: DEFAULT_GROK_DRAFT,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const renderGrokToml = (draft: GrokDraft): string => {
  const modelId =
    draft.defaultModelId.trim() || draft.model.trim() || "gpt-4o";
  const modelName = draft.model.trim() || modelId;
  const lines = [
    "[cli]",
    `installer = ${tomlString(draft.installer.trim() || "internal")}`,
    `auto_update = ${draft.autoUpdate ? "true" : "false"}`,
    "",
    "[models]",
    `default = ${tomlString(modelId)}`,
    "",
    `[model.${tomlKey(modelId)}]`,
  ];

  if (draft.displayName.trim()) {
    lines.push(`name = ${tomlString(draft.displayName.trim())}`);
  }
  lines.push(`model = ${tomlString(modelName)}`);
  if (draft.baseUrl.trim()) {
    lines.push(`base_url = ${tomlString(draft.baseUrl.trim())}`);
  }
  if (draft.apiKey.trim()) {
    lines.push(`api_key = ${tomlString(draft.apiKey.trim())}`);
  }
  if (draft.envKey.trim()) {
    lines.push(`env_key = ${tomlString(draft.envKey.trim())}`);
  }
  lines.push(`api_backend = ${tomlString(draft.apiBackend)}`);
  if (draft.authScheme === "x_api_key") {
    lines.push(`auth_scheme = ${tomlString("x_api_key")}`);
  }

  return `${lines.join("\n")}\n`;
};

export function GrokFormFields({
  settingsConfig,
  onSettingsConfigChange,
}: GrokFormFieldsProps) {
  const { t } = useTranslation();
  const [rawToml, setRawToml] = useState(() =>
    extractTomlFromSettings(settingsConfig),
  );
  const lastEmittedSettingsRef = useRef(settingsConfig);

  useEffect(() => {
    if (settingsConfig === lastEmittedSettingsRef.current) return;
    lastEmittedSettingsRef.current = settingsConfig;
    setRawToml(extractTomlFromSettings(settingsConfig));
  }, [settingsConfig]);

  const parsed = useMemo(() => parseGrokToml(rawToml), [rawToml]);
  const draft = parsed.draft;

  const emitToml = (nextToml: string) => {
    const wrapped = wrapTomlSettings(nextToml);
    lastEmittedSettingsRef.current = wrapped;
    setRawToml(nextToml);
    onSettingsConfigChange(wrapped);
  };

  const updateDraft = (patch: Partial<GrokDraft>) => {
    emitToml(renderGrokToml({ ...draft, ...patch }));
  };

  const handleRawTomlChange = (nextToml: string) => {
    emitToml(nextToml);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <FormLabel htmlFor="grok-default-model">
            {t("grok.form.defaultModel", { defaultValue: "默认模型 ID" })}
          </FormLabel>
          <Input
            id="grok-default-model"
            value={draft.defaultModelId}
            onChange={(event) =>
              updateDraft({ defaultModelId: event.target.value })
            }
            placeholder="DeepSeek/deepseek-v4-pro"
          />
        </div>

        <div className="space-y-2">
          <FormLabel htmlFor="grok-upstream-model">
            {t("grok.form.upstreamModel", { defaultValue: "上游模型名" })}
          </FormLabel>
          <Input
            id="grok-upstream-model"
            value={draft.model}
            onChange={(event) => updateDraft({ model: event.target.value })}
            placeholder="DeepSeek/deepseek-v4-pro"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <FormLabel htmlFor="grok-base-url">
            {t("grok.form.baseUrl", { defaultValue: "API 端点" })}
          </FormLabel>
          <Input
            id="grok-base-url"
            value={draft.baseUrl}
            onChange={(event) => updateDraft({ baseUrl: event.target.value })}
            placeholder="https://api.example.com/v1"
          />
        </div>

        <div className="space-y-2">
          <FormLabel htmlFor="grok-api-key">
            {t("grok.form.apiKey", { defaultValue: "API Key" })}
          </FormLabel>
          <Input
            id="grok-api-key"
            type="password"
            value={draft.apiKey}
            onChange={(event) => updateDraft({ apiKey: event.target.value })}
            placeholder="sk-..."
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <FormLabel htmlFor="grok-api-backend">
            {t("grok.form.apiBackend", { defaultValue: "API 格式" })}
          </FormLabel>
          <Select
            value={draft.apiBackend}
            onValueChange={(value) =>
              updateDraft({ apiBackend: value as GrokApiBackend })
            }
          >
            <SelectTrigger id="grok-api-backend">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chat_completions">
                Chat Completions
              </SelectItem>
              <SelectItem value="responses">Responses</SelectItem>
              <SelectItem value="messages">Messages</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <FormLabel htmlFor="grok-auth-scheme">
            {t("grok.form.authScheme", { defaultValue: "鉴权 Header" })}
          </FormLabel>
          <Select
            value={draft.authScheme}
            onValueChange={(value) =>
              updateDraft({ authScheme: value as GrokAuthScheme })
            }
          >
            <SelectTrigger id="grok-auth-scheme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bearer">Authorization: Bearer</SelectItem>
              <SelectItem value="x_api_key">x-api-key</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <FormLabel htmlFor="grok-env-key">
            {t("grok.form.envKey", { defaultValue: "API Key 环境变量" })}
          </FormLabel>
          <Input
            id="grok-env-key"
            value={draft.envKey}
            onChange={(event) => updateDraft({ envKey: event.target.value })}
            placeholder="GROK_API_KEY"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <FormLabel htmlFor="grok-display-name">
            {t("grok.form.displayName", { defaultValue: "显示名称" })}
          </FormLabel>
          <Input
            id="grok-display-name"
            value={draft.displayName}
            onChange={(event) =>
              updateDraft({ displayName: event.target.value })
            }
            placeholder="DeepSeek V4 Pro"
          />
        </div>

        <div className="space-y-2">
          <FormLabel htmlFor="grok-installer">
            {t("grok.form.installer", { defaultValue: "安装器" })}
          </FormLabel>
          <Input
            id="grok-installer"
            value={draft.installer}
            onChange={(event) => updateDraft({ installer: event.target.value })}
            placeholder="internal"
          />
        </div>

        <div className="flex items-center justify-between rounded-md border border-border-default px-3 py-2">
          <div>
            <FormLabel htmlFor="grok-auto-update">
              {t("grok.form.autoUpdate", { defaultValue: "自动更新" })}
            </FormLabel>
            <p className="text-xs text-muted-foreground">
              {t("grok.form.autoUpdateHint", {
                defaultValue: "写入 [cli].auto_update",
              })}
            </p>
          </div>
          <Switch
            id="grok-auto-update"
            checked={draft.autoUpdate}
            onCheckedChange={(checked) => updateDraft({ autoUpdate: checked })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <FormLabel htmlFor="grok-config-toml">
          {t("grok.form.rawToml", {
            defaultValue: "高级配置 TOML",
          })}
        </FormLabel>
        <JsonEditor
          value={rawToml}
          onChange={handleRawTomlChange}
          placeholder={`[models]
default = "gpt-4o"

[model.gpt-4o]
model = "gpt-4o"
base_url = "https://api.example.com/v1"
api_key = ""
api_backend = "chat_completions"`}
          rows={12}
          showValidation={false}
          language="javascript"
          wrapLines
        />
        {parsed.error ? (
          <p className="text-xs text-red-500 dark:text-red-400">
            {t("grok.form.tomlParseError", {
              defaultValue: "TOML 解析失败：{{error}}",
              error: parsed.error,
            })}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("grok.form.rawTomlHint", {
              defaultValue:
                "这里直接对应 ~/.grok/config.toml 的 config 内容，长行会自动换行显示。",
            })}
          </p>
        )}
      </div>
    </div>
  );
}
