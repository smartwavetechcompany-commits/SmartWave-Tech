import React, { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  History,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  Monitor,
  RotateCcw,
  Save,
  Send,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  ALLOWED_TEMPLATE_VARIABLES,
  MODERN_EMAIL_BLOCK_TYPES,
  SUPPORTED_EMAIL_LANGUAGES,
  VARIABLE_DESCRIPTIONS,
  WEB_SAFE_FONTS,
  type CustomizableEmailEventType,
  type EmailBlock,
  type EmailBlockType,
  type EmailImageAsset,
  type EmailRenderContext,
  type EmailTemplateDocument,
  type EmailTemplateVariant,
  type HotelEmailSettings,
  type SupportedEmailLanguage,
  type WebSafeFontId,
} from "../shared/types";
import { OPTIONAL_SECTION_PRESETS } from "../shared/defaultTemplates";
import {
  buildStarterPresetVariant,
  STARTER_LAYOUT_PRESETS,
  type StarterLayoutPresetId,
} from "../shared/presets";
import { renderEmailTemplate } from "../shared/renderer";
import {
  measureEmailHtmlBytes,
  validateEmailUrl,
  validateTemplateVariant,
} from "../shared/validation";
import { emailCustomizationApi } from "./apiClient";
import { ImageLibraryPanel } from "./ImageLibraryModal";
import { StarterLayoutPickerModal } from "./BlockPaletteModal";
import {
  applyImageAssetToEmailBlock,
  BlockEditor,
  createEmailBlock,
} from "./components/BlockEditor";

interface TemplateBlockEditorProps {
  hotelId?: string;
  eventType: CustomizableEmailEventType;
  eventName: string;
  eventDescription: string;
  initialDoc: EmailTemplateDocument;
  settings: HotelEmailSettings;
  sampleContext: EmailRenderContext;
  callerEmail: string;
  onBack: () => void;
  onDocumentUpdated: (doc: EmailTemplateDocument) => void;
}

const MODERN_BLOCK_SET = new Set<string>(MODERN_EMAIL_BLOCK_TYPES);

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function TemplateBlockEditor({
  hotelId,
  eventType,
  eventName,
  eventDescription,
  initialDoc,
  settings,
  sampleContext,
  callerEmail,
  onBack,
  onDocumentUpdated,
}: TemplateBlockEditorProps) {
  const [doc, setDoc] = useState<EmailTemplateDocument>(initialDoc);
  const [language, setLanguage] = useState<SupportedEmailLanguage>(
    initialDoc.defaultLanguage || settings.defaultLanguage || "en"
  );
  const [variantsByLang, setVariantsByLang] = useState<
    Partial<Record<SupportedEmailLanguage, EmailTemplateVariant>>
  >(() => ({
    en: initialDoc.draft.en || initialDoc.published.en,
    de: initialDoc.draft.de || initialDoc.published.de,
  }));
  const [enabled, setEnabled] = useState<boolean>(initialDoc.enabled);
  const [dirty, setDirty] = useState(false);

  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [includeLoyaltySample, setIncludeLoyaltySample] = useState(false);
  const [brandingOpen, setBrandingOpen] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [starterPickerOpen, setStarterPickerOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(
    () => (initialDoc.draft.en || initialDoc.published.en)?.blocks[0]?.id || null
  );

  const [imagePickerTarget, setImagePickerTarget] = useState<
    | null
    | { kind: "logo" }
    | { kind: "block"; blockId: string; field: string; removeIfEmptyOnClose?: boolean }
  >(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const directUploadTargetRef = useRef<{ blockId: string; field: string } | null>(null);
  const directFileInputRef = useRef<HTMLInputElement | null>(null);

  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
  const [testing, setTesting] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [resetting, setResetting] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  const variant = (variantsByLang[language] || variantsByLang.en)!;
  const appUrl = (sampleContext.appUrl || "https://tidehotels.de").replace(/\/+$/, "");

  const updateVariant = (updater: (prev: EmailTemplateVariant) => EmailTemplateVariant) => {
    setVariantsByLang((prev) => {
      const current = (prev[language] || prev.en)!;
      return { ...prev, [language]: updater(current) };
    });
    setDirty(true);
    setServerErrors([]);
  };

  const validationIssues = useMemo(() => validateTemplateVariant(variant), [variant]);

  const effectiveSampleContext = useMemo<EmailRenderContext>(() => {
    if (!includeLoyaltySample) return sampleContext;
    return {
      ...sampleContext,
      loyaltyPointsEarned: 450,
      loyaltyPointsBalance: 2150,
      loyaltyTier: "Gold",
    };
  }, [sampleContext, includeLoyaltySample]);

  const liveRendered = useMemo(() => {
    return renderEmailTemplate({
      variant,
      context: effectiveSampleContext,
      settings,
      language,
      usedDefaultLayout: !doc.isCustomized && !dirty,
    });
  }, [variant, effectiveSampleContext, settings, language, doc.isCustomized, dirty]);

  const htmlSizeMetrics = useMemo(
    () => measureEmailHtmlBytes(liveRendered.html),
    [liveRendered.html]
  );

  const resolvedPortalUrl = useMemo(() => {
    if (variant.portalUrlOverride?.trim()) {
      const c = validateEmailUrl(variant.portalUrlOverride.trim());
      if (c.valid && c.normalized) return c.normalized;
    }
    if (settings.portalUrl?.trim()) {
      const c = validateEmailUrl(settings.portalUrl.trim());
      if (c.valid && c.normalized) return c.normalized;
    }
    return appUrl;
  }, [variant.portalUrlOverride, settings.portalUrl, appUrl]);

  const handleSave = async (publish: boolean) => {
    setServerErrors([]);
    if (validationIssues.length > 0) {
      toast.error("Please fix the validation errors before saving.");
      return;
    }

    try {
      setSaving(publish ? "publish" : "draft");
      const res = await emailCustomizationApi.saveTemplate(
        eventType,
        { language, variant, publish, enabled },
        hotelId
      );
      if (res.template) {
        setDoc(res.template);
        setVariantsByLang({
          en: res.template.draft.en || res.template.published.en,
          de: res.template.draft.de || res.template.published.de,
        });
        setDirty(false);
        onDocumentUpdated(res.template);
        toast.success(
          publish
            ? `Published v${res.template.publishedVersion} (${language.toUpperCase()}). Live emails will now use this template.`
            : "Draft saved."
        );
      }
    } catch (err: any) {
      const msgs =
        Array.isArray(err?.issues) && err.issues.length > 0
          ? err.issues.map((i: any) => i.message)
          : [err?.message || "Failed to save template."];
      setServerErrors(msgs);
    } finally {
      setSaving(null);
    }
  };

  const handleSendTest = async () => {
    setServerErrors([]);
    if (validationIssues.length > 0) {
      toast.error("Fix validation errors before sending a test email.");
      return;
    }
    try {
      setTesting(true);
      const res = await emailCustomizationApi.sendTestEmail(
        eventType,
        { language, variant, includeLoyaltySample },
        hotelId
      );
      toast.success(`Test email sent to ${res.sentTo}`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to send test email.");
    } finally {
      setTesting(false);
    }
  };

  const handleReset = async () => {
    try {
      setResetting(true);
      const res = await emailCustomizationApi.resetTemplate(eventType, hotelId);
      if (res.template) {
        setDoc(res.template);
        setVariantsByLang({
          en: res.template.draft.en || res.template.published.en,
          de: res.template.draft.de || res.template.published.de,
        });
        setDirty(false);
        onDocumentUpdated(res.template);
        toast.success("Template reset to the default layout.");
      }
      setResetConfirmOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "Failed to reset template.");
    } finally {
      setResetting(false);
    }
  };

  const handleRestore = async (version: number) => {
    try {
      setRestoring(version);
      const res = await emailCustomizationApi.restoreVersion(eventType, version, hotelId);
      if (res.template) {
        setDoc(res.template);
        setVariantsByLang({
          en: res.template.draft.en || res.template.published.en,
          de: res.template.draft.de || res.template.published.de,
        });
        setDirty(false);
        onDocumentUpdated(res.template);
        setHistoryOpen(false);
        toast.success(`Restored version v${version} as v${res.template.publishedVersion}.`);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to restore version.");
    } finally {
      setRestoring(null);
    }
  };

  const handleApplyStarterPreset = (
    presetId: StarterLayoutPresetId,
    applyBothLanguages: boolean
  ) => {
    const brandingOverrides = {
      primaryColor: sampleContext.hotelPrimaryColor || variant.branding.primaryColor,
      secondaryColor: sampleContext.hotelSecondaryColor || variant.branding.secondaryColor,
      logoUrl: variant.branding.logoUrl,
      logoImageId: variant.branding.logoImageId,
      logoAlt: variant.branding.logoAlt,
    };

    const nextEn = buildStarterPresetVariant(
      presetId,
      eventType,
      "en",
      appUrl,
      brandingOverrides
    );
    const nextDe = buildStarterPresetVariant(
      presetId,
      eventType,
      "de",
      appUrl,
      brandingOverrides
    );

    setVariantsByLang((prev) => {
      if (applyBothLanguages) {
        return { en: nextEn, de: nextDe };
      }
      return {
        ...prev,
        [language]: language === "de" ? nextDe : nextEn,
      };
    });

    const activePreset = language === "de" ? nextDe : nextEn;
    setExpandedBlockId(activePreset.blocks[0]?.id || null);
    setDirty(true);
    setServerErrors([]);

    const presetMeta = STARTER_LAYOUT_PRESETS.find((p) => p.id === presetId);
    toast.success(
      `Applied "${presetMeta?.name || presetId}" to your draft only. Review and click Publish when ready.`
    );
  };

  const updateBlock = (blockId: string, fn: (b: EmailBlock) => EmailBlock) => {
    updateVariant((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === blockId ? fn(b) : b)),
    }));
  };

  const moveBlock = (index: number, delta: -1 | 1) => {
    updateVariant((prev) => {
      const nextIdx = index + delta;
      if (nextIdx < 0 || nextIdx >= prev.blocks.length) return prev;
      const copy = [...prev.blocks];
      const [item] = copy.splice(index, 1);
      copy.splice(nextIdx, 0, item);
      return { ...prev, blocks: copy };
    });
  };

  const reorderBlock = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    updateVariant((prev) => {
      if (fromIndex >= prev.blocks.length || toIndex >= prev.blocks.length) return prev;
      const copy = [...prev.blocks];
      const [moved] = copy.splice(fromIndex, 1);
      copy.splice(toIndex, 0, moved);
      return { ...prev, blocks: copy };
    });
  };

  const duplicateBlock = (index: number) => {
    const source = variant.blocks[index];
    if (!source) return;
    const cloned: EmailBlock = { ...JSON.parse(JSON.stringify(source)), id: makeId("blk") };
    updateVariant((prev) => {
      const copy = [...prev.blocks];
      copy.splice(index + 1, 0, cloned);
      return { ...prev, blocks: copy };
    });
    setExpandedBlockId(cloned.id);
  };

  const removeBlock = (blockId: string) => {
    updateVariant((prev) => ({
      ...prev,
      blocks: prev.blocks.filter((b) => b.id !== blockId),
    }));
    if (expandedBlockId === blockId) {
      setExpandedBlockId(null);
    }
  };

  const addBlock = (type: EmailBlockType) => {
    const newBlock = createEmailBlock(type, appUrl);
    const upgradesToV2 = MODERN_BLOCK_SET.has(type);
    updateVariant((prev) => {
      const nextSchema = upgradesToV2 ? 2 : prev.schemaVersion;
      const last = prev.blocks[prev.blocks.length - 1];
      if (
        (last?.type === "footer" || last?.type === "legal_section") &&
        type !== "footer" &&
        type !== "legal_section" &&
        type !== "footer_nav"
      ) {
        return {
          ...prev,
          ...(nextSchema ? { schemaVersion: nextSchema } : {}),
          blocks: [...prev.blocks.slice(0, -1), newBlock, last],
        };
      }
      return {
        ...prev,
        ...(nextSchema ? { schemaVersion: nextSchema } : {}),
        blocks: [...prev.blocks, newBlock],
      };
    });
    setExpandedBlockId(newBlock.id);
    if (type === "image") {
      setImagePickerTarget({
        kind: "block",
        blockId: newBlock.id,
        field: "src",
        removeIfEmptyOnClose: true,
      });
    }
  };

  const addOptionalSection = (presetId: string) => {
    const preset = OPTIONAL_SECTION_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const cloned = preset
      .createBlocks()
      .map((b) => ({ ...JSON.parse(JSON.stringify(b)), id: makeId("blk") }));
    updateVariant((prev) => {
      const last = prev.blocks[prev.blocks.length - 1];
      if (last?.type === "footer" || last?.type === "legal_section") {
        return { ...prev, blocks: [...prev.blocks.slice(0, -1), ...cloned, last] };
      }
      return { ...prev, blocks: [...prev.blocks, ...cloned] };
    });
    if (cloned[0]?.id) setExpandedBlockId(cloned[0].id);
    toast.success(`Added "${preset.label}" section.`);
  };

  const handleImagePicked = (img: EmailImageAsset) => {
    if (!imagePickerTarget) return;
    if (imagePickerTarget.kind === "logo") {
      updateVariant((prev) => ({
        ...prev,
        branding: {
          ...prev.branding,
          showLogo: true,
          logoUrl: img.url,
          logoImageId: img.id,
          logoAlt: prev.branding.logoAlt || img.label || "{{hotel_name}}",
        },
      }));
    } else {
      updateBlock(imagePickerTarget.blockId, (b) =>
        applyImageAssetToEmailBlock(b, imagePickerTarget.field, img)
      );
    }
    setImagePickerTarget(null);
  };

  const handleCloseImagePicker = () => {
    if (
      imagePickerTarget &&
      imagePickerTarget.kind === "block" &&
      imagePickerTarget.removeIfEmptyOnClose
    ) {
      const targetBlock = variant.blocks.find((b) => b.id === imagePickerTarget.blockId);
      if (targetBlock && targetBlock.type === "image" && !targetBlock.src.trim()) {
        removeBlock(imagePickerTarget.blockId);
      }
    }
    setImagePickerTarget(null);
  };

  const triggerDirectBlockImageUpload = (blockId: string, field = "src") => {
    directUploadTargetRef.current = { blockId, field };
    directFileInputRef.current?.click();
  };

  const handleDirectBlockFileSelected = (file: File) => {
    const target = directUploadTargetRef.current;
    if (!target) return;
    const hasAllowedExt = /\.(png|jpe?g|webp|gif)$/i.test(file.name || "");
    const allowedMime = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
    if (file.type ? !allowedMime.has(file.type) : !hasAllowedExt) {
      toast.error("Only PNG, JPEG, WebP, and GIF images are supported.");
      return;
    }
    const isGif = file.type === "image/gif" || /\.gif$/i.test(file.name || "");
    if (isGif && file.size > 2 * 1024 * 1024) {
      toast.error(
        "GIF exceeds 2 MB. Trim frames, reduce dimensions to <= 640px wide, or lower colors and try again."
      );
      return;
    }
    if (!isGif && file.size > 4 * 1024 * 1024) {
      toast.error("File is too large. Please upload an image under 2 MB.");
      return;
    }

    const key = `${target.blockId}:${target.field}`;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setUploadingKey(key);
        const base64Data = String(reader.result || "");
        const defaultLabel = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Hotel Image";
        const res = await emailCustomizationApi.uploadImage(base64Data, defaultLabel, hotelId);
        if (res.image) {
          const uploaded = res.image;
          updateBlock(target.blockId, (b) =>
            applyImageAssetToEmailBlock(b, target.field, uploaded)
          );
          toast.success(
            uploaded.isAnimated
              ? `Animated GIF uploaded (${uploaded.frameCount || 1} frames) and inserted.`
              : "Image uploaded and inserted into block."
          );
        }
      } catch (err: any) {
        toast.error(err?.message || "Image upload failed.");
      } finally {
        setUploadingKey(null);
        directUploadTargetRef.current = null;
      }
    };
    reader.onerror = () => {
      toast.error("Could not read the selected image file.");
    };
    reader.readAsDataURL(file);
  };

  const copyVariableTag = (varName: string) => {
    const tag = `{{${varName}}}`;
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(tag);
      toast.success(`Copied ${tag} — paste into any text field`);
    }
  };

  const inputClass =
    "w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors";

  return (
    <div className="space-y-4">
      {/* Top Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => (dirty ? setLeaveConfirmOpen(true) : onBack())}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs text-zinc-300 whitespace-nowrap"
          >
            <ArrowLeft size={14} /> Templates
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-zinc-100 truncate">{eventName}</h2>
              <span className="text-xs text-zinc-400 tabular-nums">
                {doc.isCustomized ? `Customized · v${doc.publishedVersion}` : "Default"}
                {dirty ? " · Unsaved changes" : ""}
              </span>
            </div>
            <p className="text-xs text-zinc-500 truncate">{eventDescription}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Language Switcher */}
          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
            {SUPPORTED_EMAIL_LANGUAGES.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => setLanguage(l.code)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  language === l.code
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setStarterPickerOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-xs font-medium text-emerald-300 whitespace-nowrap"
          >
            <LayoutTemplate size={13} /> Start from a Layout
          </button>

          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-zinc-300 whitespace-nowrap"
          >
            <History size={13} /> History ({doc.versions.length})
          </button>

          <button
            type="button"
            onClick={() => setResetConfirmOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-zinc-300 whitespace-nowrap"
          >
            <RotateCcw size={13} /> Reset
          </button>

          <button
            type="button"
            disabled={testing}
            onClick={() => void handleSendTest()}
            title={`Sends a sample email only to ${callerEmail || "your admin email"}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-xs font-medium text-zinc-200 whitespace-nowrap"
          >
            <Send size={13} /> {testing ? "Sending..." : "Send Test to Me"}
          </button>

          <button
            type="button"
            disabled={saving !== null}
            onClick={() => void handleSave(false)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-xs font-semibold text-zinc-100 whitespace-nowrap"
          >
            <Save size={13} /> {saving === "draft" ? "Saving..." : "Save Draft"}
          </button>

          <button
            type="button"
            disabled={saving !== null}
            onClick={() => void handleSave(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white whitespace-nowrap"
          >
            <Upload size={13} /> {saving === "publish" ? "Publishing..." : "Publish"}
          </button>
        </div>
      </div>

      {/* Hidden direct file input for instant one-click image/GIF upload */}
      <input
        ref={directFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleDirectBlockFileSelected(f);
          e.target.value = "";
        }}
      />

      {/* Inline Validation Issues */}
      {(validationIssues.length > 0 || serverErrors.length > 0) && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 space-y-2">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertCircle size={14} /> Template validation errors:
          </div>
          <ul className="list-disc pl-5 space-y-1.5">
            {serverErrors.length > 0
              ? serverErrors.slice(0, 6).map((msg, idx) => <li key={idx}>{msg}</li>)
              : validationIssues.slice(0, 6).map((issue, idx) => {
                  const imgMatch = issue.path.match(
                    /^blocks\[(\d+)\]\.(src|imageUrl|logoUrl|footerLogoUrl)$/
                  );
                  const imgBlockIdx = imgMatch ? Number(imgMatch[1]) : -1;
                  const imgField = imgMatch ? imgMatch[2] : "src";
                  const targetBlock =
                    imgBlockIdx >= 0 ? variant.blocks[imgBlockIdx] || null : null;
                  const key = targetBlock ? `${targetBlock.id}:${imgField}` : "";
                  return (
                    <li key={idx} className="leading-relaxed">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{issue.message}</span>
                        {targetBlock && (
                          <span className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={uploadingKey === key}
                              onClick={() =>
                                triggerDirectBlockImageUpload(targetBlock.id, imgField)
                              }
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium whitespace-nowrap"
                            >
                              {uploadingKey === key ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <Upload size={11} />
                              )}
                              Upload Image / GIF
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setImagePickerTarget({
                                  kind: "block",
                                  blockId: targetBlock.id,
                                  field: imgField,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[11px] font-medium whitespace-nowrap"
                            >
                              <ImageIcon size={11} /> Pick from Library
                            </button>
                            <button
                              type="button"
                              onClick={() => removeBlock(targetBlock.id)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-red-500/40 hover:bg-red-500/20 text-red-200 text-[11px] font-medium whitespace-nowrap"
                            >
                              <Trash2 size={11} /> Remove Block
                            </button>
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
          </ul>
        </div>
      )}

      {/* Split Workspace: Left Editor / Right Live Sandboxed Preview */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* LEFT PANE: Metadata, Branding, and Modular BlockEditor */}
        <div className="xl:col-span-6 space-y-4">
          {/* Enable Toggle + Subject + Preheader */}
          <div className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-zinc-800/80">
              <div>
                <div className="text-xs font-semibold text-zinc-200">
                  Automatic Email Sending
                </div>
                <div className="text-[11px] text-zinc-500">
                  Turn off to skip sending this email event for your hotel.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => {
                  setEnabled((prev) => !prev);
                  setDirty(true);
                }}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  enabled ? "bg-emerald-600" : "bg-zinc-700"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    enabled ? "translate-x-4.5" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-zinc-300">Subject Line</label>
                <button
                  type="button"
                  onClick={() => setVariablesOpen((v) => !v)}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 font-medium"
                >
                  {variablesOpen ? "Hide Merge Variables" : "Browse Merge Variables"}
                </button>
              </div>
              <input
                type="text"
                maxLength={180}
                value={variant.subject}
                onChange={(e) =>
                  updateVariant((prev) => ({ ...prev, subject: e.target.value }))
                }
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Preheader Text (Inbox preview snippet)
              </label>
              <input
                type="text"
                maxLength={220}
                value={variant.preheader}
                onChange={(e) =>
                  updateVariant((prev) => ({ ...prev, preheader: e.target.value }))
                }
                placeholder="Short summary shown next to the subject line in guest inboxes"
                className={inputClass}
              />
            </div>

            {variablesOpen && (
              <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-3 space-y-2">
                <div className="text-[11px] text-zinc-400">
                  Click any allowed variable to copy it. Unknown variables or code syntax are
                  blocked automatically.
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {ALLOWED_TEMPLATE_VARIABLES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => copyVariableTag(v)}
                      title={`${VARIABLE_DESCRIPTIONS[v].label} (e.g. ${VARIABLE_DESCRIPTIONS[v].sample})`}
                      className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] font-mono text-emerald-400 transition-colors"
                    >
                      {`{{${v}}}`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Collapsible Branding & Header Controls */}
          <div className="rounded-xl bg-zinc-900/60 border border-zinc-800 overflow-hidden">
            <button
              type="button"
              onClick={() => setBrandingOpen((o) => !o)}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-zinc-900/80 transition-colors"
            >
              <div>
                <div className="text-xs font-semibold text-zinc-200">
                  Branding, Colors, Font, Logo &amp; Portal URL
                </div>
                <div className="text-[11px] text-zinc-500">
                  Top accent bar, eyebrow text, button colors, web-safe font, logo image, and
                  link override
                </div>
              </div>
              {brandingOpen ? (
                <ChevronDown size={15} className="text-zinc-400" />
              ) : (
                <ChevronRight size={15} className="text-zinc-400" />
              )}
            </button>

            {brandingOpen && (
              <div className="p-4 pt-2 border-t border-zinc-800/80 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Primary Color</label>
                    <input
                      type="color"
                      value={variant.branding.primaryColor}
                      onChange={(e) =>
                        updateVariant((prev) => ({
                          ...prev,
                          branding: { ...prev.branding, primaryColor: e.target.value },
                        }))
                      }
                      className="w-full h-8 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Accent Bar</label>
                    <input
                      type="color"
                      value={variant.branding.accentBarColor}
                      onChange={(e) =>
                        updateVariant((prev) => ({
                          ...prev,
                          branding: { ...prev.branding, accentBarColor: e.target.value },
                        }))
                      }
                      className="w-full h-8 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Button Color</label>
                    <input
                      type="color"
                      value={variant.branding.buttonColor}
                      onChange={(e) =>
                        updateVariant((prev) => ({
                          ...prev,
                          branding: { ...prev.branding, buttonColor: e.target.value },
                        }))
                      }
                      className="w-full h-8 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Secondary Color
                    </label>
                    <input
                      type="color"
                      value={variant.branding.secondaryColor}
                      onChange={(e) =>
                        updateVariant((prev) => ({
                          ...prev,
                          branding: { ...prev.branding, secondaryColor: e.target.value },
                        }))
                      }
                      className="w-full h-8 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Web-Safe Font</label>
                    <select
                      value={variant.branding.fontFamily}
                      onChange={(e) =>
                        updateVariant((prev) => ({
                          ...prev,
                          branding: {
                            ...prev.branding,
                            fontFamily: e.target.value as WebSafeFontId,
                          },
                        }))
                      }
                      className={inputClass}
                    >
                      {WEB_SAFE_FONTS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Eyebrow Label (above heading)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={variant.branding.showEyebrow}
                        onChange={(e) =>
                          updateVariant((prev) => ({
                            ...prev,
                            branding: { ...prev.branding, showEyebrow: e.target.checked },
                          }))
                        }
                        className="rounded border-zinc-700 bg-zinc-950"
                      />
                      <input
                        type="text"
                        value={variant.branding.eyebrowText}
                        onChange={(e) =>
                          updateVariant((prev) => ({
                            ...prev,
                            branding: { ...prev.branding, eyebrowText: e.target.value },
                          }))
                        }
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-800/70">
                  <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={variant.branding.accentBarEnabled}
                      onChange={(e) =>
                        updateVariant((prev) => ({
                          ...prev,
                          branding: { ...prev.branding, accentBarEnabled: e.target.checked },
                        }))
                      }
                    />
                    Show top accent bar ({variant.branding.accentBarThicknessPx}px)
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={variant.branding.showLogo}
                        onChange={(e) =>
                          updateVariant((prev) => ({
                            ...prev,
                            branding: { ...prev.branding, showLogo: e.target.checked },
                          }))
                        }
                      />
                      Show Logo
                    </label>
                    <button
                      type="button"
                      onClick={() => setImagePickerTarget({ kind: "logo" })}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 whitespace-nowrap"
                    >
                      <ImageIcon size={12} /> Choose Logo
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Template Portal URL Override (Optional, HTTPS)
                  </label>
                  <input
                    type="url"
                    value={variant.portalUrlOverride || ""}
                    onChange={(e) =>
                      updateVariant((prev) => ({ ...prev, portalUrlOverride: e.target.value }))
                    }
                    placeholder={settings.portalUrl || sampleContext.appUrl}
                    className={inputClass}
                  />
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Active <span className="font-mono">{"{{portal_link}}"}</span>:{" "}
                    <span className="text-emerald-400 font-mono">{resolvedPortalUrl}</span>
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Modular Visual Block Editor (Palette, Drag-and-Drop Grouping & Configuration Panels) */}
          <BlockEditor
            blocks={variant.blocks}
            appUrl={appUrl}
            resolvedPortalUrl={resolvedPortalUrl}
            validationIssues={validationIssues}
            expandedBlockId={expandedBlockId}
            onExpandBlock={setExpandedBlockId}
            onAddBlock={addBlock}
            onAddOptionalSection={addOptionalSection}
            onUpdateBlock={updateBlock}
            onMoveBlock={moveBlock}
            onReorderBlock={reorderBlock}
            onDuplicateBlock={duplicateBlock}
            onRemoveBlock={removeBlock}
            imageActions={{
              onPickLibrary: (blockId, field) =>
                setImagePickerTarget({ kind: "block", blockId, field }),
              onDirectUpload: (blockId, field) =>
                triggerDirectBlockImageUpload(blockId, field),
              uploadingKey,
            }}
          />
        </div>

        {/* RIGHT PANE: Sandboxed Live Preview */}
        <div className="xl:col-span-6 xl:sticky xl:top-4 space-y-3">
          <div className="rounded-xl bg-zinc-900/60 border border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-200">Live Preview</span>
                <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
                  <button
                    type="button"
                    onClick={() => setPreviewMode("desktop")}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium ${
                      previewMode === "desktop"
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    <Monitor size={12} /> Desktop
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode("mobile")}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium ${
                      previewMode === "mobile"
                        ? "bg-zinc-800 text-zinc-100"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    <Smartphone size={12} /> Mobile
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {/* HTML Size Meter (Gmail 102 KB Clipping Guard) */}
                <span
                  title="Gmail clips HTML emails over 102 KB. Keep templates under 90 KB."
                  className={`text-[11px] font-mono tabular-nums ${
                    htmlSizeMetrics.status === "over"
                      ? "text-red-400 font-semibold"
                      : htmlSizeMetrics.status === "warning"
                      ? "text-amber-400 font-semibold"
                      : "text-zinc-400"
                  }`}
                >
                  {htmlSizeMetrics.kb.toFixed(1)} KB / 90 KB
                </span>

                <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeLoyaltySample}
                    onChange={(e) => setIncludeLoyaltySample(e.target.checked)}
                  />
                  <Sparkles size={12} className="text-amber-400" />
                  Sample Loyalty
                </label>
              </div>
            </div>

            {/* HTML Size Warning Banner when > 80 KB */}
            {htmlSizeMetrics.status !== "ok" && (
              <div
                className={`px-4 py-2 border-b text-[11px] flex items-center gap-2 ${
                  htmlSizeMetrics.status === "over"
                    ? "bg-red-500/10 border-red-500/30 text-red-300"
                    : "bg-amber-500/10 border-amber-500/30 text-amber-300"
                }`}
              >
                <AlertTriangle size={13} className="shrink-0" />
                <span>
                  {htmlSizeMetrics.status === "over"
                    ? `Rendered HTML is ${htmlSizeMetrics.kb.toFixed(1)} KB (over 90 KB ceiling). Remove or shorten a few blocks so Gmail does not clip the footer.`
                    : `Rendered HTML is ${htmlSizeMetrics.kb.toFixed(1)} KB. Approaching Gmail's 102 KB clipping threshold.`}
                </span>
              </div>
            )}

            {/* Simulated Inbox Envelope */}
            <div className="px-4 py-2.5 bg-zinc-950/70 border-b border-zinc-800 text-xs space-y-1">
              <div className="flex gap-2">
                <span className="text-zinc-500 w-16 shrink-0">From:</span>
                <span className="text-zinc-300 truncate">{liveRendered.fromName}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-zinc-500 w-16 shrink-0">Subject:</span>
                <span className="text-zinc-100 font-medium truncate">{liveRendered.subject}</span>
              </div>
              {liveRendered.preheader && (
                <div className="flex gap-2">
                  <span className="text-zinc-500 w-16 shrink-0">Preview:</span>
                  <span className="text-zinc-400 truncate">{liveRendered.preheader}</span>
                </div>
              )}
            </div>

            {/* Strictly Sandboxed iframe (no scripts, no same-origin access) */}
            <div className="bg-zinc-950 p-4 flex justify-center overflow-x-auto">
              <iframe
                title="Live email template preview"
                sandbox=""
                srcDoc={liveRendered.html}
                className="bg-white rounded-lg border border-zinc-800 transition-all"
                style={{
                  width: previewMode === "mobile" ? "375px" : "100%",
                  maxWidth: "660px",
                  height: "660px",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Starter Layout Preset Picker Modal (Draft-only) */}
      {starterPickerOpen && (
        <StarterLayoutPickerModal
          language={language}
          onApplyPreset={handleApplyStarterPreset}
          onClose={() => setStarterPickerOpen(false)}
        />
      )}

      {/* Image Library Picker Modal */}
      {imagePickerTarget && (
        <ImageLibraryPanel
          hotelId={hotelId}
          mode="picker"
          selectedUrl={
            imagePickerTarget.kind === "logo" ? variant.branding.logoUrl : undefined
          }
          onSelect={handleImagePicked}
          onClose={handleCloseImagePicker}
        />
      )}

      {/* Version History Modal */}
      {historyOpen && (
        <div className="fixed inset-0 z-[95] bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl bg-zinc-950 border border-zinc-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">Published Version History</h3>
                <p className="text-xs text-zinc-500">
                  Last 10 published snapshots. Restore any version in one click.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              >
                <X size={16} />
              </button>
            </div>

            {doc.versions.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500">
                No published custom versions yet. Publish changes to create v1.
              </div>
            ) : (
              <div className="divide-y divide-zinc-800 max-h-80 overflow-y-auto border border-zinc-800 rounded-lg">
                {doc.versions.map((ver) => (
                  <div
                    key={ver.version}
                    className="p-3 flex items-center justify-between gap-3 bg-zinc-900/40"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-zinc-200 tabular-nums">
                        Version v{ver.version}
                        {ver.version === doc.publishedVersion ? " · Current" : ""}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">
                        {new Date(ver.savedAt).toLocaleString()} · {ver.savedBy}
                      </div>
                      {ver.note && (
                        <div className="text-[11px] text-zinc-400 mt-0.5">{ver.note}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={restoring === ver.version}
                      onClick={() => void handleRestore(ver.version)}
                      className="px-2.5 py-1 rounded-lg border border-zinc-700 hover:bg-zinc-800 text-xs font-medium text-zinc-200 whitespace-nowrap"
                    >
                      {restoring === ver.version ? "Restoring..." : "Restore"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reset to Default Confirmation */}
      {resetConfirmOpen && (
        <div className="fixed inset-0 z-[95] bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-zinc-950 border border-zinc-800 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Reset template to default?</h3>
              <p className="text-xs text-zinc-400 mt-1">
                This restores the standard PMS email design and copy for{" "}
                <span className="text-zinc-200 font-medium">{eventName}</span>. Your prior
                published versions remain available in History.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetConfirmOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-zinc-800 text-xs text-zinc-300 hover:bg-zinc-900"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resetting}
                onClick={() => void handleReset()}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white whitespace-nowrap"
              >
                {resetting ? "Resetting..." : "Reset to Default"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved Changes Leave Confirmation */}
      {leaveConfirmOpen && (
        <div className="fixed inset-0 z-[95] bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-zinc-950 border border-zinc-800 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Discard unsaved changes?</h3>
              <p className="text-xs text-zinc-400 mt-1">
                You have unsaved edits in this template. Save a draft first or discard your
                changes.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLeaveConfirmOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-zinc-800 text-xs text-zinc-300 hover:bg-zinc-900"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={() => {
                  setLeaveConfirmOpen(false);
                  onBack();
                }}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white"
              >
                Discard &amp; Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
