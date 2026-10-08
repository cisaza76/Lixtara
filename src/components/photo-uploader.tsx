"use client";

// Direct-to-Supabase photo upload (bypasses Vercel's 4.5MB body limit).
// Browser uploads each file to Storage with the user's RLS-scoped session,
// then POSTs only the URLs (small JSON) to the server action that inserts
// property_photos rows.

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

interface PhotoUploaderProps {
  propertyId: string;
  /** Server action that takes a list of URLs and persists property_photos rows. */
  persistAction: (formData: FormData) => Promise<void>;
  labels: {
    uploadButton: string;
    uploading: string;
    invalidFormat: string;
    genericError: string;
    /** template: "{failed} of {total} photos couldn't upload ({reason})" */
    partialFail: string;
    /** The native file input is hidden: its button and "no file chosen" text
     *  follow the BROWSER language, not the page's. These replace them. */
    chooseFiles: string;
    noFilesChosen: string;
    /** template: "{n} photos selected" */
    filesChosen: string;
    fileChosenOne: string;
    noFilesPicked: string;
    notAuthenticated: string;
    /** Every photo failed because of its size. */
    tooLarge: string;
    /** Short {reason} for partialFail. Storage errors come back in English. */
    reasonTooLarge: string;
    reasonGeneric: string;
  };
}

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

// Supabase Storage answers in English ("The object exceeded the maximum
// allowed size"); only its meaning reaches the seller, in their language.
function isTooLarge(message: string): boolean {
  return /exceed|too large|maximum allowed size|payload/i.test(message);
}

export function PhotoUploader({ propertyId, persistAction, labels }: PhotoUploaderProps) {
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [chosenCount, setChosenCount] = useState(0);
  const [, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setWarning(null);

    const formEl = e.currentTarget;
    const fileInput = formEl.elements.namedItem("photos") as HTMLInputElement;
    const files = Array.from(fileInput.files ?? []).filter((f) => f.size > 0);
    if (files.length === 0) {
      setError(labels.noFilesPicked);
      return;
    }

    const invalid = files.find((f) => !ACCEPTED.includes(f.type));
    if (invalid) {
      setError(labels.invalidFormat);
      return;
    }

    setIsUploading(true);
    setProgress({ done: 0, total: files.length });

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError(labels.notAuthenticated);
      setIsUploading(false);
      return;
    }

    const uploadedUrls: string[] = [];
    const failures: { name: string; reason: string }[] = [];
    for (const file of files) {
      const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
      const path = `${user.id}/${propertyId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("property-photos")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        // Don't drop failures silently — collect them so the seller learns
        // which photos didn't make it and why (e.g. file too large).
        console.error("photo upload failed", file.name, upErr);
        failures.push({
          name: file.name,
          reason: isTooLarge(upErr.message) ? "too_large" : "other",
        });
        continue;
      }
      const { data: pub } = supabase.storage
        .from("property-photos")
        .getPublicUrl(path);
      uploadedUrls.push(pub.publicUrl);
      setProgress((p) => p && { ...p, done: p.done + 1 });
    }

    if (uploadedUrls.length === 0) {
      setError(
        failures.every((f) => f.reason === "too_large")
          ? labels.tooLarge
          : labels.genericError,
      );
      setIsUploading(false);
      return;
    }
    if (failures.length > 0) {
      setWarning(
        labels.partialFail
          .replace("{failed}", String(failures.length))
          .replace("{total}", String(files.length))
          .replace(
            "{reason}",
            failures[0]!.reason === "too_large"
              ? labels.reasonTooLarge
              : labels.reasonGeneric,
          ),
      );
    }

    const fd = new FormData();
    fd.append("id", propertyId);
    for (const u of uploadedUrls) fd.append("urls", u);
    startTransition(async () => {
      try {
        await persistAction(fd);
      } catch {
        // server action throws on redirect — that's the success path. Ignore.
      }
      setIsUploading(false);
      setProgress(null);
      formEl.reset();
      setChosenCount(0);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 border border-gold-soft p-5"
    >
      <label
        className={`flex flex-wrap items-center gap-4 text-sm text-ink ${
          isUploading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
        }`}
      >
        <input
          type="file"
          name="photos"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={isUploading}
          onChange={(e) => {
            setError(null);
            setChosenCount(e.currentTarget.files?.length ?? 0);
          }}
          className="peer sr-only"
        />
        <span className="py-2 px-4 border border-gold-soft bg-ivory text-ink text-[10px] font-semibold uppercase tracking-[0.22em] hover:border-gold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-gold">
          {labels.chooseFiles}
        </span>
        <span className="text-ink/70">
          {chosenCount === 0
            ? labels.noFilesChosen
            : chosenCount === 1
              ? labels.fileChosenOne
              : labels.filesChosen.replace("{n}", String(chosenCount))}
        </span>
      </label>
      <button
        type="submit"
        disabled={isUploading}
        className="self-start inline-flex items-center justify-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isUploading
          ? progress
            ? `${labels.uploading} ${progress.done}/${progress.total}`
            : labels.uploading
          : labels.uploadButton}
      </button>
      {error && <p className="text-xs italic text-red-700">{error}</p>}
      {warning && (
        <p className="text-xs italic text-amber-700">{warning}</p>
      )}
    </form>
  );
}
