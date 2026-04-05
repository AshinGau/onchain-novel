"use client";

import { inputBase, labelClass } from "@/components/config-form";

const textInputClass = `${inputBase} border-neutral-700`;

interface NovelMetadataFieldsProps {
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  coverUri: string;
  setCoverUri: (v: string) => void;
  descriptionPlaceholder?: string;
}

export function NovelMetadataFields({
  title, setTitle, description, setDescription, coverUri, setCoverUri,
  descriptionPlaceholder = "Describe your novel...",
}: NovelMetadataFieldsProps) {
  return (
    <section className="rounded-lg bg-neutral-900 border border-neutral-800 p-5">
      <h2 className="font-semibold mb-4">Novel Metadata</h2>
      <div className="space-y-4">
        <div>
          <label className={labelClass}>Title *</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter novel title" className={textInputClass} required />
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder={descriptionPlaceholder} rows={3} className={textInputClass} />
        </div>
        <div>
          <label className={labelClass}>Cover Image URL (optional)</label>
          <input type="text" value={coverUri} onChange={(e) => setCoverUri(e.target.value)}
            placeholder="https://..." className={textInputClass} />
        </div>
      </div>
    </section>
  );
}
