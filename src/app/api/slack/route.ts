import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";


export const dynamic = "force-dynamic";
const SLACK_WEBHOOKS: Record<string, string> = {
  brand: process.env.SLACK_WEBHOOK_URL || "",
  news: process.env.SLACK_WEBHOOK_URL_2 || "",
  blog: process.env.SLACK_WEBHOOK_URL_BLOG || "",
};

function buildSlackMessage(articles: any[]) {
  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📰 뉴스봇 리뷰 완료 (${articles.length}건)`,
        emoji: true,
      },
    },
    { type: "divider" },
  ];

  const sourceLabels: Record<string, string> = {
    naver_news: "뉴스",
    naver_blog: "블로그",
    naver_cafe: "카페",
    naver_kin: "지식in",
    youtube: "YouTube",
  };

  for (const article of articles.slice(0, 20)) {
    const sourceLabel = sourceLabels[article.source_type] || article.source_type;
    const publisher = article.publisher ? ` | ${article.publisher}` : "";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*<${article.url}|${article.title}>*\n[${sourceLabel}]${publisher} | 키워드: ${article.keyword}`,
      },
    });
  }

  if (articles.length > 20) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `_...외 ${articles.length - 20}건_`,
      },
    });
  }

  return { blocks };
}

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

    // 승인된 기사 가져오기
    const { data: articles, error } = await supabase
      .from("articles")
      .select("*")
      .in("id", articleIds)
      .eq("status", "approved");

    if (error) throw error;
    if (!articles || articles.length === 0) {
      return NextResponse.json({ error: "No approved articles found" }, { status: 404 });
    }

    // Slack 발송
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

    // 상태 업데이트: approved → sent
    const now = new Date().toISOString();
    await supabase
      .from("articles")
      .update({ status: "sent", sent_at: now, slack_channel: channel })
      .in("id", articleIds);

    return NextResponse.json({
      success: true,
      sent: articles.length,
    });
  } catch (err: any) {
    console.error("Slack send error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
