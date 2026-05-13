import { createClient } from "@supabase/supabase-js";

export function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Types
export type SourceType =
  | "naver_news"
  | "naver_blog"
  | "naver_cafe"
  | "naver_kin"
  | "youtube";

export type KeywordType = "main" | "sub" | "youtube";

export type ArticleStatus = "pending" | "approved" | "rejected" | "sent";

export type RejectReason =
  | "duplicate"
  | "irrelevant"
  | "incident"
  | "regional"
  | "other"
  | null;

export interface Article {
  id: string;
  title: string;
  url: string;
  description: string | null;
  source_type: SourceType;
  publisher: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  keyword: string;
  keyword_type: KeywordType;
  collected_at: string;
  collect_batch_id: string | null;
  duplicate_group_id: string | null;
  is_duplicate_primary: boolean;
  title_tokens: string[] | null;
  status: ArticleStatus;
  reject_reason: RejectReason;
  reviewed_at: string | null;
  sent_at: string | null;
  slack_channel: string | null;
}

export interface CollectBatch {
  id: string;
  started_at: string;
  completed_at: string | null;
  total_collected: number;
  total_duplicates: number;
  total_filtered: number;
  status: "running" | "completed" | "failed";
  error_message: string | null;
}
