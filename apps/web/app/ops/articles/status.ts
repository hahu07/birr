import type { BlogArticle } from "../../../lib/ops-types";

export const ARTICLE_STATUS_TONE: Record<BlogArticle["status"], "success" | "warning" | "neutral" | "danger"> = {
  draft: "neutral",
  published: "success",
  archived: "danger",
};
