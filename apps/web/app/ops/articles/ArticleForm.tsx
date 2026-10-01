"use client";

// Create/edit form for a blog article, with a live preview rendered by the
// exact same components the public site uses (components/blog/) — what
// staff see here is what a visitor will see once it's approved. Only a
// draft can be edited at all (BlogService.update enforces that); the
// detail page doesn't render this form for a published article.
import { useRef, useState } from "react";
import { apiFetchJson } from "../../../lib/api";
import { Alert, Button, Input, Select } from "@birr/ui";
import { BLOG_CATEGORIES, ILLUSTRATION_KEYS } from "../../../lib/blog-meta";
import { BlogMarkdown } from "../../../components/blog/BlogMarkdown";
import { ILLUSTRATIONS } from "../../../components/blog/illustrations";
import type { BlogArticle } from "../../../lib/ops-types";

export interface ArticleFormValues {
  slug: string;
  title: string;
  description: string;
  body: string;
  category: string;
  illustration: string;
  authorName: string;
}

const EMPTY: ArticleFormValues = {
  slug: "",
  title: "",
  description: "",
  body: "",
  category: "founder-education",
  illustration: "endowment",
  authorName: "Birr Editorial",
};

const TEXTAREA_CLASS =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500";

const FORMAT_HELP =
  "Formatting: ## Heading, - bullet, 1. numbered, **bold**, *italic*, [link](/path). " +
  "Start a worked example with  :::example Title  and close it with  :::  on its own line. " +
  "Tables use | A | B | rows with a |---|---| line under the header.";

export function ArticleForm({
  article,
  onSubmit,
  submitLabel,
}: {
  article?: BlogArticle;
  onSubmit: (values: ArticleFormValues) => Promise<void>;
  submitLabel: string;
}) {
  const [values, setValues] = useState<ArticleFormValues>(
    article
      ? {
          slug: article.slug,
          title: article.title,
          description: article.description,
          body: article.body,
          category: article.category,
          illustration: article.illustration,
          authorName: article.authorName,
        }
      : EMPTY,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [cover, setCover] = useState<string | null>(article?.coverImageUrl ?? null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageAlt, setImageAlt] = useState("");
  const coverInput = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLInputElement>(null);
  const bodyArea = useRef<HTMLTextAreaElement>(null);

  // Images are uploaded straight away (the file is stored and re-encoded
  // server-side) — but the article's text and cover only change when the
  // draft is saved/uploaded here, so nothing public moves before review.
  async function uploadImage(path: string, file: File): Promise<{ ok: boolean; data?: any }> {
    setImageBusy(true);
    setImageError(null);
    try {
      const body = new FormData();
      body.append("image", file);
      return { ok: true, data: await apiFetchJson<any>(path, { method: "POST", body }) };
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Something went wrong.");
      return { ok: false };
    } finally {
      setImageBusy(false);
    }
  }

  async function handleCoverChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !article) return;
    const result = await uploadImage(`/blog-articles/${article.id}/cover`, file);
    if (result.ok) setCover(result.data.coverImageUrl);
  }

  async function handleRemoveCover() {
    if (!article) return;
    setImageBusy(true);
    setImageError(null);
    try {
      await apiFetchJson(`/blog-articles/${article.id}/cover/remove`, { method: "POST" });
      setCover(null);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setImageBusy(false);
    }
  }

  async function handleBodyImageChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !article) return;
    if (!imageAlt.trim()) {
      setImageError("Describe the picture first — it's shown as the caption and read out by screen readers.");
      return;
    }
    const result = await uploadImage(`/blog-articles/${article.id}/images`, file);
    if (!result.ok) return;
    // Insert on its own paragraph at the cursor (or the end).
    const area = bodyArea.current;
    const at = area?.selectionStart ?? values.body.length;
    const snippet = `\n\n![${imageAlt.replace(/[[\]\n]/g, " ").trim()}](${result.data.url})\n\n`;
    set("body", values.body.slice(0, at) + snippet + values.body.slice(at));
    setImageAlt("");
  }

  const set = <K extends keyof ArticleFormValues>(key: K, value: ArticleFormValues[K]) => {
    setSaved(false);
    setValues((v) => ({ ...v, [key]: value }));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(values);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  const Illustration = ILLUSTRATIONS[values.illustration as keyof typeof ILLUSTRATIONS];

  return (
    <div className="grid gap-8 xl:grid-cols-2">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <Alert tone="danger" title="Couldn't save">
            {error}
          </Alert>
        )}
        {saved && <Alert tone="success" title="Saved">Draft saved.</Alert>}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Title</label>
          <Input required value={values.title} onChange={(e) => set("title", e.target.value)} placeholder="What is a waqf?" />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Slug (public URL: /blog/…)</label>
          <Input required value={values.slug} onChange={(e) => set("slug", e.target.value)} placeholder="what-is-a-waqf" />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Summary (shown on cards and in search results)</label>
          <textarea
            required
            rows={2}
            maxLength={300}
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            className={TEXTAREA_CLASS}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="min-w-[12rem] flex-1 space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Category</label>
            <Select value={values.category} onChange={(e) => set("category", e.target.value)}>
              {Object.entries(BLOG_CATEGORIES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-[12rem] flex-1 space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Illustration</label>
            <Select value={values.illustration} onChange={(e) => set("illustration", e.target.value)}>
              {ILLUSTRATION_KEYS.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-[12rem] flex-1 space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Author (byline)</label>
            <Input required value={values.authorName} onChange={(e) => set("authorName", e.target.value)} />
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-700">Cover photo (optional)</p>
          {!article ? (
            <p className="text-xs text-slate-500">Save the draft first, then you can add a cover photo and pictures inside the text.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt="Current cover" className="h-16 w-28 rounded-md border border-slate-200 object-cover" />
                ) : (
                  <span className="text-xs text-slate-500">None — the illustration above is used.</span>
                )}
                <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" disabled={imageBusy} onClick={() => coverInput.current?.click()}>
                  {imageBusy ? "Uploading…" : cover ? "Replace cover photo" : "Upload cover photo"}
                </Button>
                {cover && (
                  <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" disabled={imageBusy} onClick={handleRemoveCover}>
                    Remove
                  </Button>
                )}
                <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleCoverChosen} />
              </div>
              <p className="text-xs text-slate-500">PNG, JPEG or WebP, up to 8MB. Location and camera details are removed automatically. A cover photo replaces the illustration on the article and its cards.</p>
            </>
          )}
          {imageError && <p className="text-xs text-red-600">{imageError}</p>}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Body</label>
          <textarea
            ref={bodyArea}
            required
            rows={22}
            value={values.body}
            onChange={(e) => set("body", e.target.value)}
            className={`${TEXTAREA_CLASS} font-mono`}
          />
          <p className="text-xs text-slate-500">{FORMAT_HELP}</p>
          {article && (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-slate-300 p-3">
              <div className="min-w-[14rem] flex-1 space-y-1">
                <label className="text-xs font-medium text-slate-700">Insert a picture at the cursor — describe it first</label>
                <Input value={imageAlt} maxLength={200} onChange={(e) => setImageAlt(e.target.value)} placeholder="Children collecting water at the new borehole" />
              </div>
              <Button type="button" variant="secondary" className="px-3 py-2 text-xs" disabled={imageBusy} onClick={() => bodyInput.current?.click()}>
                {imageBusy ? "Uploading…" : "Choose picture"}
              </Button>
              <input ref={bodyInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleBodyImageChosen} />
              <p className="w-full text-xs text-slate-500">It's added to the text as <code>![description](link)</code> — remember to <strong>Save draft</strong>.</p>
            </div>
          )}
        </div>

        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : submitLabel}
        </Button>
      </form>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Live preview</p>
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="mb-6 h-48 w-full rounded-2xl object-cover" />
          ) : (
            Illustration && (
              <div className="mb-6 rounded-2xl bg-gradient-to-br from-primary-50 to-accent-50 px-6 py-6">
                <Illustration className="mx-auto h-44 w-auto" />
              </div>
            )
          )}
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{values.title || "Untitled"}</h2>
          <p className="mt-1 text-sm text-slate-500">By {values.authorName || "—"}</p>
          <div className="mt-6">
            <BlogMarkdown source={values.body || "*Nothing written yet.*"} />
          </div>
        </div>
      </div>
    </div>
  );
}
