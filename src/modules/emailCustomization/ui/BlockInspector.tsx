import React from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import {
  WEB_SAFE_FONTS,
  type BlockStyleConfig,
  type BookingDetailsRowConfig,
  type ButtonCornerStyle,
  type EmailBlock,
  type EmailHorizontalAlign,
  type EmailIconName,
  type EmailIconTone,
  type EmailTextAlign,
  type EmailVerticalAlign,
  type FooterContactField,
  type ModernButtonStyle,
  type WebSafeFontId,
} from "../shared/types";
import { EmailIconPicker } from "./BlockPaletteModal";
import { InlineLinksEditor, LinkDestinationField } from "./LinkControls";

const FOOTER_QUICK_VARS = [
  "hotel_name",
  "hotel_phone",
  "hotel_email",
  "hotel_address",
  "booking_reference",
  "legal_imprint",
  "hotel_website",
  "portal_link",
] as const;

function FooterVariableInsertBar({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      <span className="text-[10px] text-zinc-500 mr-0.5">Insert variable:</span>
      {FOOTER_QUICK_VARS.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onInsert(`{{${v}}}`)}
          className="px-1.5 py-0.5 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-[10px] font-mono text-emerald-400 transition-colors"
        >
          {`{{${v}}}`}
        </button>
      ))}
    </div>
  );
}

export interface ImageActionCallbacks {
  onPickLibrary: (blockId: string, field: string) => void;
  onDirectUpload: (blockId: string, field: string) => void;
  uploadingKey: string | null;
}

interface BlockInspectorProps {
  block: EmailBlock;
  appUrl: string;
  resolvedPortalUrl: string;
  resolvedVariables?: Record<string, string>;
  onChange: (updater: (b: EmailBlock) => EmailBlock) => void;
  imageActions: ImageActionCallbacks;
}

const inputClass =
  "w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors";

const labelClass = "block text-[11px] font-medium text-zinc-400 mb-1";

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const NINE_POINT_POSITIONS: Array<{
  h: EmailHorizontalAlign;
  v: EmailVerticalAlign;
  label: string;
}> = [
  { h: "left", v: "top", label: "Top Left" },
  { h: "center", v: "top", label: "Top Center" },
  { h: "right", v: "top", label: "Top Right" },
  { h: "left", v: "middle", label: "Middle Left" },
  { h: "center", v: "middle", label: "Center" },
  { h: "right", v: "middle", label: "Middle Right" },
  { h: "left", v: "bottom", label: "Bottom Left" },
  { h: "center", v: "bottom", label: "Bottom Center" },
  { h: "right", v: "bottom", label: "Bottom Right" },
];

function HorizontalAlignButtons({
  value,
  allowJustify = false,
  onChange,
}: {
  value: EmailTextAlign;
  allowJustify?: boolean;
  onChange: (next: EmailTextAlign) => void;
}) {
  const options: Array<{ id: EmailTextAlign; title: string; icon: React.ReactNode }> = [
    { id: "left", title: "Align Left", icon: <AlignLeft size={13} /> },
    { id: "center", title: "Align Center", icon: <AlignCenter size={13} /> },
    { id: "right", title: "Align Right", icon: <AlignRight size={13} /> },
    ...(allowJustify
      ? [{ id: "justify" as const, title: "Justify Text", icon: <AlignJustify size={13} /> }]
      : []),
  ];

  return (
    <div className="inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 gap-0.5">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            title={opt.title}
            onClick={() => onChange(opt.id)}
            className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 transition-colors ${
              active
                ? "bg-emerald-600 text-white font-semibold"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}

function NinePointAlignPicker({
  label,
  align,
  verticalAlign,
  defaultAlign = "left",
  defaultVerticalAlign = "middle",
  onChange,
}: {
  label: string;
  align?: EmailHorizontalAlign;
  verticalAlign?: EmailVerticalAlign;
  defaultAlign?: EmailHorizontalAlign;
  defaultVerticalAlign?: EmailVerticalAlign;
  onChange: (align: EmailHorizontalAlign, verticalAlign: EmailVerticalAlign) => void;
}) {
  const currentH = align || defaultAlign;
  const currentV = verticalAlign || defaultVerticalAlign;
  const activeEntry =
    NINE_POINT_POSITIONS.find((p) => p.h === currentH && p.v === currentV) ||
    NINE_POINT_POSITIONS[4];

  return (
    <div className="rounded-lg bg-zinc-950/70 border border-zinc-800/80 p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-zinc-400">{label}</span>
        <span className="text-[10px] font-medium text-emerald-400">{activeEntry.label}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <div
          className="grid grid-cols-3 gap-1 p-1 rounded-md bg-zinc-900 border border-zinc-800 shrink-0"
          role="group"
          aria-label={label}
        >
          {NINE_POINT_POSITIONS.map((pos) => {
            const isSelected = pos.h === currentH && pos.v === currentV;
            return (
              <button
                key={`${pos.v}-${pos.h}`}
                type="button"
                title={pos.label}
                aria-label={pos.label}
                onClick={() => onChange(pos.h, pos.v)}
                className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                  isSelected
                    ? "bg-emerald-500 text-zinc-950"
                    : "bg-zinc-950 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isSelected ? "bg-zinc-950" : "bg-current"
                  }`}
                />
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-1 text-[10px] text-zinc-500 leading-tight">
          <span>Click any of the 9 anchor points (Top Left, Center, Bottom Right, etc.)</span>
          <div className="flex items-center gap-1 pt-0.5">
            {(["left", "center", "right"] as const).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => onChange(h, currentV)}
                className={`px-1.5 py-0.5 rounded capitalize border ${
                  currentH === h
                    ? "bg-emerald-600/20 border-emerald-500/50 text-emerald-300"
                    : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImageFieldControl({
  blockId,
  fieldKey,
  label,
  url,
  alt,
  altPlaceholder,
  onUrlChange,
  onAltChange,
  imageActions,
}: {
  blockId: string;
  fieldKey: string;
  label: string;
  url: string;
  alt: string;
  altPlaceholder?: string;
  onUrlChange: (url: string) => void;
  onAltChange: (alt: string) => void;
  imageActions: ImageActionCallbacks;
}) {
  const isUploading = imageActions.uploadingKey === `${blockId}:${fieldKey}`;
  const isGif = /\.gif(\?|$)/i.test(url || "");

  return (
    <div className="rounded-lg bg-zinc-950/70 border border-zinc-800/80 p-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-zinc-300">{label}</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={isUploading}
            onClick={() => imageActions.onDirectUpload(blockId, fieldKey)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-[11px] font-semibold text-white whitespace-nowrap"
          >
            {isUploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {isUploading ? "Uploading..." : "Upload Image / GIF"}
          </button>
          <button
            type="button"
            onClick={() => imageActions.onPickLibrary(blockId, fieldKey)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-[11px] font-medium text-zinc-200 whitespace-nowrap"
          >
            <ImageIcon size={11} /> Library
          </button>
        </div>
      </div>

      <div className="flex items-start gap-2.5">
        {url ? (
          <div className="w-16 h-12 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden shrink-0">
            <img src={url} alt={alt || label} className="max-w-full max-h-full object-contain" />
          </div>
        ) : (
          <div className="w-16 h-12 rounded bg-zinc-900 border border-dashed border-zinc-700 flex items-center justify-center text-zinc-600 shrink-0">
            <ImageIcon size={14} />
          </div>
        )}
        <div className="flex-1 space-y-1.5 min-w-0">
          <input
            type="url"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://... (PNG, JPG, WebP, or GIF)"
            className={`${inputClass} font-mono`}
          />
          <input
            type="text"
            value={alt}
            onChange={(e) => onAltChange(e.target.value)}
            placeholder={altPlaceholder || "Required alt text describing this image"}
            className={inputClass}
          />
        </div>
      </div>

      {isGif && (
        <p className="text-[11px] text-amber-400/90">
          GIF tip: Outlook desktop shows frame 1 only — keep your primary visual on the first frame.
        </p>
      )}
    </div>
  );
}

function ModernButtonEditor({
  label,
  url,
  buttonStyle,
  buttonCorner,
  buttonBgColor,
  buttonTextColor,
  buttonBorderColor,
  buttonOpenInNewTab,
  buttonHidden,
  resolvedVariables,
  onPatch,
}: {
  label?: string;
  url?: string;
  buttonStyle?: ModernButtonStyle;
  buttonCorner?: ButtonCornerStyle;
  buttonBgColor?: string;
  buttonTextColor?: string;
  buttonBorderColor?: string;
  buttonOpenInNewTab?: boolean;
  buttonHidden?: boolean;
  resolvedVariables?: Record<string, string>;
  onPatch: (patch: {
    buttonLabel?: string;
    buttonUrl?: string;
    buttonStyle?: ModernButtonStyle;
    buttonCorner?: ButtonCornerStyle;
    buttonBgColor?: string;
    buttonTextColor?: string;
    buttonBorderColor?: string;
    buttonOpenInNewTab?: boolean;
    buttonHidden?: boolean;
  }) => void;
}) {
  return (
    <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-zinc-300">Button (Optional)</div>
        <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(buttonHidden)}
            onChange={(e) => onPatch({ buttonHidden: e.target.checked })}
          />
          Hide button
        </label>
      </div>
      <div>
        <label className={labelClass}>Button Label</label>
        <input
          type="text"
          value={label || ""}
          onChange={(e) => onPatch({ buttonLabel: e.target.value })}
          placeholder="Leave blank to hide button"
          className={inputClass}
        />
      </div>
      <LinkDestinationField
        label="Button Destination"
        url={url || ""}
        visibleLabel={label}
        onChangeUrl={(buttonUrl) => onPatch({ buttonUrl })}
        allowContactSchemes
        allowEmpty
        resolvedVariables={resolvedVariables}
        openInNewTab={buttonOpenInNewTab}
        onChangeOpenInNewTab={(next) => onPatch({ buttonOpenInNewTab: next })}
        compact
      />
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div>
          <label className={labelClass}>Style</label>
          <select
            value={buttonStyle || "filled"}
            onChange={(e) => onPatch({ buttonStyle: e.target.value as ModernButtonStyle })}
            className={inputClass}
          >
            <option value="filled">Filled (Brand)</option>
            <option value="outlined">Outlined</option>
            <option value="dark">Black / Dark</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Corners</label>
          <select
            value={buttonCorner || "rounded"}
            onChange={(e) => onPatch({ buttonCorner: e.target.value as ButtonCornerStyle })}
            className={inputClass}
          >
            <option value="square">Square</option>
            <option value="rounded">Rounded</option>
            <option value="pill">Pill</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Fill Color</label>
          <input
            type="color"
            value={buttonBgColor || "#18181b"}
            onChange={(e) => onPatch({ buttonBgColor: e.target.value })}
            className="w-full h-7 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
          />
        </div>
        <div>
          <label className={labelClass}>Text Color</label>
          <input
            type="color"
            value={buttonTextColor || "#ffffff"}
            onChange={(e) => onPatch({ buttonTextColor: e.target.value })}
            className="w-full h-7 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
          />
        </div>
        <div>
          <label className={labelClass}>Border Color</label>
          <input
            type="color"
            value={buttonBorderColor || "#18181b"}
            onChange={(e) => onPatch({ buttonBorderColor: e.target.value })}
            className="w-full h-7 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}

function BlockStyleControls({
  style,
  showAlign = false,
  showVerticalAlign = false,
  showBorder = false,
  showRadius = false,
  showTypography = false,
  showHeadingColor = false,
  onChange,
}: {
  style?: BlockStyleConfig;
  showAlign?: boolean;
  showVerticalAlign?: boolean;
  showBorder?: boolean;
  showRadius?: boolean;
  showTypography?: boolean;
  showHeadingColor?: boolean;
  onChange: (next: BlockStyleConfig) => void;
}) {
  const s = style || {};
  return (
    <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5 space-y-2.5">
      <div className="text-[11px] font-semibold text-zinc-400">
        {showTypography ? "Typography, Colors & Spacing" : "Colors & Spacing"}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className={labelClass}>Background</label>
          <input
            type="color"
            value={s.backgroundColor || "#ffffff"}
            onChange={(e) => onChange({ ...s, backgroundColor: e.target.value })}
            className="w-full h-7 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
          />
        </div>
        <div>
          <label className={labelClass}>Text Color</label>
          <input
            type="color"
            value={s.textColor || "#18181b"}
            onChange={(e) => onChange({ ...s, textColor: e.target.value })}
            className="w-full h-7 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
          />
        </div>
        {showHeadingColor && (
          <div>
            <label className={labelClass}>Heading Color</label>
            <input
              type="color"
              value={s.accentColor || "#18181b"}
              onChange={(e) => onChange({ ...s, accentColor: e.target.value })}
              className="w-full h-7 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
            />
          </div>
        )}
        {showBorder && (
          <div>
            <label className={labelClass}>Top Border</label>
            <input
              type="color"
              value={s.borderColor || "#e4e4e7"}
              onChange={(e) => onChange({ ...s, borderColor: e.target.value })}
              className="w-full h-7 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
            />
          </div>
        )}
        {showAlign && !showVerticalAlign && (
          <div>
            <label className={labelClass}>Alignment</label>
            <HorizontalAlignButtons
              value={s.align || "center"}
              onChange={(next) =>
                onChange({ ...s, align: next as EmailHorizontalAlign })
              }
            />
          </div>
        )}
      </div>

      {showAlign && showVerticalAlign && (
        <NinePointAlignPicker
          label="Content Position & Alignment"
          align={s.align}
          verticalAlign={s.verticalAlign}
          defaultAlign="center"
          defaultVerticalAlign="middle"
          onChange={(align, verticalAlign) => onChange({ ...s, align, verticalAlign })}
        />
      )}

      {showTypography && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className={labelClass}>Font Family</label>
            <select
              value={s.fontFamily || ""}
              onChange={(e) =>
                onChange({
                  ...s,
                  fontFamily: (e.target.value || undefined) as WebSafeFontId | undefined,
                })
              }
              className={inputClass}
            >
              <option value="">Inherit template font</option>
              {WEB_SAFE_FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex justify-between text-[11px] text-zinc-400 mb-1 tabular-nums">
              <span>Font Size</span>
              <span>{s.fontSizePx ?? 12}px</span>
            </div>
            <input
              type="range"
              min={10}
              max={24}
              value={s.fontSizePx ?? 12}
              onChange={(e) => onChange({ ...s, fontSizePx: Number(e.target.value) })}
              className="w-full accent-emerald-500"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <div className="flex justify-between text-[11px] text-zinc-400 mb-0.5 tabular-nums">
            <span>Padding Y</span>
            <span>{s.paddingY ?? 18}px</span>
          </div>
          <input
            type="range"
            min={0}
            max={40}
            value={s.paddingY ?? 18}
            onChange={(e) => onChange({ ...s, paddingY: Number(e.target.value) })}
            className="w-full accent-emerald-500"
          />
        </div>
        <div>
          <div className="flex justify-between text-[11px] text-zinc-400 mb-0.5 tabular-nums">
            <span>Padding X</span>
            <span>{s.paddingX ?? 28}px</span>
          </div>
          <input
            type="range"
            min={0}
            max={40}
            value={s.paddingX ?? 28}
            onChange={(e) => onChange({ ...s, paddingX: Number(e.target.value) })}
            className="w-full accent-emerald-500"
          />
        </div>
        {showRadius && (
          <div>
            <div className="flex justify-between text-[11px] text-zinc-400 mb-0.5 tabular-nums">
              <span>Radius</span>
              <span>{s.borderRadius ?? 12}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={16}
              value={s.borderRadius ?? 12}
              onChange={(e) => onChange({ ...s, borderRadius: Number(e.target.value) })}
              className="w-full accent-emerald-500"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function BlockInspector({
  block,
  appUrl,
  resolvedPortalUrl,
  resolvedVariables,
  onChange,
  imageActions,
}: BlockInspectorProps) {
  const effectiveVars: Record<string, string> = resolvedVariables || {
    portal_link: resolvedPortalUrl,
    app_url: appUrl,
  };

  switch (block.type) {
    // --- 10 CLASSIC BLOCKS ---
    case "heading":
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <div className="sm:col-span-3">
              <input
                type="text"
                value={block.text}
                onChange={(e) =>
                  onChange((b) => (b.type === "heading" ? { ...b, text: e.target.value } : b))
                }
                className={inputClass}
              />
            </div>
            <div>
              <select
                value={block.level}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "heading" ? { ...b, level: Number(e.target.value) as 1 | 2 | 3 } : b
                  )
                }
                className={inputClass}
              >
                <option value={1}>H1</option>
                <option value={2}>H2</option>
                <option value={3}>H3</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-zinc-400">Text Alignment:</span>
            <HorizontalAlignButtons
              value={block.align || "left"}
              onChange={(next) =>
                onChange((b) =>
                  b.type === "heading" ? { ...b, align: next as EmailHorizontalAlign } : b
                )
              }
            />
          </div>
        </div>
      );

    case "paragraph":
      return (
        <div className="space-y-2.5">
          <textarea
            rows={3}
            value={block.text}
            onChange={(e) =>
              onChange((b) => (b.type === "paragraph" ? { ...b, text: e.target.value } : b))
            }
            className={inputClass}
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={block.tone || "default"}
              onChange={(e) =>
                onChange((b) =>
                  b.type === "paragraph"
                    ? { ...b, tone: e.target.value as "default" | "muted" | "accent" }
                    : b
                )
              }
              className={`${inputClass} w-36`}
            >
              <option value="default">Normal tone</option>
              <option value="muted">Muted tone</option>
              <option value="accent">Brand accent</option>
            </select>
            <HorizontalAlignButtons
              value={block.align || "left"}
              allowJustify
              onChange={(next) =>
                onChange((b) => (b.type === "paragraph" ? { ...b, align: next } : b))
              }
            />
          </div>
          <InlineLinksEditor
            inlineLinks={block.inlineLinks}
            resolvedVariables={effectiveVars}
            onChangeLinks={(inlineLinks) =>
              onChange((b) => (b.type === "paragraph" ? { ...b, inlineLinks } : b))
            }
            onInsertToken={(token) =>
              onChange((b) =>
                b.type === "paragraph"
                  ? { ...b, text: b.text ? `${b.text} ${token}` : token }
                  : b
              )
            }
            onRemoveToken={(token) =>
              onChange((b) =>
                b.type === "paragraph"
                  ? { ...b, text: b.text.split(token).join("").replace(/\s{2,}/g, " ").trim() }
                  : b
              )
            }
          />
        </div>
      );

    case "image":
      return (
        <div className="space-y-2.5">
          <ImageFieldControl
            blockId={block.id}
            fieldKey="src"
            label="Image or Animated GIF"
            url={block.src}
            alt={block.alt}
            onUrlChange={(src) =>
              onChange((b) => (b.type === "image" ? { ...b, src, imageId: undefined } : b))
            }
            onAltChange={(alt) =>
              onChange((b) => (b.type === "image" ? { ...b, alt } : b))
            }
            imageActions={imageActions}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-start">
            <div>
              <label className={labelClass}>Max Width (80–544px)</label>
              <input
                type="number"
                min={80}
                max={544}
                value={block.widthPx}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "image" ? { ...b, widthPx: Number(e.target.value) || 540 } : b
                  )
                }
                className={inputClass}
              />
            </div>
            <NinePointAlignPicker
              label="Image Position"
              align={block.align}
              verticalAlign={block.verticalAlign}
              defaultAlign="center"
              defaultVerticalAlign="top"
              onChange={(align, verticalAlign) =>
                onChange((b) => (b.type === "image" ? { ...b, align, verticalAlign } : b))
              }
            />
          </div>
          <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5">
            <LinkDestinationField
              label="Optional Image Click Link"
              url={block.linkUrl || ""}
              visibleLabel={block.alt}
              onChangeUrl={(linkUrl) =>
                onChange((b) => (b.type === "image" ? { ...b, linkUrl } : b))
              }
              allowEmpty
              resolvedVariables={effectiveVars}
              openInNewTab={block.linkOpenInNewTab}
              onChangeOpenInNewTab={(linkOpenInNewTab) =>
                onChange((b) => (b.type === "image" ? { ...b, linkOpenInNewTab } : b))
              }
              hidden={block.linkHidden}
              onChangeHidden={(linkHidden) =>
                onChange((b) => (b.type === "image" ? { ...b, linkHidden } : b))
              }
              compact
            />
          </div>
        </div>
      );

    case "button":
      return (
        <div className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Link / Button Text</label>
              <input
                type="text"
                value={block.label}
                onChange={(e) =>
                  onChange((b) => (b.type === "button" ? { ...b, label: e.target.value } : b))
                }
                placeholder="Manage Your Stay"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Display Style</label>
              <select
                value={block.displayStyle}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "button"
                      ? { ...b, displayStyle: e.target.value as "solid" | "outline" | "text_link" }
                      : b
                  )
                }
                className={inputClass}
              >
                <option value="solid">Solid Button</option>
                <option value="outline">Outline Button</option>
                <option value="text_link">Inline Text Link</option>
              </select>
            </div>
          </div>
          {block.displayStyle === "text_link" && (
            <div>
              <label className={labelClass}>Optional Prefix Text (before link)</label>
              <input
                type="text"
                value={block.prefixText || ""}
                onChange={(e) =>
                  onChange((b) => (b.type === "button" ? { ...b, prefixText: e.target.value } : b))
                }
                placeholder="e.g. Manage your booking at "
                className={inputClass}
              />
            </div>
          )}
          <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5">
            <LinkDestinationField
              label="Destination"
              url={block.url}
              visibleLabel={block.label}
              onChangeUrl={(url) =>
                onChange((b) => (b.type === "button" ? { ...b, url } : b))
              }
              allowContactSchemes
              allowEmpty={false}
              resolvedVariables={effectiveVars}
              openInNewTab={block.openInNewTab}
              onChangeOpenInNewTab={(openInNewTab) =>
                onChange((b) => (b.type === "button" ? { ...b, openInNewTab } : b))
              }
              underline={block.displayStyle === "text_link" ? block.underline : undefined}
              onChangeUnderline={
                block.displayStyle === "text_link"
                  ? (underline) =>
                      onChange((b) => (b.type === "button" ? { ...b, underline } : b))
                  : undefined
              }
              compact
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <div>
              <label className={labelClass}>Alignment</label>
              <select
                value={block.align || "left"}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "button"
                      ? { ...b, align: e.target.value as "left" | "center" | "right" }
                      : b
                  )
                }
                className={inputClass}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>
                {block.displayStyle === "text_link" ? "Link Color" : "Fill Color"}
              </label>
              <input
                type="color"
                value={block.bgColor || "#059669"}
                onChange={(e) =>
                  onChange((b) => (b.type === "button" ? { ...b, bgColor: e.target.value } : b))
                }
                className="w-full h-7 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
              />
            </div>
            {block.displayStyle !== "text_link" && (
              <>
                <div>
                  <label className={labelClass}>Text Color</label>
                  <input
                    type="color"
                    value={block.textColor || "#ffffff"}
                    onChange={(e) =>
                      onChange((b) =>
                        b.type === "button" ? { ...b, textColor: e.target.value } : b
                      )
                    }
                    className="w-full h-7 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
                  />
                </div>
                <div>
                  <label className={labelClass}>Border Color</label>
                  <input
                    type="color"
                    value={block.borderColor || block.bgColor || "#059669"}
                    onChange={(e) =>
                      onChange((b) =>
                        b.type === "button" ? { ...b, borderColor: e.target.value } : b
                      )
                    }
                    className="w-full h-7 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
                  />
                </div>
                <div>
                  <label className={labelClass}>Radius (px)</label>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={block.borderRadiusPx ?? 6}
                    onChange={(e) =>
                      onChange((b) =>
                        b.type === "button"
                          ? { ...b, borderRadiusPx: Math.max(0, Math.min(999, Number(e.target.value) || 0)) }
                          : b
                      )
                    }
                    className={inputClass}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      );

    case "divider":
      return (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-400">Color</span>
            <input
              type="color"
              value={block.color || "#e4e4e7"}
              onChange={(e) =>
                onChange((b) => (b.type === "divider" ? { ...b, color: e.target.value } : b))
              }
              className="h-7 w-12 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-400">Thickness</span>
            <input
              type="number"
              min={1}
              max={4}
              value={block.thicknessPx || 1}
              onChange={(e) =>
                onChange((b) =>
                  b.type === "divider" ? { ...b, thicknessPx: Number(e.target.value) || 1 } : b
                )
              }
              className={`${inputClass} w-16`}
            />
          </div>
        </div>
      );

    case "spacer":
      return (
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-zinc-400 tabular-nums">Height: {block.heightPx}px</span>
          <input
            type="range"
            min={4}
            max={64}
            value={block.heightPx}
            onChange={(e) =>
              onChange((b) => (b.type === "spacer" ? { ...b, heightPx: Number(e.target.value) } : b))
            }
            className="flex-1 accent-emerald-500"
          />
        </div>
      );

    case "booking_details_table":
      return (
        <div className="space-y-2">
          <input
            type="text"
            value={block.title || ""}
            onChange={(e) =>
              onChange((b) =>
                b.type === "booking_details_table" ? { ...b, title: e.target.value } : b
              )
            }
            placeholder="Optional table heading"
            className={inputClass}
          />
          <div className="space-y-1.5">
            {block.rows.map((row: BookingDetailsRowConfig, rIdx: number) => (
              <div key={row.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    onChange((b) =>
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
                >
                  {row.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                <input
                  type="text"
                  value={row.label}
                  onChange={(e) =>
                    onChange((b) =>
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
                  className={`${inputClass} w-1/3`}
                />
                <input
                  type="text"
                  value={row.valueTemplate}
                  onChange={(e) =>
                    onChange((b) =>
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
                  className={`${inputClass} flex-1 font-mono`}
                />
                <button
                  type="button"
                  disabled={rIdx === 0}
                  onClick={() =>
                    onChange((b) => {
                      if (b.type !== "booking_details_table") return b;
                      const copy = [...b.rows];
                      const [m] = copy.splice(rIdx, 1);
                      copy.splice(rIdx - 1, 0, m);
                      return { ...b, rows: copy };
                    })
                  }
                  className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange((b) =>
                      b.type === "booking_details_table"
                        ? { ...b, rows: b.rows.filter((r) => r.id !== row.id) }
                        : b
                    )
                  }
                  className="p-1 text-zinc-500 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              onChange((b) =>
                b.type === "booking_details_table"
                  ? {
                      ...b,
                      rows: [
                        ...b.rows,
                        { id: makeId("row"), label: "Field", valueTemplate: "{{room_type}}", visible: true },
                      ],
                    }
                  : b
              )
            }
            className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium"
          >
            <Plus size={12} /> Add Row
          </button>
        </div>
      );

    case "two_column_text":
      return (
        <div className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <input
                type="text"
                value={block.leftTitle || ""}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "two_column_text" ? { ...b, leftTitle: e.target.value } : b
                  )
                }
                placeholder="Left heading"
                className={inputClass}
              />
              <textarea
                rows={2}
                value={block.leftText}
                onChange={(e) =>
                  onChange((b) =>
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
                  onChange((b) =>
                    b.type === "two_column_text" ? { ...b, rightTitle: e.target.value } : b
                  )
                }
                placeholder="Right heading"
                className={inputClass}
              />
              <textarea
                rows={2}
                value={block.rightText}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "two_column_text" ? { ...b, rightText: e.target.value } : b
                  )
                }
                className={inputClass}
              />
            </div>
          </div>
          <InlineLinksEditor
            inlineLinks={block.inlineLinks}
            resolvedVariables={effectiveVars}
            helperHint="Place [[link:id]] in either the left or right column text."
            onChangeLinks={(inlineLinks) =>
              onChange((b) => (b.type === "two_column_text" ? { ...b, inlineLinks } : b))
            }
            onInsertToken={(token) =>
              onChange((b) =>
                b.type === "two_column_text"
                  ? { ...b, leftText: b.leftText ? `${b.leftText} ${token}` : token }
                  : b
              )
            }
            onRemoveToken={(token) =>
              onChange((b) =>
                b.type === "two_column_text"
                  ? {
                      ...b,
                      leftText: b.leftText.split(token).join("").replace(/\s{2,}/g, " ").trim(),
                      rightText: b.rightText.split(token).join("").replace(/\s{2,}/g, " ").trim(),
                    }
                  : b
              )
            }
          />
        </div>
      );

    case "social_links":
      return (
        <div className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={block.title || ""}
              onChange={(e) =>
                onChange((b) => (b.type === "social_links" ? { ...b, title: e.target.value } : b))
              }
              placeholder="Heading"
              className={`${inputClass} sm:col-span-2`}
            />
            <select
              value={block.align || "left"}
              onChange={(e) =>
                onChange((b) =>
                  b.type === "social_links"
                    ? { ...b, align: e.target.value as "left" | "center" | "right" }
                    : b
                )
              }
              className={inputClass}
            >
              <option value="left">Align Left</option>
              <option value="center">Align Center</option>
              <option value="right">Align Right</option>
            </select>
          </div>
          {block.links.map((item, sIdx) => (
            <div
              key={item.id}
              className={`rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2 space-y-2 ${
                item.hidden ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={item.label}
                  onChange={(e) =>
                    onChange((b) =>
                      b.type === "social_links"
                        ? {
                            ...b,
                            links: b.links.map((l) =>
                              l.id === item.id ? { ...l, label: e.target.value } : l
                            ),
                          }
                        : b
                    )
                  }
                  placeholder="Label (e.g. Instagram)"
                  className={`${inputClass} flex-1`}
                />
                <button
                  type="button"
                  title={item.hidden ? "Show link" : "Hide link"}
                  onClick={() =>
                    onChange((b) =>
                      b.type === "social_links"
                        ? {
                            ...b,
                            links: b.links.map((l) =>
                              l.id === item.id ? { ...l, hidden: !l.hidden } : l
                            ),
                          }
                        : b
                    )
                  }
                  className="p-1 text-zinc-400 hover:text-zinc-100"
                >
                  {item.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                <button
                  type="button"
                  disabled={sIdx === 0}
                  onClick={() =>
                    onChange((b) => {
                      if (b.type !== "social_links" || sIdx === 0) return b;
                      const copy = [...b.links];
                      const [m] = copy.splice(sIdx, 1);
                      copy.splice(sIdx - 1, 0, m);
                      return { ...b, links: copy };
                    })
                  }
                  className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  disabled={sIdx === block.links.length - 1}
                  onClick={() =>
                    onChange((b) => {
                      if (b.type !== "social_links" || sIdx >= b.links.length - 1) return b;
                      const copy = [...b.links];
                      const [m] = copy.splice(sIdx, 1);
                      copy.splice(sIdx + 1, 0, m);
                      return { ...b, links: copy };
                    })
                  }
                  className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange((b) =>
                      b.type === "social_links"
                        ? { ...b, links: b.links.filter((l) => l.id !== item.id) }
                        : b
                    )
                  }
                  className="p-1 text-zinc-500 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <LinkDestinationField
                url={item.url}
                visibleLabel={item.label}
                onChangeUrl={(url) =>
                  onChange((b) =>
                    b.type === "social_links"
                      ? {
                          ...b,
                          links: b.links.map((l) => (l.id === item.id ? { ...l, url } : l)),
                        }
                      : b
                  )
                }
                allowEmpty={Boolean(item.hidden)}
                resolvedVariables={effectiveVars}
                color={item.color}
                onChangeColor={(color) =>
                  onChange((b) =>
                    b.type === "social_links"
                      ? {
                          ...b,
                          links: b.links.map((l) => (l.id === item.id ? { ...l, color } : l)),
                        }
                      : b
                  )
                }
                underline={item.underline}
                onChangeUnderline={(underline) =>
                  onChange((b) =>
                    b.type === "social_links"
                      ? {
                          ...b,
                          links: b.links.map((l) => (l.id === item.id ? { ...l, underline } : l)),
                        }
                      : b
                  )
                }
                openInNewTab={item.openInNewTab}
                onChangeOpenInNewTab={(openInNewTab) =>
                  onChange((b) =>
                    b.type === "social_links"
                      ? {
                          ...b,
                          links: b.links.map((l) =>
                            l.id === item.id ? { ...l, openInNewTab } : l
                          ),
                        }
                      : b
                  )
                }
                compact
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange((b) =>
                b.type === "social_links"
                  ? {
                      ...b,
                      links: [
                        ...b.links,
                        { id: makeId("soc"), label: "Instagram", url: "{{social_instagram}}" },
                      ],
                    }
                  : b
              )
            }
            className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium"
          >
            <Plus size={12} /> Add Social Link
          </button>
        </div>
      );

    case "footer":
      return (
        <div className="space-y-2.5">
          <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={block.showContactBlock}
              onChange={(e) =>
                onChange((b) =>
                  b.type === "footer" ? { ...b, showContactBlock: e.target.checked } : b
                )
              }
            />
            Show hotel contact block
          </label>
          {block.showContactBlock && (
            <>
              <input
                type="text"
                value={block.contactTitle}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "footer" ? { ...b, contactTitle: e.target.value } : b
                  )
                }
                className={inputClass}
              />
              {block.fields.map((f: FooterContactField) => {
                const supportsLink =
                  f.key === "email" || f.key === "phone" || f.key === "website";
                return (
                  <div
                    key={f.id}
                    className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2 space-y-1.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onChange((b) =>
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
                          onChange((b) =>
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
                          onChange((b) =>
                            b.type === "footer"
                              ? {
                                  ...b,
                                  fields: b.fields.map((x) =>
                                    x.id === f.id ? { ...x, valueTemplate: e.target.value } : x
                                  ),
                                }
                              : b
                          )
                        }
                        className={`${inputClass} flex-1 font-mono`}
                      />
                    </div>
                    {supportsLink && (
                      <div className="flex flex-wrap items-center gap-3 pl-8 text-[11px] text-zinc-400">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={f.linkEnabled !== false}
                            onChange={(e) =>
                              onChange((b) =>
                                b.type === "footer"
                                  ? {
                                      ...b,
                                      fields: b.fields.map((x) =>
                                        x.id === f.id
                                          ? { ...x, linkEnabled: e.target.checked }
                                          : x
                                      ),
                                    }
                                  : b
                              )
                            }
                          />
                          Clickable{" "}
                          {f.key === "email"
                            ? "mailto: link"
                            : f.key === "phone"
                            ? "tel: link"
                            : "HTTPS link"}
                        </label>
                        {f.linkEnabled !== false && (
                          <>
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={f.underline !== false}
                                onChange={(e) =>
                                  onChange((b) =>
                                    b.type === "footer"
                                      ? {
                                          ...b,
                                          fields: b.fields.map((x) =>
                                            x.id === f.id
                                              ? { ...x, underline: e.target.checked }
                                              : x
                                          ),
                                        }
                                      : b
                                  )
                                }
                              />
                              Underline
                            </label>
                            <label className="inline-flex items-center gap-1.5">
                              <span>Color</span>
                              <input
                                type="color"
                                value={f.linkColor || "#059669"}
                                onChange={(e) =>
                                  onChange((b) =>
                                    b.type === "footer"
                                      ? {
                                          ...b,
                                          fields: b.fields.map((x) =>
                                            x.id === f.id
                                              ? { ...x, linkColor: e.target.value }
                                              : x
                                          ),
                                        }
                                      : b
                                  )
                                }
                                className="h-5 w-7 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
                              />
                            </label>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
          <textarea
            rows={2}
            value={block.legalImprintText || ""}
            onChange={(e) =>
              onChange((b) =>
                b.type === "footer" ? { ...b, legalImprintText: e.target.value } : b
              )
            }
            placeholder="Optional legal/imprint text"
            className={inputClass}
          />
        </div>
      );

    // --- 13 MODERN BLOCKS ---
    case "brand_header":
      return (
        <div className="space-y-3">
          <ImageFieldControl
            blockId={block.id}
            fieldKey="logoUrl"
            label="Header Logo (optional; falls back to hotel name)"
            url={block.logoUrl || ""}
            alt={block.logoAlt || "{{hotel_name}}"}
            onUrlChange={(logoUrl) =>
              onChange((b) =>
                b.type === "brand_header" ? { ...b, logoUrl, logoImageId: undefined } : b
              )
            }
            onAltChange={(logoAlt) =>
              onChange((b) => (b.type === "brand_header" ? { ...b, logoAlt } : b))
            }
            imageActions={imageActions}
          />
          <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5">
            <LinkDestinationField
              label="Optional Header Logo Click Link"
              url={block.logoLinkUrl || ""}
              visibleLabel={block.logoAlt || "{{hotel_name}}"}
              onChangeUrl={(logoLinkUrl) =>
                onChange((b) => (b.type === "brand_header" ? { ...b, logoLinkUrl } : b))
              }
              allowEmpty
              resolvedVariables={effectiveVars}
              openInNewTab={block.logoLinkOpenInNewTab}
              onChangeOpenInNewTab={(logoLinkOpenInNewTab) =>
                onChange((b) => (b.type === "brand_header" ? { ...b, logoLinkOpenInNewTab } : b))
              }
              compact
            />
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-zinc-300">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={block.showHotelName}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "brand_header" ? { ...b, showHotelName: e.target.checked } : b
                  )
                }
              />
              Show Hotel Name
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={block.showAddress}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "brand_header" ? { ...b, showAddress: e.target.checked } : b
                  )
                }
              />
              Show Address
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={block.showPhone}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "brand_header" ? { ...b, showPhone: e.target.checked } : b
                  )
                }
              />
              Show Phone
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={Boolean(block.showEmail)}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "brand_header" ? { ...b, showEmail: e.target.checked } : b
                  )
                }
              />
              Show Email
            </label>
          </div>
          {(block.showPhone || block.showEmail) && (
            <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5 space-y-2">
              <div className="text-[11px] font-semibold text-zinc-300">
                Header Contact Links (tel: / mailto:)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {block.showPhone && (
                  <div className="space-y-1.5">
                    <label className={labelClass}>Phone Override (optional)</label>
                    <input
                      type="text"
                      value={block.phoneOverride || ""}
                      onChange={(e) =>
                        onChange((b) =>
                          b.type === "brand_header" ? { ...b, phoneOverride: e.target.value } : b
                        )
                      }
                      placeholder="Leave blank for {{hotel_phone}}"
                      className={`${inputClass} font-mono`}
                    />
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={block.phoneLinkEnabled !== false}
                        onChange={(e) =>
                          onChange((b) =>
                            b.type === "brand_header"
                              ? { ...b, phoneLinkEnabled: e.target.checked }
                              : b
                          )
                        }
                      />
                      Clickable tel: link (uncheck for plain text)
                    </label>
                  </div>
                )}
                {block.showEmail && (
                  <div className="space-y-1.5">
                    <label className={labelClass}>Email Override (optional)</label>
                    <input
                      type="email"
                      value={block.emailOverride || ""}
                      onChange={(e) =>
                        onChange((b) =>
                          b.type === "brand_header" ? { ...b, emailOverride: e.target.value } : b
                        )
                      }
                      placeholder="Leave blank for {{hotel_email}}"
                      className={`${inputClass} font-mono`}
                    />
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={block.emailLinkEnabled !== false}
                        onChange={(e) =>
                          onChange((b) =>
                            b.type === "brand_header"
                              ? { ...b, emailLinkEnabled: e.target.checked }
                              : b
                          )
                        }
                      />
                      Clickable mailto: link (uncheck for plain text)
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}
          <EmailIconPicker
            tone={block.iconTone}
            appUrl={appUrl}
            showIconGrid={false}
            onChangeTone={(iconTone) =>
              onChange((b) => (b.type === "brand_header" ? { ...b, iconTone } : b))
            }
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <NinePointAlignPicker
              label="Logo Placement"
              align={block.logoAlign}
              verticalAlign={block.logoVerticalAlign}
              defaultAlign="left"
              defaultVerticalAlign="middle"
              onChange={(logoAlign, logoVerticalAlign) =>
                onChange((b) =>
                  b.type === "brand_header" ? { ...b, logoAlign, logoVerticalAlign } : b
                )
              }
            />
            <NinePointAlignPicker
              label="Contact Info Placement"
              align={block.contactAlign}
              verticalAlign={block.contactVerticalAlign}
              defaultAlign="right"
              defaultVerticalAlign="middle"
              onChange={(contactAlign, contactVerticalAlign) =>
                onChange((b) =>
                  b.type === "brand_header" ? { ...b, contactAlign, contactVerticalAlign } : b
                )
              }
            />
          </div>
          <BlockStyleControls
            style={block.style}
            showBorder
            onChange={(style) =>
              onChange((b) => (b.type === "brand_header" ? { ...b, style } : b))
            }
          />
        </div>
      );

    case "promo_banner":
      return (
        <div className="space-y-3">
          <ImageFieldControl
            blockId={block.id}
            fieldKey="imageUrl"
            label="Small Thumbnail Image (Optional)"
            url={block.imageUrl || ""}
            alt={block.imageAlt || ""}
            onUrlChange={(imageUrl) =>
              onChange((b) =>
                b.type === "promo_banner" ? { ...b, imageUrl, imageId: undefined } : b
              )
            }
            onAltChange={(imageAlt) =>
              onChange((b) => (b.type === "promo_banner" ? { ...b, imageAlt } : b))
            }
            imageActions={imageActions}
          />
          {block.imageUrl && (
            <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5">
              <LinkDestinationField
                label="Optional Thumbnail Click Link"
                url={block.imageLinkUrl || ""}
                visibleLabel={block.imageAlt}
                onChangeUrl={(imageLinkUrl) =>
                  onChange((b) => (b.type === "promo_banner" ? { ...b, imageLinkUrl } : b))
                }
                allowEmpty
                resolvedVariables={effectiveVars}
                compact
              />
            </div>
          )}
          <div>
            <label className={labelClass}>Banner Copy</label>
            <textarea
              rows={2}
              value={block.text}
              onChange={(e) =>
                onChange((b) => (b.type === "promo_banner" ? { ...b, text: e.target.value } : b))
              }
              className={inputClass}
            />
          </div>
          <ModernButtonEditor
            label={block.buttonLabel}
            url={block.buttonUrl}
            buttonStyle={block.buttonStyle}
            buttonCorner={block.buttonCorner}
            buttonBgColor={block.buttonBgColor}
            buttonTextColor={block.buttonTextColor}
            buttonBorderColor={block.buttonBorderColor}
            buttonOpenInNewTab={block.buttonOpenInNewTab}
            buttonHidden={block.buttonHidden}
            resolvedVariables={effectiveVars}
            onPatch={(patch) =>
              onChange((b) => (b.type === "promo_banner" ? { ...b, ...patch } : b))
            }
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <NinePointAlignPicker
              label="Thumbnail Placement"
              align={block.imageAlign}
              verticalAlign={block.imageVerticalAlign}
              defaultAlign="left"
              defaultVerticalAlign="middle"
              onChange={(imageAlign, imageVerticalAlign) =>
                onChange((b) =>
                  b.type === "promo_banner" ? { ...b, imageAlign, imageVerticalAlign } : b
                )
              }
            />
            <NinePointAlignPicker
              label="Banner Text Placement"
              align={block.textAlign || block.style?.align}
              verticalAlign={block.textVerticalAlign || block.style?.verticalAlign}
              defaultAlign="left"
              defaultVerticalAlign="middle"
              onChange={(textAlign, textVerticalAlign) =>
                onChange((b) =>
                  b.type === "promo_banner" ? { ...b, textAlign, textVerticalAlign } : b
                )
              }
            />
          </div>
          <BlockStyleControls
            style={block.style}
            onChange={(style) =>
              onChange((b) => (b.type === "promo_banner" ? { ...b, style } : b))
            }
          />
        </div>
      );

    case "membership_strip":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Tier Text / Variable</label>
              <input
                type="text"
                value={block.tierTemplate}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "membership_strip" ? { ...b, tierTemplate: e.target.value } : b
                  )
                }
                placeholder="{{loyalty_tier}}"
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label className={labelClass}>Points Text / Variable</label>
              <input
                type="text"
                value={block.pointsTemplate}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "membership_strip" ? { ...b, pointsTemplate: e.target.value } : b
                  )
                }
                placeholder="{{loyalty_points_balance}} Points"
                className={`${inputClass} font-mono`}
              />
            </div>
          </div>
          <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5 space-y-2">
            <LinkDestinationField
              label="Optional Strip Link"
              url={block.linkUrl || ""}
              onChangeUrl={(linkUrl) =>
                onChange((b) => (b.type === "membership_strip" ? { ...b, linkUrl } : b))
              }
              allowEmpty
              resolvedVariables={effectiveVars}
              openInNewTab={block.linkOpenInNewTab}
              onChangeOpenInNewTab={(linkOpenInNewTab) =>
                onChange((b) => (b.type === "membership_strip" ? { ...b, linkOpenInNewTab } : b))
              }
              hidden={block.linkHidden}
              onChangeHidden={(linkHidden) =>
                onChange((b) => (b.type === "membership_strip" ? { ...b, linkHidden } : b))
              }
              compact
            />
            <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={block.showArrow !== false}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "membership_strip" ? { ...b, showArrow: e.target.checked } : b
                  )
                }
              />
              Show trailing arrow icon
            </label>
          </div>
          <BlockStyleControls
            style={block.style}
            showBorder
            onChange={(style) =>
              onChange((b) => (b.type === "membership_strip" ? { ...b, style } : b))
            }
          />
        </div>
      );

    case "icon_divider":
      return (
        <div className="space-y-3">
          <EmailIconPicker
            icon={block.icon}
            tone={block.iconTone}
            appUrl={appUrl}
            onChangeIcon={(icon) =>
              onChange((b) => (b.type === "icon_divider" ? { ...b, icon } : b))
            }
            onChangeTone={(iconTone) =>
              onChange((b) => (b.type === "icon_divider" ? { ...b, iconTone } : b))
            }
          />
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-zinc-400">Rule Line Color</span>
            <input
              type="color"
              value={block.lineColor || "#d4d4d8"}
              onChange={(e) =>
                onChange((b) => (b.type === "icon_divider" ? { ...b, lineColor: e.target.value } : b))
              }
              className="h-7 w-12 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
            />
          </div>
          <BlockStyleControls
            style={block.style}
            onChange={(style) =>
              onChange((b) => (b.type === "icon_divider" ? { ...b, style } : b))
            }
          />
        </div>
      );

    case "hero_text":
      return (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>Headline</label>
            <input
              type="text"
              value={block.headline}
              onChange={(e) =>
                onChange((b) => (b.type === "hero_text" ? { ...b, headline: e.target.value } : b))
              }
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Intro Paragraph</label>
            <textarea
              rows={3}
              value={block.body}
              onChange={(e) =>
                onChange((b) => (b.type === "hero_text" ? { ...b, body: e.target.value } : b))
              }
              className={inputClass}
            />
          </div>
          <InlineLinksEditor
            inlineLinks={block.inlineLinks}
            resolvedVariables={effectiveVars}
            onChangeLinks={(inlineLinks) =>
              onChange((b) => (b.type === "hero_text" ? { ...b, inlineLinks } : b))
            }
            onInsertToken={(token) =>
              onChange((b) =>
                b.type === "hero_text"
                  ? { ...b, body: b.body ? `${b.body} ${token}` : token }
                  : b
              )
            }
            onRemoveToken={(token) =>
              onChange((b) =>
                b.type === "hero_text"
                  ? { ...b, body: b.body.split(token).join("").replace(/\s{2,}/g, " ").trim() }
                  : b
              )
            }
          />
          <ModernButtonEditor
            label={block.buttonLabel}
            url={block.buttonUrl}
            buttonStyle={block.buttonStyle}
            buttonCorner={block.buttonCorner}
            buttonBgColor={block.buttonBgColor}
            buttonTextColor={block.buttonTextColor}
            buttonBorderColor={block.buttonBorderColor}
            buttonOpenInNewTab={block.buttonOpenInNewTab}
            buttonHidden={block.buttonHidden}
            resolvedVariables={effectiveVars}
            onPatch={(patch) =>
              onChange((b) => (b.type === "hero_text" ? { ...b, ...patch } : b))
            }
          />
          <BlockStyleControls
            style={block.style}
            showAlign
            showVerticalAlign
            onChange={(style) =>
              onChange((b) => (b.type === "hero_text" ? { ...b, style } : b))
            }
          />
        </div>
      );

    case "confirmation_number":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Uppercase Label</label>
              <input
                type="text"
                value={block.label}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "confirmation_number" ? { ...b, label: e.target.value } : b
                  )
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Confirmation Code Variable</label>
              <input
                type="text"
                value={block.valueTemplate}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "confirmation_number"
                      ? { ...b, valueTemplate: e.target.value }
                      : b
                  )
                }
                className={`${inputClass} font-mono`}
              />
            </div>
          </div>
          <BlockStyleControls
            style={block.style}
            showRadius
            onChange={(style) =>
              onChange((b) => (b.type === "confirmation_number" ? { ...b, style } : b))
            }
          />
        </div>
      );

    case "stay_dates":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelClass}>Check-In Column</label>
              <input
                type="text"
                value={block.checkInLabel}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "stay_dates" ? { ...b, checkInLabel: e.target.value } : b
                  )
                }
                placeholder="CHECK-IN"
                className={inputClass}
              />
              <input
                type="text"
                value={block.checkInDateTemplate}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "stay_dates" ? { ...b, checkInDateTemplate: e.target.value } : b
                  )
                }
                placeholder="{{check_in_date}}"
                className={`${inputClass} font-mono`}
              />
              <input
                type="text"
                value={block.checkInTimeTemplate}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "stay_dates" ? { ...b, checkInTimeTemplate: e.target.value } : b
                  )
                }
                placeholder="{{check_in_time}}"
                className={`${inputClass} font-mono`}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Check-Out Column</label>
              <input
                type="text"
                value={block.checkOutLabel}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "stay_dates" ? { ...b, checkOutLabel: e.target.value } : b
                  )
                }
                placeholder="CHECK-OUT"
                className={inputClass}
              />
              <input
                type="text"
                value={block.checkOutDateTemplate}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "stay_dates" ? { ...b, checkOutDateTemplate: e.target.value } : b
                  )
                }
                placeholder="{{check_out_date}}"
                className={`${inputClass} font-mono`}
              />
              <input
                type="text"
                value={block.checkOutTimeTemplate}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "stay_dates" ? { ...b, checkOutTimeTemplate: e.target.value } : b
                  )
                }
                placeholder="{{check_out_time}}"
                className={`${inputClass} font-mono`}
              />
            </div>
          </div>
          <ModernButtonEditor
            label={block.buttonLabel}
            url={block.buttonUrl}
            buttonStyle={block.buttonStyle}
            buttonCorner={block.buttonCorner}
            buttonBgColor={block.buttonBgColor}
            buttonTextColor={block.buttonTextColor}
            buttonBorderColor={block.buttonBorderColor}
            buttonOpenInNewTab={block.buttonOpenInNewTab}
            buttonHidden={block.buttonHidden}
            resolvedVariables={effectiveVars}
            onPatch={(patch) =>
              onChange((b) => (b.type === "stay_dates" ? { ...b, ...patch } : b))
            }
          />
          <BlockStyleControls
            style={block.style}
            showBorder
            onChange={(style) =>
              onChange((b) => (b.type === "stay_dates" ? { ...b, style } : b))
            }
          />
        </div>
      );

    case "feature_card":
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-400">Image Position (desktop):</span>
            {(["left", "right"] as const).map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() =>
                  onChange((b) => (b.type === "feature_card" ? { ...b, imagePosition: pos } : b))
                }
                className={`px-2.5 py-1 rounded text-[11px] font-medium capitalize border ${
                  block.imagePosition === pos
                    ? "bg-emerald-600 border-emerald-500 text-white"
                    : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Image {pos}
              </button>
            ))}
          </div>
          <ImageFieldControl
            blockId={block.id}
            fieldKey="imageUrl"
            label="Card Image / GIF (stacks on top on mobile)"
            url={block.imageUrl}
            alt={block.imageAlt}
            onUrlChange={(imageUrl) =>
              onChange((b) =>
                b.type === "feature_card" ? { ...b, imageUrl, imageId: undefined } : b
              )
            }
            onAltChange={(imageAlt) =>
              onChange((b) => (b.type === "feature_card" ? { ...b, imageAlt } : b))
            }
            imageActions={imageActions}
          />
          <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5">
            <LinkDestinationField
              label="Optional Card Image Click Link"
              url={block.imageLinkUrl || ""}
              visibleLabel={block.imageAlt || block.title}
              onChangeUrl={(imageLinkUrl) =>
                onChange((b) => (b.type === "feature_card" ? { ...b, imageLinkUrl } : b))
              }
              allowEmpty
              resolvedVariables={effectiveVars}
              compact
            />
          </div>
          <div>
            <label className={labelClass}>Card Title</label>
            <input
              type="text"
              value={block.title}
              onChange={(e) =>
                onChange((b) => (b.type === "feature_card" ? { ...b, title: e.target.value } : b))
              }
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Card Description</label>
            <textarea
              rows={2}
              value={block.body}
              onChange={(e) =>
                onChange((b) => (b.type === "feature_card" ? { ...b, body: e.target.value } : b))
              }
              className={inputClass}
            />
          </div>
          <InlineLinksEditor
            inlineLinks={block.inlineLinks}
            resolvedVariables={effectiveVars}
            onChangeLinks={(inlineLinks) =>
              onChange((b) => (b.type === "feature_card" ? { ...b, inlineLinks } : b))
            }
            onInsertToken={(token) =>
              onChange((b) =>
                b.type === "feature_card"
                  ? { ...b, body: b.body ? `${b.body} ${token}` : token }
                  : b
              )
            }
            onRemoveToken={(token) =>
              onChange((b) =>
                b.type === "feature_card"
                  ? { ...b, body: b.body.split(token).join("").replace(/\s{2,}/g, " ").trim() }
                  : b
              )
            }
          />
          <ModernButtonEditor
            label={block.buttonLabel}
            url={block.buttonUrl}
            buttonStyle={block.buttonStyle}
            buttonCorner={block.buttonCorner}
            buttonBgColor={block.buttonBgColor}
            buttonTextColor={block.buttonTextColor}
            buttonBorderColor={block.buttonBorderColor}
            buttonOpenInNewTab={block.buttonOpenInNewTab}
            buttonHidden={block.buttonHidden}
            resolvedVariables={effectiveVars}
            onPatch={(patch) =>
              onChange((b) => (b.type === "feature_card" ? { ...b, ...patch } : b))
            }
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <NinePointAlignPicker
              label="Card Image Placement"
              align={block.imageAlign}
              verticalAlign={block.imageVerticalAlign}
              defaultAlign="left"
              defaultVerticalAlign="top"
              onChange={(imageAlign, imageVerticalAlign) =>
                onChange((b) =>
                  b.type === "feature_card" ? { ...b, imageAlign, imageVerticalAlign } : b
                )
              }
            />
            <NinePointAlignPicker
              label="Card Text Placement"
              align={block.textAlign || block.style?.align}
              verticalAlign={block.textVerticalAlign || block.style?.verticalAlign}
              defaultAlign="left"
              defaultVerticalAlign="middle"
              onChange={(textAlign, textVerticalAlign) =>
                onChange((b) =>
                  b.type === "feature_card" ? { ...b, textAlign, textVerticalAlign } : b
                )
              }
            />
          </div>
          <BlockStyleControls
            style={block.style}
            showBorder
            showRadius
            onChange={(style) =>
              onChange((b) => (b.type === "feature_card" ? { ...b, style } : b))
            }
          />
        </div>
      );

    case "benefits_list":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Small Badge Label (Optional)</label>
              <input
                type="text"
                value={block.badgeText || ""}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "benefits_list" ? { ...b, badgeText: e.target.value } : b
                  )
                }
                placeholder="{{loyalty_tier}}"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Row Marker Style</label>
              <select
                value={block.listStyle}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "benefits_list"
                      ? { ...b, listStyle: e.target.value as "bullet" | "icon" }
                      : b
                  )
                }
                className={inputClass}
              >
                <option value="bullet">Classic Bullets</option>
                <option value="icon">Built-in Icon</option>
              </select>
            </div>
          </div>

          {block.listStyle === "icon" && (
            <EmailIconPicker
              icon={block.itemIcon || "check"}
              tone={block.iconTone}
              appUrl={appUrl}
              onChangeIcon={(itemIcon) =>
                onChange((b) => (b.type === "benefits_list" ? { ...b, itemIcon } : b))
              }
              onChangeTone={(iconTone) =>
                onChange((b) => (b.type === "benefits_list" ? { ...b, iconTone } : b))
              }
            />
          )}

          <div>
            <label className={labelClass}>Section Heading</label>
            <input
              type="text"
              value={block.heading}
              onChange={(e) =>
                onChange((b) => (b.type === "benefits_list" ? { ...b, heading: e.target.value } : b))
              }
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label className={labelClass}>Benefit Items</label>
            {block.items.map((it) => (
              <div key={it.id} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={it.text}
                  onChange={(e) =>
                    onChange((b) =>
                      b.type === "benefits_list"
                        ? {
                            ...b,
                            items: b.items.map((x) =>
                              x.id === it.id ? { ...x, text: e.target.value } : x
                            ),
                          }
                        : b
                    )
                  }
                  className={inputClass}
                />
                <button
                  type="button"
                  disabled={block.items.length <= 1}
                  onClick={() =>
                    onChange((b) =>
                      b.type === "benefits_list"
                        ? { ...b, items: b.items.filter((x) => x.id !== it.id) }
                        : b
                    )
                  }
                  className="p-1 text-zinc-500 hover:text-red-400 disabled:opacity-30"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                onChange((b) =>
                  b.type === "benefits_list"
                    ? { ...b, items: [...b.items, { id: makeId("bf"), text: "New benefit item" }] }
                    : b
                )
              }
              className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium"
            >
              <Plus size={12} /> Add Benefit Row
            </button>
          </div>

          <div>
            <label className={labelClass}>Footnote (Optional)</label>
            <input
              type="text"
              value={block.footnote || ""}
              onChange={(e) =>
                onChange((b) =>
                  b.type === "benefits_list" ? { ...b, footnote: e.target.value } : b
                )
              }
              className={inputClass}
            />
          </div>

          <InlineLinksEditor
            inlineLinks={block.inlineLinks}
            resolvedVariables={effectiveVars}
            helperHint="Place [[link:id]] in any benefit row or the footnote."
            onChangeLinks={(inlineLinks) =>
              onChange((b) => (b.type === "benefits_list" ? { ...b, inlineLinks } : b))
            }
            onInsertToken={(token) =>
              onChange((b) =>
                b.type === "benefits_list"
                  ? {
                      ...b,
                      footnote: b.footnote ? `${b.footnote} ${token}` : token,
                    }
                  : b
              )
            }
            onRemoveToken={(token) =>
              onChange((b) =>
                b.type === "benefits_list"
                  ? {
                      ...b,
                      items: b.items.map((it) => ({
                        ...it,
                        text: it.text.split(token).join("").replace(/\s{2,}/g, " ").trim(),
                      })),
                      footnote: b.footnote
                        ? b.footnote.split(token).join("").replace(/\s{2,}/g, " ").trim()
                        : b.footnote,
                    }
                  : b
              )
            }
          />

          <ModernButtonEditor
            label={block.buttonLabel}
            url={block.buttonUrl}
            buttonStyle={block.buttonStyle}
            buttonCorner={block.buttonCorner}
            buttonBgColor={block.buttonBgColor}
            buttonTextColor={block.buttonTextColor}
            buttonBorderColor={block.buttonBorderColor}
            buttonOpenInNewTab={block.buttonOpenInNewTab}
            buttonHidden={block.buttonHidden}
            resolvedVariables={effectiveVars}
            onPatch={(patch) =>
              onChange((b) => (b.type === "benefits_list" ? { ...b, ...patch } : b))
            }
          />
          <BlockStyleControls
            style={block.style}
            showAlign
            onChange={(style) =>
              onChange((b) => (b.type === "benefits_list" ? { ...b, style } : b))
            }
          />
        </div>
      );

    case "icon_link_grid":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Heading</label>
              <input
                type="text"
                value={block.heading || ""}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "icon_link_grid" ? { ...b, heading: e.target.value } : b
                  )
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Subheading</label>
              <input
                type="text"
                value={block.subheading || ""}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "icon_link_grid" ? { ...b, subheading: e.target.value } : b
                  )
                }
                className={inputClass}
              />
            </div>
          </div>

          <EmailIconPicker
            tone={block.iconTone}
            appUrl={appUrl}
            showIconGrid={false}
            onChangeTone={(iconTone) =>
              onChange((b) => (b.type === "icon_link_grid" ? { ...b, iconTone } : b))
            }
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-zinc-400">
                Icon Links (2 to 4 items)
              </span>
              {block.items.length < 4 && (
                <button
                  type="button"
                  onClick={() =>
                    onChange((b) =>
                      b.type === "icon_link_grid"
                        ? {
                            ...b,
                            items: [
                              ...b.items,
                              {
                                id: makeId("ig"),
                                icon: "star",
                                label: "Explore",
                                url: "{{hotel_website}}",
                              },
                            ],
                          }
                        : b
                    )
                  }
                  className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium"
                >
                  <Plus size={12} /> Add Item
                </button>
              )}
            </div>
            {block.items.map((item, iIdx) => (
              <div
                key={item.id}
                className={`bg-zinc-950/60 border border-zinc-800/80 rounded-lg p-2.5 space-y-2 ${
                  item.hidden ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <select
                    value={item.icon}
                    onChange={(e) =>
                      onChange((b) =>
                        b.type === "icon_link_grid"
                          ? {
                              ...b,
                              items: b.items.map((x) =>
                                x.id === item.id
                                  ? { ...x, icon: e.target.value as EmailIconName }
                                  : x
                              ),
                            }
                          : b
                      )
                    }
                    className={`${inputClass} w-28`}
                  >
                    {[
                      "dining",
                      "activities",
                      "spa",
                      "wifi",
                      "parking",
                      "map",
                      "calendar",
                      "key",
                      "chat",
                      "star",
                      "gift",
                      "location_pin",
                      "phone",
                      "check",
                      "arrow",
                    ].map((ic) => (
                      <option key={ic} value={ic}>
                        {ic.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={item.label}
                    onChange={(e) =>
                      onChange((b) =>
                        b.type === "icon_link_grid"
                          ? {
                              ...b,
                              items: b.items.map((x) =>
                                x.id === item.id ? { ...x, label: e.target.value } : x
                              ),
                            }
                          : b
                      )
                    }
                    placeholder="Label"
                    className={`${inputClass} flex-1`}
                  />
                  <button
                    type="button"
                    title={item.hidden ? "Show item" : "Hide item"}
                    onClick={() =>
                      onChange((b) =>
                        b.type === "icon_link_grid"
                          ? {
                              ...b,
                              items: b.items.map((x) =>
                                x.id === item.id ? { ...x, hidden: !x.hidden } : x
                              ),
                            }
                          : b
                      )
                    }
                    className="p-1 text-zinc-400 hover:text-zinc-100"
                  >
                    {item.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button
                    type="button"
                    disabled={iIdx === 0}
                    onClick={() =>
                      onChange((b) => {
                        if (b.type !== "icon_link_grid" || iIdx === 0) return b;
                        const copy = [...b.items];
                        const [m] = copy.splice(iIdx, 1);
                        copy.splice(iIdx - 1, 0, m);
                        return { ...b, items: copy };
                      })
                    }
                    className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    type="button"
                    disabled={iIdx === block.items.length - 1}
                    onClick={() =>
                      onChange((b) => {
                        if (b.type !== "icon_link_grid" || iIdx >= b.items.length - 1) return b;
                        const copy = [...b.items];
                        const [m] = copy.splice(iIdx, 1);
                        copy.splice(iIdx + 1, 0, m);
                        return { ...b, items: copy };
                      })
                    }
                    className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
                  >
                    <ArrowDown size={12} />
                  </button>
                  <button
                    type="button"
                    disabled={block.items.length <= 2}
                    onClick={() =>
                      onChange((b) =>
                        b.type === "icon_link_grid"
                          ? { ...b, items: b.items.filter((x) => x.id !== item.id) }
                          : b
                      )
                    }
                    className="p-1 text-zinc-500 hover:text-red-400 disabled:opacity-30"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <LinkDestinationField
                  url={item.url}
                  visibleLabel={item.label}
                  onChangeUrl={(url) =>
                    onChange((b) =>
                      b.type === "icon_link_grid"
                        ? {
                            ...b,
                            items: b.items.map((x) => (x.id === item.id ? { ...x, url } : x)),
                          }
                        : b
                    )
                  }
                  allowContactSchemes
                  allowEmpty={Boolean(item.hidden)}
                  resolvedVariables={effectiveVars}
                  openInNewTab={item.openInNewTab}
                  onChangeOpenInNewTab={(openInNewTab) =>
                    onChange((b) =>
                      b.type === "icon_link_grid"
                        ? {
                            ...b,
                            items: b.items.map((x) =>
                              x.id === item.id ? { ...x, openInNewTab } : x
                            ),
                          }
                        : b
                    )
                  }
                  compact
                />
              </div>
            ))}
          </div>
          <BlockStyleControls
            style={block.style}
            onChange={(style) =>
              onChange((b) => (b.type === "icon_link_grid" ? { ...b, style } : b))
            }
          />
        </div>
      );

    case "image_with_list":
      return (
        <div className="space-y-3">
          <ImageFieldControl
            blockId={block.id}
            fieldKey="imageUrl"
            label="Feature Visual / GIF"
            url={block.imageUrl}
            alt={block.imageAlt}
            onUrlChange={(imageUrl) =>
              onChange((b) =>
                b.type === "image_with_list" ? { ...b, imageUrl, imageId: undefined } : b
              )
            }
            onAltChange={(imageAlt) =>
              onChange((b) => (b.type === "image_with_list" ? { ...b, imageAlt } : b))
            }
            imageActions={imageActions}
          />
          <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5">
            <LinkDestinationField
              label="Optional Visual Click Link"
              url={block.imageLinkUrl || ""}
              visibleLabel={block.imageAlt || block.heading}
              onChangeUrl={(imageLinkUrl) =>
                onChange((b) => (b.type === "image_with_list" ? { ...b, imageLinkUrl } : b))
              }
              allowEmpty
              resolvedVariables={effectiveVars}
              compact
            />
          </div>
          <div>
            <label className={labelClass}>Heading</label>
            <input
              type="text"
              value={block.heading}
              onChange={(e) =>
                onChange((b) =>
                  b.type === "image_with_list" ? { ...b, heading: e.target.value } : b
                )
              }
              className={inputClass}
            />
          </div>
          <EmailIconPicker
            tone={block.iconTone}
            appUrl={appUrl}
            showIconGrid={false}
            onChangeTone={(iconTone) =>
              onChange((b) => (b.type === "image_with_list" ? { ...b, iconTone } : b))
            }
          />
          <div className="space-y-1.5">
            <label className={labelClass}>Feature Rows</label>
            {block.items.map((it) => (
              <div key={it.id} className="flex items-center gap-1.5">
                <select
                  value={it.icon}
                  onChange={(e) =>
                    onChange((b) =>
                      b.type === "image_with_list"
                        ? {
                            ...b,
                            items: b.items.map((x) =>
                              x.id === it.id
                                ? { ...x, icon: e.target.value as EmailIconName }
                                : x
                            ),
                          }
                        : b
                    )
                  }
                  className={`${inputClass} w-28`}
                >
                  {[
                    "calendar",
                    "key",
                    "chat",
                    "check",
                    "wifi",
                    "dining",
                    "spa",
                    "parking",
                    "map",
                    "star",
                    "gift",
                  ].map((ic) => (
                    <option key={ic} value={ic}>
                      {ic}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={it.text}
                  onChange={(e) =>
                    onChange((b) =>
                      b.type === "image_with_list"
                        ? {
                            ...b,
                            items: b.items.map((x) =>
                              x.id === it.id ? { ...x, text: e.target.value } : x
                            ),
                          }
                        : b
                    )
                  }
                  className={`${inputClass} flex-1`}
                />
                <button
                  type="button"
                  onClick={() =>
                    onChange((b) =>
                      b.type === "image_with_list"
                        ? { ...b, items: b.items.filter((x) => x.id !== it.id) }
                        : b
                    )
                  }
                  className="p-1 text-zinc-500 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                onChange((b) =>
                  b.type === "image_with_list"
                    ? {
                        ...b,
                        items: [
                          ...b.items,
                          { id: makeId("il"), icon: "check", text: "New feature highlight" },
                        ],
                      }
                    : b
                )
              }
              className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium"
            >
              <Plus size={12} /> Add Feature Row
            </button>
          </div>
          <InlineLinksEditor
            inlineLinks={block.inlineLinks}
            resolvedVariables={effectiveVars}
            helperHint="Place [[link:id]] inside any feature row text."
            onChangeLinks={(inlineLinks) =>
              onChange((b) => (b.type === "image_with_list" ? { ...b, inlineLinks } : b))
            }
            onInsertToken={(token) =>
              onChange((b) => {
                if (b.type !== "image_with_list" || b.items.length === 0) return b;
                const lastIdx = b.items.length - 1;
                return {
                  ...b,
                  items: b.items.map((it, idx) =>
                    idx === lastIdx ? { ...it, text: it.text ? `${it.text} ${token}` : token } : it
                  ),
                };
              })
            }
            onRemoveToken={(token) =>
              onChange((b) =>
                b.type === "image_with_list"
                  ? {
                      ...b,
                      items: b.items.map((it) => ({
                        ...it,
                        text: it.text.split(token).join("").replace(/\s{2,}/g, " ").trim(),
                      })),
                    }
                  : b
              )
            }
          />
          <ModernButtonEditor
            label={block.buttonLabel}
            url={block.buttonUrl}
            buttonStyle={block.buttonStyle}
            buttonCorner={block.buttonCorner}
            buttonBgColor={block.buttonBgColor}
            buttonTextColor={block.buttonTextColor}
            buttonBorderColor={block.buttonBorderColor}
            buttonOpenInNewTab={block.buttonOpenInNewTab}
            buttonHidden={block.buttonHidden}
            resolvedVariables={effectiveVars}
            onPatch={(patch) =>
              onChange((b) => (b.type === "image_with_list" ? { ...b, ...patch } : b))
            }
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <NinePointAlignPicker
              label="Image Placement"
              align={block.imageAlign}
              verticalAlign={block.imageVerticalAlign}
              defaultAlign="left"
              defaultVerticalAlign="middle"
              onChange={(imageAlign, imageVerticalAlign) =>
                onChange((b) =>
                  b.type === "image_with_list" ? { ...b, imageAlign, imageVerticalAlign } : b
                )
              }
            />
            <NinePointAlignPicker
              label="Text & List Placement"
              align={block.textAlign || block.style?.align}
              verticalAlign={block.textVerticalAlign || block.style?.verticalAlign}
              defaultAlign="left"
              defaultVerticalAlign="middle"
              onChange={(textAlign, textVerticalAlign) =>
                onChange((b) =>
                  b.type === "image_with_list" ? { ...b, textAlign, textVerticalAlign } : b
                )
              }
            />
          </div>
          <BlockStyleControls
            style={block.style}
            showRadius
            onChange={(style) =>
              onChange((b) => (b.type === "image_with_list" ? { ...b, style } : b))
            }
          />
        </div>
      );

    case "footer_nav":
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className={labelClass}>Footer Navigation Links (add, rename, reorder, hide)</label>
            {block.links.map((l, lIdx) => (
              <div
                key={l.id}
                className={`rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5 space-y-2 ${
                  l.hidden ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={l.label}
                    onChange={(e) =>
                      onChange((b) =>
                        b.type === "footer_nav"
                          ? {
                              ...b,
                              links: b.links.map((x) =>
                                x.id === l.id ? { ...x, label: e.target.value } : x
                              ),
                            }
                          : b
                      )
                    }
                    placeholder="Link text (e.g. Terms, Privacy, FAQ)"
                    className={`${inputClass} flex-1`}
                  />
                  <button
                    type="button"
                    title={l.hidden ? "Show link" : "Hide link"}
                    onClick={() =>
                      onChange((b) =>
                        b.type === "footer_nav"
                          ? {
                              ...b,
                              links: b.links.map((x) =>
                                x.id === l.id ? { ...x, hidden: !x.hidden } : x
                              ),
                            }
                          : b
                      )
                    }
                    className="p-1 text-zinc-400 hover:text-zinc-100"
                  >
                    {l.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button
                    type="button"
                    disabled={lIdx === 0}
                    onClick={() =>
                      onChange((b) => {
                        if (b.type !== "footer_nav" || lIdx === 0) return b;
                        const copy = [...b.links];
                        const [m] = copy.splice(lIdx, 1);
                        copy.splice(lIdx - 1, 0, m);
                        return { ...b, links: copy };
                      })
                    }
                    className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    type="button"
                    disabled={lIdx === block.links.length - 1}
                    onClick={() =>
                      onChange((b) => {
                        if (b.type !== "footer_nav" || lIdx >= b.links.length - 1) return b;
                        const copy = [...b.links];
                        const [m] = copy.splice(lIdx, 1);
                        copy.splice(lIdx + 1, 0, m);
                        return { ...b, links: copy };
                      })
                    }
                    className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
                  >
                    <ArrowDown size={12} />
                  </button>
                  <button
                    type="button"
                    disabled={block.links.length <= 1}
                    onClick={() =>
                      onChange((b) =>
                        b.type === "footer_nav"
                          ? { ...b, links: b.links.filter((x) => x.id !== l.id) }
                          : b
                      )
                    }
                    className="p-1 text-zinc-500 hover:text-red-400 disabled:opacity-30"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <LinkDestinationField
                  url={l.url}
                  visibleLabel={l.label}
                  onChangeUrl={(url) =>
                    onChange((b) =>
                      b.type === "footer_nav"
                        ? {
                            ...b,
                            links: b.links.map((x) => (x.id === l.id ? { ...x, url } : x)),
                          }
                        : b
                    )
                  }
                  allowContactSchemes
                  allowEmpty={Boolean(l.hidden)}
                  resolvedVariables={effectiveVars}
                  color={l.color}
                  onChangeColor={(color) =>
                    onChange((b) =>
                      b.type === "footer_nav"
                        ? {
                            ...b,
                            links: b.links.map((x) => (x.id === l.id ? { ...x, color } : x)),
                          }
                        : b
                    )
                  }
                  underline={l.underline}
                  onChangeUnderline={(underline) =>
                    onChange((b) =>
                      b.type === "footer_nav"
                        ? {
                            ...b,
                            links: b.links.map((x) => (x.id === l.id ? { ...x, underline } : x)),
                          }
                        : b
                    )
                  }
                  openInNewTab={l.openInNewTab}
                  onChangeOpenInNewTab={(openInNewTab) =>
                    onChange((b) =>
                      b.type === "footer_nav"
                        ? {
                            ...b,
                            links: b.links.map((x) =>
                              x.id === l.id ? { ...x, openInNewTab } : x
                            ),
                          }
                        : b
                    )
                  }
                  compact
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                onChange((b) =>
                  b.type === "footer_nav"
                    ? {
                        ...b,
                        links: [
                          ...b.links,
                          { id: makeId("fn"), label: "Contact", url: "mailto:{{hotel_email}}" },
                        ],
                      }
                    : b
                )
              }
              className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium"
            >
              <Plus size={12} /> Add Navigation Link
            </button>
          </div>
          <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5 space-y-2">
            <div>
              <label className={labelClass}>Secondary Line Text (Optional)</label>
              <input
                type="text"
                value={block.secondaryText || ""}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "footer_nav" ? { ...b, secondaryText: e.target.value } : b
                  )
                }
                placeholder="e.g. Manage your reservation online"
                className={inputClass}
              />
            </div>
            <LinkDestinationField
              label="Secondary Link Destination (Optional)"
              url={block.secondaryLinkUrl || ""}
              visibleLabel={block.secondaryText}
              onChangeUrl={(secondaryLinkUrl) =>
                onChange((b) =>
                  b.type === "footer_nav" ? { ...b, secondaryLinkUrl } : b
                )
              }
              allowContactSchemes
              allowEmpty
              resolvedVariables={effectiveVars}
              openInNewTab={block.secondaryLinkOpenInNewTab}
              onChangeOpenInNewTab={(secondaryLinkOpenInNewTab) =>
                onChange((b) =>
                  b.type === "footer_nav" ? { ...b, secondaryLinkOpenInNewTab } : b
                )
              }
              hidden={block.secondaryLinkHidden}
              onChangeHidden={(secondaryLinkHidden) =>
                onChange((b) =>
                  b.type === "footer_nav" ? { ...b, secondaryLinkHidden } : b
                )
              }
              compact
            />
          </div>
          <BlockStyleControls
            style={block.style}
            showBorder
            onChange={(style) =>
              onChange((b) => (b.type === "footer_nav" ? { ...b, style } : b))
            }
          />
        </div>
      );

    case "legal_section":
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className={labelClass}>Legal / Information Sections</label>
            {block.sections.map((sec) => (
              <div
                key={sec.id}
                className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2 space-y-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={sec.heading}
                    onChange={(e) =>
                      onChange((b) =>
                        b.type === "legal_section"
                          ? {
                              ...b,
                              sections: b.sections.map((x) =>
                                x.id === sec.id ? { ...x, heading: e.target.value } : x
                              ),
                            }
                          : b
                      )
                    }
                    placeholder="Small section heading"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onChange((b) =>
                        b.type === "legal_section"
                          ? { ...b, sections: b.sections.filter((x) => x.id !== sec.id) }
                          : b
                      )
                    }
                    className="p-1 text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={sec.body}
                  onChange={(e) =>
                    onChange((b) =>
                      b.type === "legal_section"
                        ? {
                            ...b,
                            sections: b.sections.map((x) =>
                              x.id === sec.id ? { ...x, body: e.target.value } : x
                            ),
                          }
                        : b
                    )
                  }
                  className={inputClass}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                onChange((b) =>
                  b.type === "legal_section"
                    ? {
                        ...b,
                        sections: [
                          ...b.sections,
                          { id: makeId("lg"), heading: "Notice", body: "Additional hotel notice." },
                        ],
                      }
                    : b
                )
              }
              className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-medium"
            >
              <Plus size={12} /> Add Legal Section
            </button>
          </div>
          <InlineLinksEditor
            inlineLinks={block.inlineLinks}
            resolvedVariables={effectiveVars}
            helperHint="Place [[link:id]] in any section body or copyright line."
            onChangeLinks={(inlineLinks) =>
              onChange((b) => (b.type === "legal_section" ? { ...b, inlineLinks } : b))
            }
            onInsertToken={(token) =>
              onChange((b) => {
                if (b.type !== "legal_section") return b;
                if (b.sections.length > 0) {
                  const lastIdx = b.sections.length - 1;
                  return {
                    ...b,
                    sections: b.sections.map((s, idx) =>
                      idx === lastIdx ? { ...s, body: s.body ? `${s.body} ${token}` : token } : s
                    ),
                  };
                }
                return {
                  ...b,
                  copyrightText: b.copyrightText ? `${b.copyrightText} ${token}` : token,
                };
              })
            }
            onRemoveToken={(token) =>
              onChange((b) =>
                b.type === "legal_section"
                  ? {
                      ...b,
                      sections: b.sections.map((s) => ({
                        ...s,
                        body: s.body.split(token).join("").replace(/\s{2,}/g, " ").trim(),
                      })),
                      copyrightText: b.copyrightText
                        ? b.copyrightText.split(token).join("").replace(/\s{2,}/g, " ").trim()
                        : b.copyrightText,
                    }
                  : b
              )
            }
          />
          <div>
            <label className={labelClass}>Copyright Line</label>
            <input
              type="text"
              value={block.copyrightText || ""}
              onChange={(e) =>
                onChange((b) =>
                  b.type === "legal_section" ? { ...b, copyrightText: e.target.value } : b
                )
              }
              className={inputClass}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={Boolean(block.showFooterLogo)}
              onChange={(e) =>
                onChange((b) =>
                  b.type === "legal_section" ? { ...b, showFooterLogo: e.target.checked } : b
                )
              }
            />
            Show centered bottom hotel logo
          </label>
          {block.showFooterLogo && (
            <div className="space-y-2">
              <ImageFieldControl
                blockId={block.id}
                fieldKey="footerLogoUrl"
                label="Bottom Logo Image"
                url={block.footerLogoUrl || ""}
                alt={block.footerLogoAlt || "{{hotel_name}}"}
                onUrlChange={(footerLogoUrl) =>
                  onChange((b) =>
                    b.type === "legal_section"
                      ? { ...b, footerLogoUrl, footerLogoImageId: undefined }
                      : b
                  )
                }
                onAltChange={(footerLogoAlt) =>
                  onChange((b) => (b.type === "legal_section" ? { ...b, footerLogoAlt } : b))
                }
                imageActions={imageActions}
              />
              <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5">
                <LinkDestinationField
                  label="Optional Bottom Logo Link"
                  url={block.footerLogoLinkUrl || ""}
                  visibleLabel={block.footerLogoAlt || "{{hotel_name}}"}
                  onChangeUrl={(footerLogoLinkUrl) =>
                    onChange((b) =>
                      b.type === "legal_section" ? { ...b, footerLogoLinkUrl } : b
                    )
                  }
                  allowEmpty
                  resolvedVariables={effectiveVars}
                  compact
                />
              </div>
            </div>
          )}
          <BlockStyleControls
            style={block.style}
            onChange={(style) =>
              onChange((b) => (b.type === "legal_section" ? { ...b, style } : b))
            }
          />
        </div>
      );

    // --- 5 STANDALONE EDITABLE FOOTER BLOCKS ---
    case "footer_contact":
    case "footer_authenticity":
    case "footer_legal":
      return (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>Section Heading</label>
            <input
              type="text"
              value={block.heading}
              onChange={(e) =>
                onChange((b) =>
                  b.type === block.type ? { ...b, heading: e.target.value } : b
                )
              }
              placeholder={
                block.type === "footer_contact"
                  ? "Contact Us"
                  : block.type === "footer_authenticity"
                    ? "Confirmation Authenticity"
                    : "Legal / Impressum"
              }
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Footer Text (Supports allow-listed merge variables)</label>
            <textarea
              rows={3}
              value={block.text}
              onChange={(e) =>
                onChange((b) =>
                  b.type === block.type ? { ...b, text: e.target.value } : b
                )
              }
              placeholder={
                block.type === "footer_legal"
                  ? "{{legal_imprint}} or type custom Impressum / privacy / cancellation text"
                  : "Enter footer message..."
              }
              className={inputClass}
            />
            <FooterVariableInsertBar
              onInsert={(token) =>
                onChange((b) =>
                  b.type === block.type
                    ? { ...b, text: b.text ? `${b.text} ${token}` : token }
                    : b
                )
              }
            />
          </div>
          <InlineLinksEditor
            inlineLinks={block.inlineLinks}
            resolvedVariables={effectiveVars}
            onChangeLinks={(inlineLinks) =>
              onChange((b) => (b.type === block.type ? { ...b, inlineLinks } : b))
            }
            onInsertToken={(token) =>
              onChange((b) =>
                b.type === block.type
                  ? { ...b, text: b.text ? `${b.text} ${token}` : token }
                  : b
              )
            }
            onRemoveToken={(token) =>
              onChange((b) =>
                b.type === block.type
                  ? { ...b, text: b.text.split(token).join("").replace(/\s{2,}/g, " ").trim() }
                  : b
              )
            }
          />
          {block.type === "footer_contact" && (
            <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5 space-y-2.5">
              <div className="text-[11px] font-semibold text-zinc-300">
                Contact Email &amp; Phone Links (mailto: / tel:)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="space-y-1.5">
                  <label className={labelClass}>Email Address Override (Optional)</label>
                  <input
                    type="email"
                    value={block.emailOverride || ""}
                    onChange={(e) =>
                      onChange((b) =>
                        b.type === "footer_contact" ? { ...b, emailOverride: e.target.value } : b
                      )
                    }
                    placeholder="Leave blank for {{hotel_email}}"
                    className={`${inputClass} font-mono`}
                  />
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(block.emailLinkEnabled)}
                      onChange={(e) =>
                        onChange((b) =>
                          b.type === "footer_contact"
                            ? { ...b, emailLinkEnabled: e.target.checked }
                            : b
                        )
                      }
                    />
                    Link email as clickable mailto:
                  </label>
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Phone Number Override (Optional)</label>
                  <input
                    type="text"
                    value={block.phoneOverride || ""}
                    onChange={(e) =>
                      onChange((b) =>
                        b.type === "footer_contact" ? { ...b, phoneOverride: e.target.value } : b
                      )
                    }
                    placeholder="Leave blank for {{hotel_phone}}"
                    className={`${inputClass} font-mono`}
                  />
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(block.phoneLinkEnabled)}
                      onChange={(e) =>
                        onChange((b) =>
                          b.type === "footer_contact"
                            ? { ...b, phoneLinkEnabled: e.target.checked }
                            : b
                        )
                      }
                    />
                    Link phone as clickable tel:
                  </label>
                </div>
              </div>
              {(block.emailLinkEnabled || block.phoneLinkEnabled) && (
                <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-zinc-400">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={block.underline !== false}
                      onChange={(e) =>
                        onChange((b) =>
                          b.type === "footer_contact" ? { ...b, underline: e.target.checked } : b
                        )
                      }
                    />
                    Underline contact links
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <span>Link color</span>
                    <input
                      type="color"
                      value={block.linkColor || "#059669"}
                      onChange={(e) =>
                        onChange((b) =>
                          b.type === "footer_contact" ? { ...b, linkColor: e.target.value } : b
                        )
                      }
                      className="h-5 w-7 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
                    />
                  </label>
                </div>
              )}
            </div>
          )}
          <BlockStyleControls
            style={block.style}
            showAlign
            showBorder
            showTypography
            showHeadingColor
            onChange={(style) =>
              onChange((b) => (b.type === block.type ? { ...b, style } : b))
            }
          />
        </div>
      );

    case "footer_copyright":
      return (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>Copyright / Legal Line</label>
            <textarea
              rows={2}
              value={block.text}
              onChange={(e) =>
                onChange((b) =>
                  b.type === "footer_copyright" ? { ...b, text: e.target.value } : b
                )
              }
              placeholder="© {{hotel_name}} · {{hotel_address}}"
              className={inputClass}
            />
            <FooterVariableInsertBar
              onInsert={(token) =>
                onChange((b) =>
                  b.type === "footer_copyright"
                    ? { ...b, text: b.text ? `${b.text} ${token}` : token }
                    : b
                )
              }
            />
          </div>
          <InlineLinksEditor
            inlineLinks={block.inlineLinks}
            resolvedVariables={effectiveVars}
            onChangeLinks={(inlineLinks) =>
              onChange((b) => (b.type === "footer_copyright" ? { ...b, inlineLinks } : b))
            }
            onInsertToken={(token) =>
              onChange((b) =>
                b.type === "footer_copyright"
                  ? { ...b, text: b.text ? `${b.text} ${token}` : token }
                  : b
              )
            }
            onRemoveToken={(token) =>
              onChange((b) =>
                b.type === "footer_copyright"
                  ? { ...b, text: b.text.split(token).join("").replace(/\s{2,}/g, " ").trim() }
                  : b
              )
            }
          />
          <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={Boolean(block.showFooterLogo)}
              onChange={(e) =>
                onChange((b) =>
                  b.type === "footer_copyright"
                    ? { ...b, showFooterLogo: e.target.checked }
                    : b
                )
              }
            />
            Show bottom hotel logo below copyright line
          </label>
          {block.showFooterLogo && (
            <div className="space-y-2">
              <ImageFieldControl
                blockId={block.id}
                fieldKey="footerLogoUrl"
                label="Bottom Logo Image"
                url={block.footerLogoUrl || ""}
                alt={block.footerLogoAlt || "{{hotel_name}}"}
                onUrlChange={(footerLogoUrl) =>
                  onChange((b) =>
                    b.type === "footer_copyright"
                      ? { ...b, footerLogoUrl, footerLogoImageId: undefined }
                      : b
                  )
                }
                onAltChange={(footerLogoAlt) =>
                  onChange((b) =>
                    b.type === "footer_copyright" ? { ...b, footerLogoAlt } : b
                  )
                }
                imageActions={imageActions}
              />
              <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5">
                <LinkDestinationField
                  label="Optional Bottom Logo Link"
                  url={block.footerLogoLinkUrl || ""}
                  visibleLabel={block.footerLogoAlt || "{{hotel_name}}"}
                  onChangeUrl={(footerLogoLinkUrl) =>
                    onChange((b) =>
                      b.type === "footer_copyright" ? { ...b, footerLogoLinkUrl } : b
                    )
                  }
                  allowEmpty
                  resolvedVariables={effectiveVars}
                  compact
                />
              </div>
            </div>
          )}
          <BlockStyleControls
            style={block.style}
            showAlign
            showBorder
            showTypography
            onChange={(style) =>
              onChange((b) => (b.type === "footer_copyright" ? { ...b, style } : b))
            }
          />
        </div>
      );

    case "footer_powered_by":
      return (
        <div className="space-y-3">
          <p className="text-[11px] text-zinc-500">
            Optional credit line (off by default on all templates). Edit freely, hide, or delete anytime.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Credit Text</label>
              <input
                type="text"
                value={block.text}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "footer_powered_by" ? { ...b, text: e.target.value } : b
                  )
                }
                placeholder="Powered by"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Optional Link Label</label>
              <input
                type="text"
                value={block.linkLabel || ""}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "footer_powered_by" ? { ...b, linkLabel: e.target.value } : b
                  )
                }
                placeholder="{{hotel_name}}"
                className={inputClass}
              />
            </div>
          </div>
          <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5">
            <LinkDestinationField
              label="Optional Credit Link URL"
              url={block.linkUrl || ""}
              visibleLabel={block.linkLabel || block.text}
              onChangeUrl={(linkUrl) =>
                onChange((b) => (b.type === "footer_powered_by" ? { ...b, linkUrl } : b))
              }
              allowEmpty
              resolvedVariables={effectiveVars}
              color={block.linkColor}
              onChangeColor={(linkColor) =>
                onChange((b) => (b.type === "footer_powered_by" ? { ...b, linkColor } : b))
              }
              underline={block.underline}
              onChangeUnderline={(underline) =>
                onChange((b) => (b.type === "footer_powered_by" ? { ...b, underline } : b))
              }
              openInNewTab={block.openInNewTab}
              onChangeOpenInNewTab={(openInNewTab) =>
                onChange((b) => (b.type === "footer_powered_by" ? { ...b, openInNewTab } : b))
              }
              hidden={block.linkHidden}
              onChangeHidden={(linkHidden) =>
                onChange((b) => (b.type === "footer_powered_by" ? { ...b, linkHidden } : b))
              }
              compact
            />
          </div>
          <BlockStyleControls
            style={block.style}
            showAlign
            showTypography
            onChange={(style) =>
              onChange((b) => (b.type === "footer_powered_by" ? { ...b, style } : b))
            }
          />
        </div>
      );
  }
}
