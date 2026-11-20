import React from "react";
import {
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
  type BlockStyleConfig,
  type BookingDetailsRowConfig,
  type ButtonCornerStyle,
  type EmailBlock,
  type EmailIconName,
  type EmailIconTone,
  type FooterContactField,
  type ModernButtonStyle,
} from "../shared/types";
import { EmailIconPicker } from "./BlockPaletteModal";

export interface ImageActionCallbacks {
  onPickLibrary: (blockId: string, field: string) => void;
  onDirectUpload: (blockId: string, field: string) => void;
  uploadingKey: string | null;
}

interface BlockInspectorProps {
  block: EmailBlock;
  appUrl: string;
  resolvedPortalUrl: string;
  onChange: (updater: (b: EmailBlock) => EmailBlock) => void;
  imageActions: ImageActionCallbacks;
}

const inputClass =
  "w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors";

const labelClass = "block text-[11px] font-medium text-zinc-400 mb-1";

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
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
  resolvedPortalUrl,
  onPatch,
}: {
  label?: string;
  url?: string;
  buttonStyle?: ModernButtonStyle;
  buttonCorner?: ButtonCornerStyle;
  buttonBgColor?: string;
  buttonTextColor?: string;
  resolvedPortalUrl: string;
  onPatch: (patch: {
    buttonLabel?: string;
    buttonUrl?: string;
    buttonStyle?: ModernButtonStyle;
    buttonCorner?: ButtonCornerStyle;
    buttonBgColor?: string;
    buttonTextColor?: string;
  }) => void;
}) {
  const effectiveUrl =
    url === "{{portal_link}}" ? resolvedPortalUrl : url || "";

  return (
    <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5 space-y-2">
      <div className="text-[11px] font-semibold text-zinc-300">Button (Optional)</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
        <div>
          <label className={labelClass}>Button Link (HTTPS or variable)</label>
          <input
            type="text"
            value={url || ""}
            onChange={(e) => onPatch({ buttonUrl: e.target.value })}
            placeholder="{{portal_link}} or https://..."
            className={`${inputClass} font-mono`}
          />
        </div>
      </div>
      {effectiveUrl && (
        <div className="text-[11px] text-zinc-500 truncate">
          Final URL: <span className="text-emerald-400 font-mono">{effectiveUrl}</span>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
          <label className={labelClass}>Button Color</label>
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
      </div>
    </div>
  );
}

function BlockStyleControls({
  style,
  showAlign = false,
  showBorder = false,
  showRadius = false,
  onChange,
}: {
  style?: BlockStyleConfig;
  showAlign?: boolean;
  showBorder?: boolean;
  showRadius?: boolean;
  onChange: (next: BlockStyleConfig) => void;
}) {
  const s = style || {};
  return (
    <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/80 p-2.5 space-y-2.5">
      <div className="text-[11px] font-semibold text-zinc-400">Colors &amp; Spacing</div>
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
        {showBorder && (
          <div>
            <label className={labelClass}>Border Color</label>
            <input
              type="color"
              value={s.borderColor || "#e4e4e7"}
              onChange={(e) => onChange({ ...s, borderColor: e.target.value })}
              className="w-full h-7 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
            />
          </div>
        )}
        {showAlign && (
          <div>
            <label className={labelClass}>Alignment</label>
            <select
              value={s.align || "center"}
              onChange={(e) =>
                onChange({ ...s, align: e.target.value as "left" | "center" | "right" })
              }
              className={inputClass}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        )}
      </div>

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
  onChange,
  imageActions,
}: BlockInspectorProps) {
  switch (block.type) {
    // --- 10 CLASSIC BLOCKS ---
    case "heading":
      return (
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
          <div className="flex gap-1.5">
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
            <select
              value={block.align || "left"}
              onChange={(e) =>
                onChange((b) =>
                  b.type === "heading"
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
        </div>
      );

    case "paragraph":
      return (
        <div className="space-y-2">
          <textarea
            rows={3}
            value={block.text}
            onChange={(e) =>
              onChange((b) => (b.type === "paragraph" ? { ...b, text: e.target.value } : b))
            }
            className={inputClass}
          />
          <div className="flex gap-2">
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
            <select
              value={block.align || "left"}
              onChange={(e) =>
                onChange((b) =>
                  b.type === "paragraph"
                    ? { ...b, align: e.target.value as "left" | "center" | "right" }
                    : b
                )
              }
              className={`${inputClass} w-28`}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        </div>
      );

    case "image":
      return (
        <div className="space-y-2">
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className={labelClass}>Width (80–544px)</label>
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
            <div>
              <label className={labelClass}>Alignment</label>
              <select
                value={block.align || "center"}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "image"
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
              <label className={labelClass}>Optional Link URL</label>
              <input
                type="text"
                value={block.linkUrl || ""}
                onChange={(e) =>
                  onChange((b) => (b.type === "image" ? { ...b, linkUrl: e.target.value } : b))
                }
                placeholder="https://... or {{portal_link}}"
                className={`${inputClass} font-mono`}
              />
            </div>
          </div>
        </div>
      );

    case "button":
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={block.label}
              onChange={(e) =>
                onChange((b) => (b.type === "button" ? { ...b, label: e.target.value } : b))
              }
              placeholder="Button label"
              className={inputClass}
            />
            <input
              type="text"
              value={block.url}
              onChange={(e) =>
                onChange((b) => (b.type === "button" ? { ...b, url: e.target.value } : b))
              }
              placeholder="{{portal_link}} or https://..."
              className={`${inputClass} font-mono`}
            />
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
          {block.url === "{{portal_link}}" && (
            <div className="text-[11px] text-zinc-500">
              Resolves to: <span className="font-mono text-emerald-400">{resolvedPortalUrl}</span>
            </div>
          )}
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
      );

    case "social_links":
      return (
        <div className="space-y-2">
          <input
            type="text"
            value={block.title || ""}
            onChange={(e) =>
              onChange((b) => (b.type === "social_links" ? { ...b, title: e.target.value } : b))
            }
            placeholder="Heading"
            className={inputClass}
          />
          {block.links.map((item) => (
            <div key={item.id} className="flex items-center gap-1.5">
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
                className={`${inputClass} w-1/3`}
              />
              <input
                type="text"
                value={item.url}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "social_links"
                      ? {
                          ...b,
                          links: b.links.map((l) =>
                            l.id === item.id ? { ...l, url: e.target.value } : l
                          ),
                        }
                      : b
                  )
                }
                className={`${inputClass} flex-1 font-mono`}
              />
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
                        { id: makeId("soc"), label: "Instagram", url: "https://instagram.com" },
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
      );

    case "footer":
      return (
        <div className="space-y-2">
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
              {block.fields.map((f: FooterContactField) => (
                <div key={f.id} className="flex items-center gap-1.5">
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
                      f.visible ? "border-zinc-700 text-emerald-400" : "border-zinc-800 text-zinc-600"
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
              ))}
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
          </div>
          <EmailIconPicker
            tone={block.iconTone}
            appUrl={appUrl}
            showIconGrid={false}
            onChangeTone={(iconTone) =>
              onChange((b) => (b.type === "brand_header" ? { ...b, iconTone } : b))
            }
          />
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
            resolvedPortalUrl={resolvedPortalUrl}
            onPatch={(patch) =>
              onChange((b) => (b.type === "promo_banner" ? { ...b, ...patch } : b))
            }
          />
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
            <div>
              <label className={labelClass}>Optional Link URL</label>
              <input
                type="text"
                value={block.linkUrl || ""}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "membership_strip" ? { ...b, linkUrl: e.target.value } : b
                  )
                }
                placeholder="{{portal_link}}"
                className={`${inputClass} font-mono`}
              />
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-zinc-300 mt-4">
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
          <ModernButtonEditor
            label={block.buttonLabel}
            url={block.buttonUrl}
            buttonStyle={block.buttonStyle}
            buttonCorner={block.buttonCorner}
            buttonBgColor={block.buttonBgColor}
            buttonTextColor={block.buttonTextColor}
            resolvedPortalUrl={resolvedPortalUrl}
            onPatch={(patch) =>
              onChange((b) => (b.type === "hero_text" ? { ...b, ...patch } : b))
            }
          />
          <BlockStyleControls
            style={block.style}
            showAlign
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
            resolvedPortalUrl={resolvedPortalUrl}
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
          <ModernButtonEditor
            label={block.buttonLabel}
            url={block.buttonUrl}
            buttonStyle={block.buttonStyle}
            buttonCorner={block.buttonCorner}
            buttonBgColor={block.buttonBgColor}
            buttonTextColor={block.buttonTextColor}
            resolvedPortalUrl={resolvedPortalUrl}
            onPatch={(patch) =>
              onChange((b) => (b.type === "feature_card" ? { ...b, ...patch } : b))
            }
          />
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

          <ModernButtonEditor
            label={block.buttonLabel}
            url={block.buttonUrl}
            buttonStyle={block.buttonStyle}
            buttonCorner={block.buttonCorner}
            buttonBgColor={block.buttonBgColor}
            buttonTextColor={block.buttonTextColor}
            resolvedPortalUrl={resolvedPortalUrl}
            onPatch={(patch) =>
              onChange((b) => (b.type === "benefits_list" ? { ...b, ...patch } : b))
            }
          />
          <BlockStyleControls
            style={block.style}
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
            {block.items.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-1 sm:grid-cols-12 gap-1.5 items-center bg-zinc-950/60 border border-zinc-800/80 rounded-lg p-2"
              >
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
                  className={`${inputClass} sm:col-span-3`}
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
                  className={`${inputClass} sm:col-span-4`}
                />
                <input
                  type="text"
                  value={item.url}
                  onChange={(e) =>
                    onChange((b) =>
                      b.type === "icon_link_grid"
                        ? {
                            ...b,
                            items: b.items.map((x) =>
                              x.id === item.id ? { ...x, url: e.target.value } : x
                            ),
                          }
                        : b
                    )
                  }
                  placeholder="https://..."
                  className={`${inputClass} font-mono sm:col-span-4`}
                />
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
                  className="p-1 text-zinc-500 hover:text-red-400 disabled:opacity-30 sm:col-span-1 justify-self-end"
                >
                  <Trash2 size={12} />
                </button>
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
          <ModernButtonEditor
            label={block.buttonLabel}
            url={block.buttonUrl}
            buttonStyle={block.buttonStyle}
            buttonCorner={block.buttonCorner}
            buttonBgColor={block.buttonBgColor}
            buttonTextColor={block.buttonTextColor}
            resolvedPortalUrl={resolvedPortalUrl}
            onPatch={(patch) =>
              onChange((b) => (b.type === "image_with_list" ? { ...b, ...patch } : b))
            }
          />
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
          <div className="space-y-1.5">
            <label className={labelClass}>Footer Navigation Links</label>
            {block.links.map((l) => (
              <div key={l.id} className="flex items-center gap-1.5">
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
                  placeholder="Label"
                  className={`${inputClass} w-1/3`}
                />
                <input
                  type="text"
                  value={l.url}
                  onChange={(e) =>
                    onChange((b) =>
                      b.type === "footer_nav"
                        ? {
                            ...b,
                            links: b.links.map((x) =>
                              x.id === l.id ? { ...x, url: e.target.value } : x
                            ),
                          }
                        : b
                    )
                  }
                  placeholder="https://... or {{hotel_website}}"
                  className={`${inputClass} flex-1 font-mono`}
                />
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
                          { id: makeId("fn"), label: "Contact", url: "{{hotel_website}}" },
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Secondary Line (Optional)</label>
              <input
                type="text"
                value={block.secondaryText || ""}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "footer_nav" ? { ...b, secondaryText: e.target.value } : b
                  )
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Secondary Link URL</label>
              <input
                type="text"
                value={block.secondaryLinkUrl || ""}
                onChange={(e) =>
                  onChange((b) =>
                    b.type === "footer_nav" ? { ...b, secondaryLinkUrl: e.target.value } : b
                  )
                }
                className={`${inputClass} font-mono`}
              />
            </div>
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
          )}
          <BlockStyleControls
            style={block.style}
            onChange={(style) =>
              onChange((b) => (b.type === "legal_section" ? { ...b, style } : b))
            }
          />
        </div>
      );
  }
}
