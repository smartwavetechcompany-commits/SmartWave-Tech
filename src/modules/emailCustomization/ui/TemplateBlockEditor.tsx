import React, { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  History,
  Image as ImageIcon,
  Loader2,
  Monitor,
  Plus,
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
  SUPPORTED_EMAIL_LANGUAGES,
  VARIABLE_DESCRIPTIONS,
  WEB_SAFE_FONTS,
  type BlockCondition,
  type BookingDetailsRowConfig,
  type CustomizableEmailEventType,
  type EmailBlock,
  type EmailBlockType,
  type EmailImageAsset,
  type EmailRenderContext,
  type EmailTemplateDocument,
  type EmailTemplateVariant,
  type FooterContactField,
  type HotelEmailSettings,
  type SupportedEmailLanguage,
  type WebSafeFontId,
} from "../shared/types";
import { OPTIONAL_SECTION_PRESETS } from "../shared/defaultTemplates";
import { renderEmailTemplate } from "../shared/renderer";
import { validateEmailUrl, validateTemplateVariant } from "../shared/validation";
import { emailCustomizationApi } from "./apiClient";
import { ImageLibraryPanel } from "./ImageLibraryModal";

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

const BLOCK_TYPE_LABELS: Record<EmailBlockType, string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  image: "Image",
  button: "Button / Link",
  divider: "Divider",
  spacer: "Spacer",
  booking_details_table: "Booking Details Table",
  two_column_text: "Two-Column Text",
  social_links: "Social Links",
  footer: "Contact & Footer",
};

const CONDITION_LABELS: Record<BlockCondition, string> = {
  always: "Always show",
  has_loyalty: "Show only if guest has loyalty data",
  has_balance_due: "Show only if balance is due",
  has_deposit: "Show only if deposit/payment exists",
};

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function createNewBlock(type: EmailBlockType): EmailBlock {
  const id = makeId("blk");
  switch (type) {
    case "heading":
      return { id, type: "heading", level: 2, text: "Section Heading", align: "left" };
    case "paragraph":
      return { id, type: "paragraph", text: "Add your message text here.", align: "left", tone: "default" };
    case "image":
      return {
        id,
        type: "image",
        src: "",
        alt: "{{hotel_name}} image",
        widthPx: 540,
        align: "center",
      };
    case "button":
      return {
        id,
        type: "button",
        label: "View Booking Details",
        url: "{{portal_link}}",
        displayStyle: "solid",
        align: "left",
      };
    case "divider":
      return { id, type: "divider", color: "#e4e4e7", thicknessPx: 1 };
    case "spacer":
      return { id, type: "spacer", heightPx: 16 };
    case "booking_details_table":
      return {
        id,
        type: "booking_details_table",
        title: "Reservation Summary",
        rows: [
          { id: makeId("row"), label: "Booking Reference", valueTemplate: "{{booking_reference}}", visible: true },
          { id: makeId("row"), label: "Guest Name", valueTemplate: "{{guest_name}}", visible: true },
          { id: makeId("row"), label: "Room", valueTemplate: "{{room_name}}", visible: true },
          { id: makeId("row"), label: "Check-In", valueTemplate: "{{check_in_date}}", visible: true },
          { id: makeId("row"), label: "Check-Out", valueTemplate: "{{check_out_date}}", visible: true },
        ],
      };
    case "two_column_text":
      return {
        id,
        type: "two_column_text",
        leftTitle: "Check-In",
        leftText: "{{check_in_date}} {{check_in_time}}",
        rightTitle: "Check-Out",
        rightText: "{{check_out_date}} {{check_out_time}}",
      };
    case "social_links":
      return {
        id,
        type: "social_links",
        title: "Connect with us",
        align: "left",
        links: [{ id: makeId("soc"), label: "Website", url: "{{hotel_website}}" }],
      };
    case "footer":
      return {
        id,
        type: "footer",
        showContactBlock: true,
        contactTitle: "{{hotel_name}} Contact",
        fields: [
          { id: makeId("cf"), key: "address", label: "Address", valueTemplate: "{{hotel_address}}", visible: true },
          { id: makeId("cf"), key: "phone", label: "Phone", valueTemplate: "{{hotel_phone}}", visible: true },
          { id: makeId("cf"), key: "email", label: "Email", valueTemplate: "{{hotel_email}}", visible: true },
        ],
      };
  }
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
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [imagePickerTarget, setImagePickerTarget] = useState<
    null | { kind: "logo" } | { kind: "block"; blockId: string; removeIfEmptyOnClose?: boolean }
  >(null);
  const [uploadingBlockId, setUploadingBlockId] = useState<string | null>(null);
  const directUploadBlockIdRef = useRef<string | null>(null);
  const directFileInputRef = useRef<HTMLInputElement | null>(null);

  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
  const [testing, setTesting] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [resetting, setResetting] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  const variant = (variantsByLang[language] || variantsByLang.en)!;

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

  const resolvedPortalUrl = useMemo(() => {
    const cleanApp = (sampleContext.appUrl || "https://tidehotels.de").replace(/\/+$/, "");
    if (variant.portalUrlOverride?.trim()) {
      const c = validateEmailUrl(variant.portalUrlOverride.trim());
      if (c.valid && c.normalized) return c.normalized;
    }
    if (settings.portalUrl?.trim()) {
      const c = validateEmailUrl(settings.portalUrl.trim());
      if (c.valid && c.normalized) return c.normalized;
    }
    return cleanApp;
  }, [variant.portalUrlOverride, settings.portalUrl, sampleContext.appUrl]);

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

  const removeBlock = (blockId: string) => {
    updateVariant((prev) => ({
      ...prev,
      blocks: prev.blocks.filter((b) => b.id !== blockId),
    }));
  };

  const addBlock = (type: EmailBlockType) => {
    const newBlock = createNewBlock(type);
    updateVariant((prev) => {
      // Insert before footer if last block is footer
      const last = prev.blocks[prev.blocks.length - 1];
      if (last?.type === "footer" && type !== "footer") {
        return { ...prev, blocks: [...prev.blocks.slice(0, -1), newBlock, last] };
      }
      return { ...prev, blocks: [...prev.blocks, newBlock] };
    });
    if (type === "image") {
      // Immediately open the picker/uploader so the admin never gets stuck with an empty image URL error
      setImagePickerTarget({ kind: "block", blockId: newBlock.id, removeIfEmptyOnClose: true });
    }
  };

  const addPreset = (presetId: string) => {
    const preset = OPTIONAL_SECTION_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const cloned = preset
      .createBlocks()
      .map((b) => ({ ...JSON.parse(JSON.stringify(b)), id: makeId("blk") }));
    updateVariant((prev) => {
      const last = prev.blocks[prev.blocks.length - 1];
      if (last?.type === "footer") {
        return { ...prev, blocks: [...prev.blocks.slice(0, -1), ...cloned, last] };
      }
      return { ...prev, blocks: [...prev.blocks, ...cloned] };
    });
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
        b.type === "image"
          ? {
              ...b,
              imageId: img.id,
              src: img.url,
              alt: !b.alt || b.alt === "{{hotel_name}} image" ? img.label : b.alt,
            }
          : b
      );
    }
    setImagePickerTarget(null);
  };

  const handleCloseImagePicker = () => {
    if (imagePickerTarget && imagePickerTarget.kind === "block" && imagePickerTarget.removeIfEmptyOnClose) {
      const targetBlock = variant.blocks.find((b) => b.id === imagePickerTarget.blockId);
      if (targetBlock && targetBlock.type === "image" && !targetBlock.src.trim()) {
        removeBlock(imagePickerTarget.blockId);
      }
    }
    setImagePickerTarget(null);
  };

  const triggerDirectBlockImageUpload = (blockId: string) => {
    directUploadBlockIdRef.current = blockId;
    directFileInputRef.current?.click();
  };

  const handleDirectBlockFileSelected = (file: File) => {
    const blockId = directUploadBlockIdRef.current;
    if (!blockId) return;
    const hasAllowedExt = /\.(png|jpe?g|webp)$/i.test(file.name || "");
    const allowedMime = new Set(["image/png", "image/jpeg", "image/webp"]);
    if (file.type ? !allowedMime.has(file.type) : !hasAllowedExt) {
      toast.error("Only PNG, JPEG, and WebP images are supported.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error("File is too large. Please upload a PNG, JPEG, or WebP image under 2 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setUploadingBlockId(blockId);
        const base64Data = String(reader.result || "");
        const defaultLabel = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Hotel Image";
        const res = await emailCustomizationApi.uploadImage(base64Data, defaultLabel, hotelId);
        if (res.image) {
          const uploaded = res.image;
          updateBlock(blockId, (b) =>
            b.type === "image"
              ? {
                  ...b,
                  imageId: uploaded.id,
                  src: uploaded.url,
                  alt: !b.alt || b.alt === "{{hotel_name}} image" ? uploaded.label : b.alt,
                }
              : b
          );
          toast.success("Image uploaded and inserted into block.");
        }
      } catch (err: any) {
        toast.error(err?.message || "Image upload failed.");
      } finally {
        setUploadingBlockId(null);
        directUploadBlockIdRef.current = null;
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

      {/* Hidden direct file input for instant one-click image block upload */}
      <input
        ref={directFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
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
                  const imgMatch = issue.path.match(/^blocks\[(\d+)\]\.src$/);
                  const imgBlockIdx = imgMatch ? Number(imgMatch[1]) : -1;
                  const targetBlock =
                    imgBlockIdx >= 0 && variant.blocks[imgBlockIdx]?.type === "image"
                      ? variant.blocks[imgBlockIdx]
                      : null;
                  return (
                    <li key={idx} className="leading-relaxed">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{issue.message}</span>
                        {targetBlock && (
                          <span className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={uploadingBlockId === targetBlock.id}
                              onClick={() => triggerDirectBlockImageUpload(targetBlock.id)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium whitespace-nowrap"
                            >
                              {uploadingBlockId === targetBlock.id ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <Upload size={11} />
                              )}
                              Upload Image
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setImagePickerTarget({ kind: "block", blockId: targetBlock.id })
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
        {/* LEFT PANE: Editor Controls */}
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
                  Click any allowed variable to copy it. Unknown variables or code syntax are blocked automatically.
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
                  Branding, Colors, Font, Logo & Portal URL
                </div>
                <div className="text-[11px] text-zinc-500">
                  Top accent bar, eyebrow text, button colors, web-safe font, logo image, and link override
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
                    <label className="block text-[11px] text-zinc-400 mb-1">Secondary Color</label>
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

          {/* Reorderable Content Blocks */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                Email Content Blocks ({variant.blocks.length})
              </h3>
              <div className="flex items-center gap-2">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      addPreset(e.target.value);
                      e.target.value = "";
                    }
                  }}
                  className="rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1 text-xs text-emerald-400 focus:outline-none focus:border-emerald-500"
                >
                  <option value="" disabled>
                    + Insert Optional Section...
                  </option>
                  {OPTIONAL_SECTION_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {variant.blocks.map((block, idx) => {
              const blockHasError = validationIssues.some((i) =>
                i.path.startsWith(`blocks[${idx}]`)
              );
              return (
              <div
                key={block.id}
                className={`rounded-xl bg-zinc-900/60 border p-3.5 space-y-2.5 transition-colors ${
                  blockHasError ? "border-red-500/60" : "border-zinc-800"
                }`}
              >
                {/* Block Header Controls */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] font-mono text-zinc-500 tabular-nums">
                      #{idx + 1}
                    </span>
                    <span className="text-xs font-semibold text-zinc-200">
                      {BLOCK_TYPE_LABELS[block.type]}
                    </span>
                    <select
                      value={block.condition || "always"}
                      onChange={(e) =>
                        updateBlock(block.id, (b) => ({
                          ...b,
                          condition: e.target.value as BlockCondition,
                        }))
                      }
                      className="rounded bg-zinc-950 border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 focus:outline-none focus:border-emerald-500"
                    >
                      {(Object.keys(CONDITION_LABELS) as BlockCondition[]).map((c) => (
                        <option key={c} value={c}>
                          {CONDITION_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveBlock(idx, -1)}
                      className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30"
                      aria-label="Move block up"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      disabled={idx === variant.blocks.length - 1}
                      onClick={() => moveBlock(idx, 1)}
                      className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30"
                      aria-label="Move block down"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBlock(block.id)}
                      className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-red-500/10"
                      aria-label="Delete block"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Typed Block Body Controls */}
                {block.type === "heading" && (
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <div className="sm:col-span-3">
                      <input
                        type="text"
                        value={block.text}
                        onChange={(e) =>
                          updateBlock(block.id, (b) =>
                            b.type === "heading" ? { ...b, text: e.target.value } : b
                          )
                        }
                        className={inputClass}
                      />
                    </div>
                    <select
                      value={String(block.level)}
                      onChange={(e) =>
                        updateBlock(block.id, (b) =>
                          b.type === "heading"
                            ? { ...b, level: Number(e.target.value) as 1 | 2 | 3 }
                            : b
                        )
                      }
                      className={inputClass}
                    >
                      <option value="1">H1 (22px)</option>
                      <option value="2">H2 (18px)</option>
                      <option value="3">H3 (15px)</option>
                    </select>
                  </div>
                )}

                {block.type === "paragraph" && (
                  <div className="space-y-2">
                    <textarea
                      rows={3}
                      value={block.text}
                      onChange={(e) =>
                        updateBlock(block.id, (b) =>
                          b.type === "paragraph" ? { ...b, text: e.target.value } : b
                        )
                      }
                      className={inputClass}
                    />
                    <div className="flex items-center gap-2">
                      <select
                        value={block.tone || "default"}
                        onChange={(e) =>
                          updateBlock(block.id, (b) =>
                            b.type === "paragraph"
                              ? { ...b, tone: e.target.value as "default" | "muted" | "accent" }
                              : b
                          )
                        }
                        className="rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-[11px] text-zinc-300"
                      >
                        <option value="default">Standard text</option>
                        <option value="muted">Muted note</option>
                        <option value="accent">Brand highlight</option>
                      </select>
                      <select
                        value={block.align || "left"}
                        onChange={(e) =>
                          updateBlock(block.id, (b) =>
                            b.type === "paragraph"
                              ? { ...b, align: e.target.value as "left" | "center" | "right" }
                              : b
                          )
                        }
                        className="rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-[11px] text-zinc-300"
                      >
                        <option value="left">Align Left</option>
                        <option value="center">Align Center</option>
                        <option value="right">Align Right</option>
                      </select>
                    </div>
                  </div>
                )}

                {block.type === "image" && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={uploadingBlockId === block.id}
                        onClick={() => triggerDirectBlockImageUpload(block.id)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-medium text-white whitespace-nowrap transition-colors"
                      >
                        {uploadingBlockId === block.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Upload size={13} />
                        )}
                        {uploadingBlockId === block.id ? "Uploading..." : "Upload Image"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setImagePickerTarget({ kind: "block", blockId: block.id })}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 whitespace-nowrap"
                      >
                        <ImageIcon size={13} /> Pick from Library
                      </button>
                      <input
                        type="url"
                        value={block.src}
                        onChange={(e) =>
                          updateBlock(block.id, (b) =>
                            b.type === "image" ? { ...b, src: e.target.value } : b
                          )
                        }
                        placeholder="https://... (auto-filled when you upload or pick an image)"
                        className={`${inputClass} flex-1 min-w-[200px]`}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={block.alt}
                        onChange={(e) =>
                          updateBlock(block.id, (b) =>
                            b.type === "image" ? { ...b, alt: e.target.value } : b
                          )
                        }
                        placeholder="Required alt text"
                        className={inputClass}
                      />
                      <input
                        type="number"
                        min={60}
                        max={600}
                        value={block.widthPx}
                        onChange={(e) =>
                          updateBlock(block.id, (b) =>
                            b.type === "image"
                              ? { ...b, widthPx: Math.max(60, Math.min(600, Number(e.target.value) || 300)) }
                              : b
                          )
                        }
                        placeholder="Width px"
                        className={`${inputClass} tabular-nums`}
                      />
                      <input
                        type="url"
                        value={block.linkUrl || ""}
                        onChange={(e) =>
                          updateBlock(block.id, (b) =>
                            b.type === "image" ? { ...b, linkUrl: e.target.value } : b
                          )
                        }
                        placeholder="Optional link URL"
                        className={inputClass}
                      />
                    </div>
                  </div>
                )}

                {block.type === "button" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={block.label}
                      onChange={(e) =>
                        updateBlock(block.id, (b) =>
                          b.type === "button" ? { ...b, label: e.target.value } : b
                        )
                      }
                      placeholder="Button label"
                      className={inputClass}
                    />
                    <input
                      type="text"
                      value={block.url}
                      onChange={(e) =>
                        updateBlock(block.id, (b) =>
                          b.type === "button" ? { ...b, url: e.target.value } : b
                        )
                      }
                      placeholder="{{portal_link}} or https://..."
                      className={inputClass}
                    />
                    <select
                      value={block.displayStyle}
                      onChange={(e) =>
                        updateBlock(block.id, (b) =>
                          b.type === "button"
                            ? {
                                ...b,
                                displayStyle: e.target.value as "solid" | "outline" | "text_link",
                              }
                            : b
                        )
                      }
                      className={inputClass}
                    >
                      <option value="solid">Solid Button</option>
                      <option value="outline">Outline Button</option>
                      <option value="text_link">Inline Text Link</option>
                    </select>
                    <input
                      type="text"
                      value={block.prefixText || ""}
                      onChange={(e) =>
                        updateBlock(block.id, (b) =>
                          b.type === "button" ? { ...b, prefixText: e.target.value } : b
                        )
                      }
                      placeholder="Optional prefix (for inline link, e.g. Hotel Portal)"
                      className={inputClass}
                    />
                  </div>
                )}

                {block.type === "spacer" && (
                  <div className="flex items-center gap-3">
                    <label className="text-[11px] text-zinc-400">Height (px):</label>
                    <input
                      type="number"
                      min={4}
                      max={64}
                      value={block.heightPx}
                      onChange={(e) =>
                        updateBlock(block.id, (b) =>
                          b.type === "spacer"
                            ? { ...b, heightPx: Math.max(4, Math.min(64, Number(e.target.value) || 16)) }
                            : b
                        )
                      }
                      className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs text-zinc-100 tabular-nums"
                    />
                  </div>
                )}

                {block.type === "two_column_text" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        value={block.leftTitle || ""}
                        onChange={(e) =>
                          updateBlock(block.id, (b) =>
                            b.type === "two_column_text" ? { ...b, leftTitle: e.target.value } : b
                          )
                        }
                        placeholder="Left title"
                        className={inputClass}
                      />
                      <textarea
                        rows={2}
                        value={block.leftText}
                        onChange={(e) =>
                          updateBlock(block.id, (b) =>
                            b.type === "two_column_text" ? { ...b, leftText: e.target.value } : b
                          )
                        }
                        className={inputClass}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        value={block.rightTitle || ""}
                        onChange={(e) =>
                          updateBlock(block.id, (b) =>
                            b.type === "two_column_text" ? { ...b, rightTitle: e.target.value } : b
                          )
                        }
                        placeholder="Right title"
                        className={inputClass}
                      />
                      <textarea
                        rows={2}
                        value={block.rightText}
                        onChange={(e) =>
                          updateBlock(block.id, (b) =>
                            b.type === "two_column_text" ? { ...b, rightText: e.target.value } : b
                          )
                        }
                        className={inputClass}
                      />
                    </div>
                  </div>
                )}

                {block.type === "booking_details_table" && (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={block.title || ""}
                      onChange={(e) =>
                        updateBlock(block.id, (b) =>
                          b.type === "booking_details_table" ? { ...b, title: e.target.value } : b
                        )
                      }
                      placeholder="Optional table title (leave blank for default)"
                      className={inputClass}
                    />
                    <div className="space-y-1.5">
                      {block.rows.map((row: BookingDetailsRowConfig, rIdx: number) => (
                        <div key={row.id} className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              updateBlock(block.id, (b) =>
                                b.type === "booking_details_table"
                                  ? {
                                      ...b,
                                      rows: b.rows.map((r) =>
                                        r.id === row.id ? { ...r, visible: !r.visible } : r
                                      ),
                                    }
                                  : b
                              )
                            }
                            className={`p-1.5 rounded border ${
                              row.visible
                                ? "border-zinc-700 text-emerald-400"
                                : "border-zinc-800 text-zinc-600"
                            }`}
                            title={row.visible ? "Hide row" : "Show row"}
                          >
                            {row.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                          </button>
                          <input
                            type="text"
                            value={row.label}
                            onChange={(e) =>
                              updateBlock(block.id, (b) =>
                                b.type === "booking_details_table"
                                  ? {
                                      ...b,
                                      rows: b.rows.map((r) =>
                                        r.id === row.id ? { ...r, label: e.target.value } : r
                                      ),
                                    }
                                  : b
                              )
                            }
                            placeholder="Label"
                            className={`${inputClass} w-1/3`}
                          />
                          <input
                            type="text"
                            value={row.valueTemplate}
                            onChange={(e) =>
                              updateBlock(block.id, (b) =>
                                b.type === "booking_details_table"
                                  ? {
                                      ...b,
                                      rows: b.rows.map((r) =>
                                        r.id === row.id ? { ...r, valueTemplate: e.target.value } : r
                                      ),
                                    }
                                  : b
                              )
                            }
                            placeholder="{{variable}}"
                            className={`${inputClass} flex-1 font-mono`}
                          />
                          <button
                            type="button"
                            disabled={rIdx === 0}
                            onClick={() =>
                              updateBlock(block.id, (b) => {
                                if (b.type !== "booking_details_table") return b;
                                const copy = [...b.rows];
                                const [m] = copy.splice(rIdx, 1);
                                copy.splice(rIdx - 1, 0, m);
                                return { ...b, rows: copy };
                              })
                            }
                            className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
                            aria-label="Move row up"
                          >
                            <ArrowUp size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateBlock(block.id, (b) =>
                                b.type === "booking_details_table"
                                  ? { ...b, rows: b.rows.filter((r) => r.id !== row.id) }
                                  : b
                              )
                            }
                            className="p-1 text-zinc-500 hover:text-red-400"
                            aria-label="Remove row"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateBlock(block.id, (b) =>
                          b.type === "booking_details_table"
                            ? {
                                ...b,
                                rows: [
                                  ...b.rows,
                                  {
                                    id: makeId("row"),
                                    label: "New Row",
                                    valueTemplate: "{{room_type}}",
                                    visible: true,
                                  },
                                ],
                              }
                            : b
                        )
                      }
                      className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium"
                    >
                      <Plus size={12} /> Add Table Row
                    </button>
                  </div>
                )}

                {block.type === "social_links" && (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={block.title || ""}
                      onChange={(e) =>
                        updateBlock(block.id, (b) =>
                          b.type === "social_links" ? { ...b, title: e.target.value } : b
                        )
                      }
                      placeholder="Section title"
                      className={inputClass}
                    />
                    {block.links.map((link) => (
                      <div key={link.id} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={link.label}
                          onChange={(e) =>
                            updateBlock(block.id, (b) =>
                              b.type === "social_links"
                                ? {
                                    ...b,
                                    links: b.links.map((l) =>
                                      l.id === link.id ? { ...l, label: e.target.value } : l
                                    ),
                                  }
                                : b
                            )
                          }
                          placeholder="Label (e.g. Instagram)"
                          className={`${inputClass} w-1/3`}
                        />
                        <input
                          type="text"
                          value={link.url}
                          onChange={(e) =>
                            updateBlock(block.id, (b) =>
                              b.type === "social_links"
                                ? {
                                    ...b,
                                    links: b.links.map((l) =>
                                      l.id === link.id ? { ...l, url: e.target.value } : l
                                    ),
                                  }
                                : b
                            )
                          }
                          placeholder="https://..."
                          className={`${inputClass} flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateBlock(block.id, (b) =>
                              b.type === "social_links"
                                ? { ...b, links: b.links.filter((l) => l.id !== link.id) }
                                : b
                            )
                          }
                          className="p-1 text-zinc-500 hover:text-red-400"
                          aria-label="Remove social link"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        updateBlock(block.id, (b) =>
                          b.type === "social_links"
                            ? {
                                ...b,
                                links: [
                                  ...b.links,
                                  { id: makeId("soc"), label: "Website", url: "{{hotel_website}}" },
                                ],
                              }
                            : b
                        )
                      }
                      className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium"
                    >
                      <Plus size={12} /> Add Link
                    </button>
                  </div>
                )}

                {block.type === "footer" && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={block.showContactBlock}
                          onChange={(e) =>
                            updateBlock(block.id, (b) =>
                              b.type === "footer"
                                ? { ...b, showContactBlock: e.target.checked }
                                : b
                            )
                          }
                        />
                        Show Hotel Contact Block
                      </label>
                    </div>

                    {block.showContactBlock && (
                      <>
                        <input
                          type="text"
                          value={block.contactTitle}
                          onChange={(e) =>
                            updateBlock(block.id, (b) =>
                              b.type === "footer" ? { ...b, contactTitle: e.target.value } : b
                            )
                          }
                          placeholder="Contact block heading"
                          className={inputClass}
                        />
                        <div className="space-y-1.5">
                          {block.fields.map((f: FooterContactField, fIdx: number) => (
                            <div key={f.id} className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  updateBlock(block.id, (b) =>
                                    b.type === "footer"
                                      ? {
                                          ...b,
                                          fields: b.fields.map((x) =>
                                            x.id === f.id ? { ...x, visible: !x.visible } : x
                                          ),
                                        }
                                      : b
                                  )
                                }
                                className={`p-1.5 rounded border ${
                                  f.visible
                                    ? "border-zinc-700 text-emerald-400"
                                    : "border-zinc-800 text-zinc-600"
                                }`}
                              >
                                {f.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                              </button>
                              <input
                                type="text"
                                value={f.label}
                                onChange={(e) =>
                                  updateBlock(block.id, (b) =>
                                    b.type === "footer"
                                      ? {
                                          ...b,
                                          fields: b.fields.map((x) =>
                                            x.id === f.id ? { ...x, label: e.target.value } : x
                                          ),
                                        }
                                      : b
                                  )
                                }
                                className={`${inputClass} w-1/3`}
                              />
                              <input
                                type="text"
                                value={f.valueTemplate}
                                onChange={(e) =>
                                  updateBlock(block.id, (b) =>
                                    b.type === "footer"
                                      ? {
                                          ...b,
                                          fields: b.fields.map((x) =>
                                            x.id === f.id
                                              ? { ...x, valueTemplate: e.target.value }
                                              : x
                                          ),
                                        }
                                      : b
                                  )
                                }
                                className={`${inputClass} flex-1 font-mono`}
                              />
                              <button
                                type="button"
                                disabled={fIdx === 0}
                                onClick={() =>
                                  updateBlock(block.id, (b) => {
                                    if (b.type !== "footer") return b;
                                    const copy = [...b.fields];
                                    const [m] = copy.splice(fIdx, 1);
                                    copy.splice(fIdx - 1, 0, m);
                                    return { ...b, fields: copy };
                                  })
                                }
                                className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
                              >
                                <ArrowUp size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    <textarea
                      rows={2}
                      value={block.legalImprintText || ""}
                      onChange={(e) =>
                        updateBlock(block.id, (b) =>
                          b.type === "footer" ? { ...b, legalImprintText: e.target.value } : b
                        )
                      }
                      placeholder="Optional legal/imprint text for this template (defaults to Hotel Email Settings imprint)"
                      className={inputClass}
                    />
                  </div>
                )}
              </div>
              );
            })}

            {/* Add Block Bar */}
            <div className="rounded-xl bg-zinc-900/40 border border-dashed border-zinc-800 p-3">
              <div className="text-[11px] font-medium text-zinc-400 mb-2">Add Content Block</div>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(BLOCK_TYPE_LABELS) as EmailBlockType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addBlock(type)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 whitespace-nowrap transition-colors"
                  >
                    <Plus size={11} /> {BLOCK_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>
          </div>
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

              <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeLoyaltySample}
                  onChange={(e) => setIncludeLoyaltySample(e.target.checked)}
                />
                <Sparkles size={12} className="text-amber-400" />
                Sample Loyalty Data
              </label>
            </div>

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
                  height: "640px",
                }}
              />
            </div>
          </div>
        </div>
      </div>

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
                <span className="text-zinc-200 font-medium">{eventName}</span>. Your prior published versions remain available in History.
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
                You have unsaved edits in this template. Save a draft first or discard your changes.
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
                Discard & Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
