import React, { useState } from "react";
import { Check, LayoutTemplate, Plus, Sparkles, X } from "lucide-react";
import {
  EMAIL_ICON_LABELS,
  EMAIL_ICON_NAMES,
  EMAIL_ICON_TONE_HEX,
  EMAIL_ICON_TONES,
  type EmailBlockType,
  type EmailIconName,
  type EmailIconTone,
  type SupportedEmailLanguage,
} from "../shared/types";
import {
  STARTER_LAYOUT_PRESETS,
  buildEmailIconUrl,
  type StarterLayoutPresetId,
} from "../shared/presets";

export interface BlockCatalogMeta {
  type: EmailBlockType;
  label: string;
  description: string;
  category: "Header" | "Content" | "Stay Details" | "Cards" | "Links" | "Footer";
  isModern?: boolean;
}

export const BLOCK_CATALOG: readonly BlockCatalogMeta[] = [
  // Header
  {
    type: "brand_header",
    label: "Brand Header",
    description: "Logo left, hotel name, address & phone with icons right",
    category: "Header",
    isModern: true,
  },
  {
    type: "promo_banner",
    label: "Dark Promo Strip",
    description: "Full-width dark banner with thumbnail, short copy & pill CTA",
    category: "Header",
    isModern: true,
  },
  {
    type: "membership_strip",
    label: "Membership Strip",
    description: "Centered loyalty tier & points bar (auto-hides if absent)",
    category: "Header",
    isModern: true,
  },
  // Content
  {
    type: "hero_text",
    label: "Hero Headline",
    description: "Large centered or aligned title, intro paragraph & optional button",
    category: "Content",
    isModern: true,
  },
  {
    type: "icon_divider",
    label: "Icon Divider",
    description: "Thin horizontal rule with a centered built-in icon",
    category: "Content",
    isModern: true,
  },
  {
    type: "heading",
    label: "Classic Heading",
    description: "H1, H2, or H3 text heading",
    category: "Content",
  },
  {
    type: "paragraph",
    label: "Paragraph",
    description: "Rich body copy with merge variables",
    category: "Content",
  },
  {
    type: "image",
    label: "Image / GIF",
    description: "Full-width or centered photo, banner, or animated GIF",
    category: "Content",
  },
  {
    type: "button",
    label: "Button / Link",
    description: "Standalone call-to-action button or text link",
    category: "Content",
  },
  {
    type: "divider",
    label: "Simple Divider",
    description: "Clean hairline separator",
    category: "Content",
  },
  {
    type: "spacer",
    label: "Spacer",
    description: "Vertical whitespace block",
    category: "Content",
  },
  // Stay Details
  {
    type: "confirmation_number",
    label: "Confirmation Number",
    description: "Uppercase label with prominent centered booking code",
    category: "Stay Details",
    isModern: true,
  },
  {
    type: "stay_dates",
    label: "Stay Dates",
    description: "Two-column Check-In & Check-Out dates, times & connector line",
    category: "Stay Details",
    isModern: true,
  },
  {
    type: "booking_details_table",
    label: "Booking Details Table",
    description: "Structured key-value reservation summary rows",
    category: "Stay Details",
  },
  {
    type: "two_column_text",
    label: "Two-Column Text",
    description: "Side-by-side info columns",
    category: "Stay Details",
  },
  // Cards
  {
    type: "feature_card",
    label: "Feature Card",
    description: "Rounded bordered card with image left/right, title, copy & button",
    category: "Cards",
    isModern: true,
  },
  {
    type: "benefits_list",
    label: "Benefits List",
    description: "Badge, heading, bullet/icon rows, footnote & optional button",
    category: "Cards",
    isModern: true,
  },
  {
    type: "image_with_list",
    label: "Image + Feature List",
    description: "Side image paired with icon checklist & prominent CTA button",
    category: "Cards",
    isModern: true,
  },
  // Links
  {
    type: "icon_link_grid",
    label: "Icon Link Grid",
    description: "2 to 4 visual icon links with labels and arrows",
    category: "Links",
    isModern: true,
  },
  // Footer
  {
    type: "footer_contact",
    label: "Contact Us",
    description: "Editable contact heading & message with hotel phone/email variables",
    category: "Footer",
    isModern: true,
  },
  {
    type: "footer_authenticity",
    label: "Confirmation Authenticity",
    description: "Editable reservation authenticity notice with booking reference",
    category: "Footer",
    isModern: true,
  },
  {
    type: "footer_copyright",
    label: "Copyright / Legal Line",
    description: "Editable copyright line with optional bottom hotel logo",
    category: "Footer",
    isModern: true,
  },
  {
    type: "footer_legal",
    label: "Legal / Impressum",
    description: "Impressum, privacy note, cancellation policy, or custom legal notice",
    category: "Footer",
    isModern: true,
  },
  {
    type: "social_links",
    label: "Social Links",
    description: "Row of hotel website or social media links",
    category: "Footer",
  },
  {
    type: "footer_nav",
    label: "Footer Navigation",
    description: "Centered horizontal row of quick footer links",
    category: "Footer",
    isModern: true,
  },
  {
    type: "footer_powered_by",
    label: "Powered By Credit",
    description: "Optional credit line (off by default, fully editable or removable)",
    category: "Footer",
    isModern: true,
  },
  {
    type: "footer",
    label: "Classic Contact Footer",
    description: "Structured hotel contact block, footer note & legal imprint",
    category: "Footer",
  },
  {
    type: "legal_section",
    label: "Combined Legal Block",
    description: "Legacy multi-section legal & copyright container",
    category: "Footer",
    isModern: true,
  },
] as const;

export const BLOCK_TYPE_LABELS: Record<EmailBlockType, string> = BLOCK_CATALOG.reduce(
  (acc, item) => {
    acc[item.type] = item.label;
    return acc;
  },
  {} as Record<EmailBlockType, string>
);

const PALETTE_CATEGORIES: Array<BlockCatalogMeta["category"]> = [
  "Header",
  "Stay Details",
  "Cards",
  "Content",
  "Links",
  "Footer",
];

function BlockWireframeThumb({ type }: { type: EmailBlockType }) {
  switch (type) {
    case "brand_header":
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-zinc-800 px-2.5 flex items-center justify-between">
          <div className="w-10 h-4 rounded-sm bg-zinc-700" />
          <div className="space-y-1 text-right">
            <div className="w-16 h-1.5 rounded bg-zinc-500 ml-auto" />
            <div className="w-12 h-1 rounded bg-zinc-700 ml-auto" />
          </div>
        </div>
      );
    case "promo_banner":
      return (
        <div className="w-full h-11 rounded bg-zinc-800 border border-zinc-700 px-2.5 flex items-center justify-between gap-2">
          <div className="w-6 h-6 rounded bg-zinc-600 shrink-0" />
          <div className="flex-1 space-y-1">
            <div className="w-full h-1.5 rounded bg-zinc-300" />
            <div className="w-2/3 h-1 rounded bg-zinc-500" />
          </div>
          <div className="w-9 h-4 rounded-full border border-zinc-300 shrink-0" />
        </div>
      );
    case "membership_strip":
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-zinc-800 px-2 flex items-center justify-center gap-2">
          <div className="w-12 h-2 rounded bg-amber-400/70" />
          <div className="w-px h-3 bg-zinc-700" />
          <div className="w-14 h-2 rounded bg-zinc-400" />
        </div>
      );
    case "icon_divider":
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-zinc-800 px-3 flex items-center gap-2">
          <div className="flex-1 h-px bg-zinc-700" />
          <div className="w-3.5 h-3.5 rounded-full border border-zinc-500" />
          <div className="flex-1 h-px bg-zinc-700" />
        </div>
      );
    case "hero_text":
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-zinc-800 px-3 flex flex-col items-center justify-center gap-1">
          <div className="w-24 h-2 rounded bg-zinc-200" />
          <div className="w-32 h-1 rounded bg-zinc-600" />
          <div className="w-10 h-2.5 rounded-sm bg-emerald-500/70 mt-0.5" />
        </div>
      );
    case "confirmation_number":
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-zinc-800 px-3 flex flex-col items-center justify-center gap-1">
          <div className="w-16 h-1 rounded bg-zinc-600" />
          <div className="w-20 h-3 rounded bg-zinc-200" />
        </div>
      );
    case "stay_dates":
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-zinc-800 px-2.5 flex items-center justify-between gap-2">
          <div className="space-y-1 flex-1 flex flex-col items-center">
            <div className="w-8 h-1 rounded bg-zinc-600" />
            <div className="w-12 h-2 rounded bg-zinc-300" />
          </div>
          <div className="w-6 h-px bg-zinc-600" />
          <div className="space-y-1 flex-1 flex flex-col items-center">
            <div className="w-8 h-1 rounded bg-zinc-600" />
            <div className="w-12 h-2 rounded bg-zinc-300" />
          </div>
        </div>
      );
    case "feature_card":
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-zinc-700 overflow-hidden flex">
          <div className="w-5/12 bg-emerald-900/50 border-r border-zinc-800" />
          <div className="flex-1 p-1.5 flex flex-col justify-center gap-1">
            <div className="w-14 h-1.5 rounded bg-zinc-300" />
            <div className="w-full h-1 rounded bg-zinc-600" />
            <div className="w-8 h-2 rounded-sm bg-emerald-500/70" />
          </div>
        </div>
      );
    case "benefits_list":
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 flex flex-col justify-center gap-1">
          <div className="w-20 h-1.5 rounded bg-zinc-300" />
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <div className="w-24 h-1 rounded bg-zinc-600" />
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <div className="w-20 h-1 rounded bg-zinc-600" />
          </div>
        </div>
      );
    case "icon_link_grid":
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-zinc-800 px-2 flex items-center justify-around">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="w-3.5 h-3.5 rounded bg-zinc-600" />
              <div className="w-8 h-1 rounded bg-zinc-500" />
            </div>
          ))}
        </div>
      );
    case "image_with_list":
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 flex items-center gap-2">
          <div className="w-10 h-8 rounded bg-zinc-700 shrink-0" />
          <div className="flex-1 space-y-1">
            <div className="w-14 h-1.5 rounded bg-zinc-300" />
            <div className="w-16 h-1 rounded bg-zinc-600" />
            <div className="w-9 h-2 rounded-sm bg-zinc-200" />
          </div>
        </div>
      );
    case "footer_nav":
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-zinc-800 px-2 flex items-center justify-center gap-2">
          <div className="w-8 h-1.5 rounded bg-zinc-500" />
          <div className="w-8 h-1.5 rounded bg-zinc-500" />
          <div className="w-8 h-1.5 rounded bg-zinc-500" />
        </div>
      );
    case "legal_section":
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 flex flex-col justify-between">
          <div className="space-y-1">
            <div className="w-12 h-1 rounded bg-zinc-500" />
            <div className="w-full h-1 rounded bg-zinc-700" />
          </div>
          <div className="w-6 h-2 rounded bg-zinc-600 mx-auto" />
        </div>
      );
    case "footer_contact":
    case "footer_authenticity":
    case "footer_legal":
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-zinc-800 px-2.5 py-2 flex flex-col justify-center gap-1.5">
          <div className="w-16 h-1.5 rounded bg-zinc-300" />
          <div className="w-full h-1 rounded bg-zinc-600" />
          <div className="w-4/5 h-1 rounded bg-zinc-700" />
        </div>
      );
    case "footer_copyright":
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-zinc-800 px-2.5 flex flex-col items-center justify-center gap-1.5">
          <div className="w-28 h-1.5 rounded bg-zinc-500" />
          <div className="w-8 h-2 rounded bg-zinc-700" />
        </div>
      );
    case "footer_powered_by":
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-dashed border-zinc-800 px-2.5 flex items-center justify-center">
          <div className="w-24 h-1.5 rounded bg-zinc-600" />
        </div>
      );
    default:
      return (
        <div className="w-full h-11 rounded bg-zinc-950 border border-zinc-800 px-2.5 flex flex-col justify-center gap-1.5">
          <div className="w-16 h-1.5 rounded bg-zinc-400" />
          <div className="w-full h-1 rounded bg-zinc-700" />
        </div>
      );
  }
}

export function BlockPaletteModal({
  onSelect,
  onClose,
}: {
  onSelect: (type: EmailBlockType) => void;
  onClose: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState<BlockCatalogMeta["category"] | "All">("All");

  const filtered =
    activeCategory === "All"
      ? BLOCK_CATALOG
      : BLOCK_CATALOG.filter((b) => b.category === activeCategory);

  return (
    <div className="fixed inset-0 z-[95] bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Add Email Block</h3>
            <p className="text-xs text-zinc-400">
              All blocks use email-safe tables, inline CSS, and mobile stacking.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            aria-label="Close block palette"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-2.5 border-b border-zinc-800/80 flex items-center gap-1.5 overflow-x-auto">
          {(["All", ...PALETTE_CATEGORIES] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                activeCategory === cat
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="p-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => {
                onSelect(item.type);
                onClose();
              }}
              className="group text-left rounded-xl bg-zinc-900/70 hover:bg-zinc-900 border border-zinc-800 hover:border-emerald-500/60 p-3 space-y-2.5 transition-colors"
            >
              <BlockWireframeThumb type={item.type} />
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-100 group-hover:text-emerald-300 transition-colors">
                    {item.label}
                  </span>
                  <Plus size={12} className="text-zinc-500 group-hover:text-emerald-400 shrink-0" />
                </div>
                <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">{item.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StarterLayoutPickerModal({
  language,
  onApplyPreset,
  onClose,
}: {
  language: SupportedEmailLanguage;
  onApplyPreset: (presetId: StarterLayoutPresetId, applyBothLanguages: boolean) => void;
  onClose: () => void;
}) {
  const [applyBothLanguages, setApplyBothLanguages] = useState(true);

  return (
    <div className="fixed inset-0 z-[95] bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-xl bg-zinc-950 border border-zinc-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <LayoutTemplate size={17} className="text-emerald-400" />
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Start from a Modern Layout</h3>
              <p className="text-xs text-zinc-400">
                Copies a starter layout into your draft only. Nothing is published or sent until you click Publish.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            aria-label="Close starter layouts"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
          {STARTER_LAYOUT_PRESETS.map((preset) => (
            <div
              key={preset.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden flex flex-col justify-between hover:border-zinc-700 transition-colors"
            >
              {/* Miniature Layout Preview */}
              <div className="p-4 bg-zinc-950 border-b border-zinc-800">
                <div className="mx-auto w-48 rounded-md bg-white border border-zinc-300 overflow-hidden shadow-sm">
                  {/* Brand header */}
                  <div className="px-2.5 py-2 flex items-center justify-between border-b border-zinc-200">
                    <div className="w-10 h-2.5 rounded-sm bg-zinc-800" />
                    <div className="space-y-0.5">
                      <div className="w-12 h-1 bg-zinc-400 ml-auto" />
                      <div className="w-9 h-1 bg-zinc-300 ml-auto" />
                    </div>
                  </div>
                  {/* Optional promo strip */}
                  {(preset.id === "modern_resort" || preset.id === "business_hotel") && (
                    <div
                      className="px-2.5 py-1.5 flex items-center justify-between"
                      style={{ backgroundColor: preset.secondaryColor }}
                    >
                      <div className="w-20 h-1 bg-white/80 rounded" />
                      <div className="w-7 h-2 rounded-full border border-white/70" />
                    </div>
                  )}
                  {/* Hero + Confirmation + Dates */}
                  <div className="px-3 py-2.5 space-y-1.5 text-center">
                    <div className="w-24 h-2 bg-zinc-800 rounded mx-auto" />
                    <div className="w-32 h-1 bg-zinc-400 rounded mx-auto" />
                    <div className="w-14 h-2.5 bg-zinc-700 rounded mx-auto mt-1" />
                    <div className="flex items-center justify-center gap-2 pt-1">
                      <div className="w-12 h-2 bg-zinc-300 rounded" />
                      <div className="w-4 h-px bg-zinc-300" />
                      <div className="w-12 h-2 bg-zinc-300 rounded" />
                    </div>
                    <div
                      className="w-16 h-3 rounded-sm mx-auto mt-1"
                      style={{ backgroundColor: preset.accentColor }}
                    />
                  </div>
                  {/* Feature card / Table preview */}
                  {(preset.id === "modern_resort" || preset.id === "boutique") && (
                    <div className="px-2.5 pb-2.5">
                      <div className="rounded border border-zinc-200 flex overflow-hidden h-9">
                        <div
                          className="w-5/12 opacity-80"
                          style={{ backgroundColor: preset.accentColor }}
                        />
                        <div className="flex-1 p-1.5 space-y-1">
                          <div className="w-12 h-1.5 bg-zinc-700 rounded" />
                          <div className="w-full h-1 bg-zinc-300 rounded" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-zinc-100">
                      {language === "de" ? preset.nameDe : preset.name}
                    </h4>
                    <span
                      className="w-3 h-3 rounded-full border border-white/20 shrink-0"
                      style={{ backgroundColor: preset.accentColor }}
                    />
                  </div>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    {language === "de" ? preset.taglineDe : preset.tagline}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onApplyPreset(preset.id, applyBothLanguages);
                    onClose();
                  }}
                  className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  <Sparkles size={13} /> Use Layout in Draft
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-900/40 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={applyBothLanguages}
              onChange={(e) => setApplyBothLanguages(e.target.checked)}
            />
            Apply matching layout to both English &amp; German drafts
          </label>
          <span className="text-[11px] text-zinc-500">
            You can always restore the original default via Reset.
          </span>
        </div>
      </div>
    </div>
  );
}

export function EmailIconPicker({
  icon,
  tone,
  appUrl,
  showIconGrid = true,
  onChangeIcon,
  onChangeTone,
}: {
  icon?: EmailIconName;
  tone?: EmailIconTone;
  appUrl: string;
  showIconGrid?: boolean;
  onChangeIcon?: (icon: EmailIconName) => void;
  onChangeTone: (tone: EmailIconTone) => void;
}) {
  const activeTone: EmailIconTone = tone || "dark";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-zinc-400 mr-1">Icon Color:</span>
        {EMAIL_ICON_TONES.map((t) => {
          const hex = EMAIL_ICON_TONE_HEX[t].hex;
          const active = activeTone === t;
          return (
            <button
              key={t}
              type="button"
              title={EMAIL_ICON_TONE_HEX[t].label}
              onClick={() => onChangeTone(t)}
              className={`w-5 h-5 rounded-full border flex items-center justify-center transition-transform ${
                active ? "border-emerald-400 scale-110" : "border-zinc-700 hover:scale-105"
              }`}
              style={{ backgroundColor: hex }}
            >
              {active && (
                <Check
                  size={11}
                  className={t === "light" ? "text-zinc-900" : "text-white"}
                />
              )}
            </button>
          );
        })}
      </div>

      {showIconGrid && onChangeIcon && (
        <div className="grid grid-cols-5 sm:grid-cols-8 gap-1.5">
          {EMAIL_ICON_NAMES.map((ic) => {
            const active = icon === ic;
            const iconSrc = buildEmailIconUrl(
              appUrl,
              activeTone === "light" ? "light" : activeTone,
              ic
            );
            return (
              <button
                key={ic}
                type="button"
                title={EMAIL_ICON_LABELS[ic]}
                onClick={() => onChangeIcon(ic)}
                className={`p-1.5 rounded-lg border flex flex-col items-center justify-center gap-1 transition-colors ${
                  active
                    ? "border-emerald-500 bg-emerald-500/15"
                    : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                }`}
              >
                <span
                  className={`w-6 h-6 rounded flex items-center justify-center ${
                    activeTone === "light" ? "bg-zinc-800" : "bg-white"
                  }`}
                >
                  <img
                    src={iconSrc}
                    alt=""
                    width={16}
                    height={16}
                    className="w-4 h-4 object-contain"
                  />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
