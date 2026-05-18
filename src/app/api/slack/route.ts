import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SLACK_WEBHOOKS: Record<string, string> = {
  brand: process.env.SLACK_WEBHOOK_URL || "",
  news: process.env.SLACK_WEBHOOK_URL_2 || "",
  blog: process.env.SLACK_WEBHOOK_URL_BLOG || "",
};

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  naver_news: "Naver 뉴스",
  naver_blog: "Naver 블로그",
  naver_cafe: "Naver 카페",
  naver_kin: "Naver 지식in",
  youtube: "YouTube",
};

function formatDate(raw: string | null): string | null {
  if (!raw) return null;
  try {
    // YYYYMMDD
    if (/^\d{8}$/.test(raw)) {
      return `${raw.slice(0, 4)}.${raw.slice(4, 6)}.${raw.slice(6, 8)}`;
    }
    // ISO or RFC 2822
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}.${m}.${day}`;
  } catch {
    return null;
  }
}

function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 3000자 한도 고려해 lines → blocks 분할
function linesToBlocks(lines: string[]): any[] {
  const blocks: any[] = [];
  let chunk = "";
  for (const line of lines) {
    const next = chunk ? chunk + "\n" + line : line;
    if (next.length > 2900) {
      if (chunk) blocks.push({ type: "section", text: { type: "mrkdwn", text: chunk } });
      chunk = line;
    } else {
      chunk = next;
    }
  }
  if (chunk) blocks.push({ type: "section", text: { type: "mrkdwn", text: chunk } });
  return blocks;
}

// ─────────────────────────────────────────────
// 메시지 빌더
// ─────────────────────────────────────────────

function buildSlackMessage(articles: any[]) {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateStr =
    `${kst.getUTCFullYear()}년 ` +
    `${String(kst.getUTCMonth() + 1).padStart(2, "0")}월 ` +
    `${String(kst.getUTCDate()).padStart(2, "0")}일 ` +
    `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")} KST`;

  const mainArticles = articles.filter((a) => a.keyword_type === "main");
  const subArticles = articles.filter((a) => a.keyword_type === "sub");
  const youtubeArticles = articles.filter((a) => a.keyword_type === "youtube");

  // 키워드별 그룹
  const groupByKeyword = (arr: any[]) =>
    arr.reduce((acc: Record<string, any[]>, a) => {
      (acc[a.keyword] = acc[a.keyword] || []).push(a);
      return acc;
    }, {});

  const mainGroups = groupByKeyword(mainArticles);
  const subGroups = groupByKeyword(subArticles);

  const lines: string[] = [];

  // ── 헤더
  lines.push(`:bar_chart: 브랜드 모니터링 리포트`);
  lines.push(`:clock1: ${dateStr}  |  총 ${articles.length}건`);

  // ── 메인 키워드
  for (const [kw, kwArticles] of Object.entries(mainGroups)) {
    lines.push("");
    lines.push(`*:mag: ${kw}* (메인)  —  ${kwArticles.length}건`);
    for (const a of kwArticles) {
      const src = SOURCE_LABELS[a.source_type] || a.source_type;
      const date = formatDate(a.published_at);
      // 블로그는 날짜 표시, 나머지는 소스만
      const suffix =
        a.source_type === "naver_blog" && date
          ? `_(${src} · ${date})_`
          : `_(${src})_`;
      lines.push(`• <${a.url}|${escapeSlack(a.title)}>  ${suffix}`);
    }
  }

  // ── 서브 키워드
  if (subArticles.length > 0) {
    lines.push("");
    lines.push(`*:newspaper: 서브키워드 (뉴스)*  —  ${subArticles.length}건`);
    for (const [kw, kwArticles] of Object.entries(subGroups)) {
      lines.push(`_${kw}_ (${kwArticles.length}건)`);
      for (const a of kwArticles) {
        const date = formatDate(a.published_at);
        const suffix = date ? `_(${date})_` : "";
        lines.push(`• <${a.url}|${escapeSlack(a.title)}>  ${suffix}`);
      }
    }
  }

  // ── YouTube
  if (youtubeArticles.length > 0) {
    lines.push("");
    lines.push(`*:youtube: YouTube*  —  ${youtubeArticles.length}건`);
    for (const a of youtubeArticles) {
      const date = formatDate(a.published_at);
      const suffix = date ? `_(${date})_` : "";
      lines.push(`• <${a.url}|${escapeSlack(a.title)}>  ${suffix}`);
    }
  }

  return { blocks: linesToBlocks(lines) };
}

// ─────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );
    const { articleIds, channel = "brand" } = await request.json();

    if (!articleIds || articleIds.length === 0) {
      return NextResponse.json({ error: "articleIds required" }, { status: 400 });
    }

    const { data: articles, error } = await supabase
      .from("articles")
      .select("*")
      .in("id", articleIds)
      .eq("status", "approved")
      .order("keyword_type", { ascending: true })
      .order("keyword", { ascending: true })
      .order("collected_at", { ascending: false });

    if (error) throw error;
    if (!articles || articles.length === 0) {
      return NextResponse.json({ error: "No approved articles found" }, { status: 404 });
    }

    const webhookUrl = SLACK_WEBHOOKS[channel] || SLACK_WEBHOOKS.brand;
    if (!webhookUrl) {
      return NextResponse.json({ error: "Slack webhook not configured" }, { status: 500 });
    }

    const message = buildSlackMessage(articles);
    const slackResp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!slackResp.ok) {
      throw new Error(`Slack webhook failed: ${slackResp.status}`);
    }

    const now = new Date().toISOString();
    await supabase
      .from("articles")
      .update({ status: "sent", sent_at: now, slack_channel: channel })
      .in("id", articleIds);

    return NextResponse.json({ success: true, sent: articles.length });
  } catch (err: any) {
    console.error("Slack send error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
