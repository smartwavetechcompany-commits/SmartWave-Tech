import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Image as ImageIcon,
  Pencil,
  Trash2,
  Upload,
  X,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { EmailImageAsset } from "../shared/types";
import { IMAGE_LIMITS } from "../shared/types";
import { emailCustomizationApi, EmailCustomizationApiError } from "./apiClient";

interface ImageLibraryProps {
  hotelId?: string;
  mode: "page" | "picker";
  selectedUrl?: string;
  onSelect?: (image: EmailImageAsset) => void;
  onClose?: () => void;
}

const ACCEPTED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ImageLibraryPanel({
  hotelId,
  mode,
  selectedUrl,
  onSelect,
  onClose,
}: ImageLibraryProps) {
  const [images, setImages] = useState<EmailImageAsset[]>([]);
  const [usage, setUsage] = useState({
    count: 0,
    maxCount: IMAGE_LIMITS.maxImagesPerHotel as number,
    totalBytes: 0,
    maxTotalBytes: IMAGE_LIMITS.maxTotalBytesPerHotel as number,
  });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteImg, setConfirmDeleteImg] = useState<EmailImageAsset | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadImages = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const data = await emailCustomizationApi.listImages(hotelId);
      setImages(data.images || []);
      setUsage(data.usage);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load image library.");
    } finally {
      setLoading(false);
    }
  }, [hotelId]);

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  const handleFile = async (file: File) => {
    setErrorMsg(null);
    const hasAllowedExt = /\.(png|jpe?g|webp|gif)$/i.test(file.name || "");
    if (file.type ? !ACCEPTED_MIME.has(file.type) : !hasAllowedExt) {
      setErrorMsg(
        "Only PNG, JPEG, WebP, and GIF images are supported. SVG, PDF, AVIF, and video files are not permitted."
      );
      return;
    }
    const isGif = file.type === "image/gif" || /\.gif$/i.test(file.name || "");
    if (isGif && file.size > IMAGE_LIMITS.maxFileSizeBytes) {
      setErrorMsg(
        "GIF exceeds the 2 MB limit. Tip: resize to 600px wide, use fewer colors, or shorten the animation before uploading."
      );
      return;
    }
    if (!isGif && file.size > IMAGE_LIMITS.maxFileSizeBytes * 2) {
      setErrorMsg("File is too large. Please upload an image under 2 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setUploading(true);
        const base64Data = String(reader.result || "");
        const defaultLabel = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Hotel Image";
        const res = await emailCustomizationApi.uploadImage(base64Data, defaultLabel, hotelId);
        if (res.image) {
          toast.success("Image uploaded and added to library.");
          if (mode === "picker" && onSelect) {
            onSelect(res.image);
            return;
          }
          await loadImages();
        }
      } catch (err: any) {
        setErrorMsg(err?.message || "Upload failed.");
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      setErrorMsg("Could not read the selected file.");
    };
    reader.readAsDataURL(file);
  };

  const handleRenameSave = async (imageId: string) => {
    if (!editingLabel.trim()) return;
    try {
      const res = await emailCustomizationApi.renameImage(imageId, editingLabel.trim(), hotelId);
      if (res.image) {
        setImages((prev) => prev.map((img) => (img.id === imageId ? res.image! : img)));
        toast.success("Image label updated.");
      }
      setEditingId(null);
    } catch (err: any) {
      toast.error(err?.message || "Failed to rename image.");
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteImg) return;
    const target = confirmDeleteImg;
    setDeletingId(target.id);
    setErrorMsg(null);
    try {
      const res = await emailCustomizationApi.deleteImage(target.id, hotelId);
      setImages((prev) => prev.filter((img) => img.id !== target.id));
      setUsage((prev) => ({
        ...prev,
        count: Math.max(0, prev.count - 1),
        totalBytes: Math.max(0, prev.totalBytes - (target.sizeBytes || 0)),
      }));
      if (res.referencedByDraft && res.referencedByDraft.length > 0) {
        toast.warning(
          `Image deleted. Note: it was referenced in draft template(s): ${res.referencedByDraft.join(", ")}.`
        );
      } else {
        toast.success("Image removed from library.");
      }
      setConfirmDeleteImg(null);
    } catch (err: any) {
      if (err instanceof EmailCustomizationApiError && err.status === 409) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg(err?.message || "Failed to delete image.");
      }
      setConfirmDeleteImg(null);
    } finally {
      setDeletingId(null);
    }
  };

  const content = (
    <div className="space-y-5">
      {/* Header + Quota */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">Hotel Email Image Library</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            PNG, JPEG, WebP, or GIF (max 2 MB) · Photos resized to 2000px &amp; EXIF-stripped; GIFs resized to 640px wide (max 100 frames, 15s).
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-zinc-300 tabular-nums font-medium">
              {usage.count} / {usage.maxCount} images · {formatBytes(usage.totalBytes)} /{" "}
              {formatBytes(usage.maxTotalBytes)}
            </div>
            <div className="w-40 h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-1">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(
                      (usage.count / Math.max(1, usage.maxCount)) * 100,
                      (usage.totalBytes / Math.max(1, usage.maxTotalBytes)) * 100
                    )
                  )}%`,
                }}
              />
            </div>
          </div>
          {mode === "picker" && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
              aria-label="Close image picker"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <span className="flex-1">{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-red-300/80 hover:text-red-200"
            aria-label="Dismiss error"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Upload Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        className={`border border-dashed rounded-xl p-6 text-center transition-colors ${
          isDragging
            ? "border-emerald-500 bg-emerald-500/10"
            : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-600"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        <div className="flex flex-col items-center gap-2">
          {uploading ? (
            <Loader2 size={22} className="text-emerald-400 animate-spin" />
          ) : (
            <Upload size={22} className="text-zinc-400" />
          )}
          <div className="text-sm text-zinc-200 font-medium">
            {uploading ? "Validating & optimizing image..." : "Drag an image or GIF here, or browse to upload"}
          </div>
          <div className="text-xs text-zinc-500">
            Logos, banners, photos, or animated GIFs (PNG, JPG, WebP, GIF up to 2 MB)
          </div>
          <div className="text-[11px] text-zinc-500">
            Outlook desktop displays only the first frame of GIFs — keep your key message on frame 1.
          </div>
          <button
            type="button"
            disabled={uploading || usage.count >= usage.maxCount}
            onClick={() => fileInputRef.current?.click()}
            className="mt-2 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap transition-colors"
          >
            Choose Image or GIF
          </button>
        </div>
      </div>

      {/* Image Grid */}
      {loading ? (
        <div className="py-12 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading hotel images...
        </div>
      ) : images.length === 0 ? (
        <div className="py-12 text-center border border-zinc-800 rounded-xl bg-zinc-900/40">
          <ImageIcon size={24} className="mx-auto text-zinc-600 mb-2" />
          <p className="text-sm text-zinc-300 font-medium">No email images uploaded yet</p>
          <p className="text-xs text-zinc-500 mt-1">
            Upload your hotel logo or property banner above to insert it into your email templates.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {images.map((img) => {
            const isSelected = Boolean(selectedUrl && selectedUrl === img.url);
            const isEditing = editingId === img.id;
            return (
              <div
                key={img.id}
                className={`rounded-xl border bg-zinc-900 overflow-hidden flex flex-col transition-colors ${
                  isSelected ? "border-emerald-500" : "border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <div className="h-32 bg-zinc-950 flex items-center justify-center p-2 border-b border-zinc-800 relative">
                  <img
                    src={img.url}
                    alt={img.label}
                    className="max-h-full max-w-full object-contain"
                    loading="lazy"
                  />
                  {img.mimeType === "image/gif" && (
                    <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-zinc-900/90 border border-zinc-700 text-[10px] font-semibold tracking-wide text-amber-300 tabular-nums">
                      GIF{img.frameCount && img.frameCount > 1 ? ` · ${img.frameCount}f` : ""}
                    </span>
                  )}
                </div>
                <div className="p-3 flex-1 flex flex-col justify-between gap-2">
                  <div>
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={editingLabel}
                          onChange={(e) => setEditingLabel(e.target.value)}
                          maxLength={80}
                          className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleRenameSave(img.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => void handleRenameSave(img.id)}
                          className="p-1 rounded bg-emerald-600 text-white hover:bg-emerald-500"
                          aria-label="Save image name"
                        >
                          <Check size={13} />
                        </button>
                      </div>
                    ) : (
                      <div className="text-xs font-medium text-zinc-100 truncate" title={img.label}>
                        {img.label}
                      </div>
                    )}
                    <div className="text-[11px] text-zinc-500 mt-0.5 tabular-nums">
                      {img.width} × {img.height}px · {formatBytes(img.sizeBytes)}
                      {img.mimeType === "image/gif" && img.isAnimated
                        ? ` · Animated`
                        : ""}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800/80">
                    {mode === "picker" && onSelect ? (
                      <button
                        type="button"
                        onClick={() => onSelect(img)}
                        className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                          isSelected
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                            : "bg-emerald-600 hover:bg-emerald-500 text-white"
                        }`}
                      >
                        {isSelected ? "Selected" : "Use Image"}
                      </button>
                    ) : (
                      <span className="text-[11px] text-zinc-500 uppercase">
                        {img.mimeType.replace("image/", "")}
                      </span>
                    )}

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(img.id);
                          setEditingLabel(img.label);
                        }}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                        title="Rename image"
                        aria-label="Rename image"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        disabled={deletingId === img.id}
                        onClick={() => setConfirmDeleteImg(img)}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete image"
                        aria-label="Delete image"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Inline Delete Confirmation Dialog */}
      {confirmDeleteImg && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-zinc-900 border border-zinc-800 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Delete image from library?</h3>
              <p className="text-xs text-zinc-400 mt-1">
                Deleting <span className="text-zinc-200 font-medium">{confirmDeleteImg.label}</span>{" "}
                permanently removes it from storage. Images used in any published template cannot be deleted until replaced.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteImg(null)}
                className="px-3 py-1.5 rounded-lg border border-zinc-700 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingId === confirmDeleteImg.id}
                onClick={() => void handleConfirmDelete()}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white whitespace-nowrap"
              >
                {deletingId === confirmDeleteImg.id ? "Deleting..." : "Delete Image"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (mode === "picker") {
    return (
      <div className="fixed inset-0 z-[90] bg-black/75 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-xl bg-zinc-950 border border-zinc-800 p-5">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-5">
      {content}
    </div>
  );
}
