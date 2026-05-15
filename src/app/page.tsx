"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabase, Article, ArticleStatus, RejectReason } from "@/lib/supabase";

// ============================================
// 상수
// ============================================

const SOURCE_LABELS: Record<string, string> = {
  naver_news: "뉴스",
  naver_blog: "블로그",
  naver_cafe: "카페",
  naver_kin: "지식in",
  youtube: "YouTube",
};

const KEYWORD_TYPE_LABELS: Record<string, string> = {
  main: "메인",
  sub: "서브",
  youtube: "YouTube",
};

const REJECT_REASONS: { value: RejectReason; label: string }[] = [
  { value: "duplicate", label: "중복" },
  { value: "irrelevant", label: "무관" },
  { value: "incident", label: "사건사고" },
  { value: "regional", label: "지역" },
  { value: "other", label: "기타" },
];

const STATUS_TABS: { value: ArticleStatus | "all"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "pending", label: "대기" },
  { value: "approved", label: "승인" },
  { value: "rejected", label: "제외" },
  { value: "sent", label: "발송완료" },
];

// ============================================
// 컴포넌트
// ============================================

export default function Dashboard() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ArticleStatus | "all">("pending");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [keywordTypeFilter, setKeywordTypeFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showDuplicates, setShowDuplicates] = useState(false);

  // 기사 로드
  const fetchArticles = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabase();
    let query = supabase
      .from("articles")
      .select("*")
      .order("collected_at", { ascending: false })
      .limit(500);

    if (activeTab !== "all") {
      query = query.eq("status", activeTab);
    }

    if (sourceFilter !== "all") {
      query = query.eq("source_type", sourceFilter);
    }

    if (keywordTypeFilter !== "all") {
      query = query.eq("keyword_type", keywordTypeFilter);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Fetch error:", error);
      showToast("기사 로딩 실패");
    } else {
      setArticles(data || []);
    }
    setLoading(false);
  }, [activeTab, sourceFilter, keywordTypeFilter]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  // 토스트 메시지
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // 단건 상태 변경
  const updateStatus = async (
    id: string,
    status: ArticleStatus,
    rejectReason?: RejectReason
  ) => {
    const update: any = {
      status,
      reviewed_at: new Date().toISOString(),
    };
    if (rejectReason) update.reject_reason = rejectReason;

    const supabase = getSupabase();
    const { error } = await supabase
      .from("articles")
      .update(update)
      .eq("id", id);

    if (error) {
      showToast("업데이트 실패");
    } else {
      setArticles((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...update } : a))
      );
    }
  };

  // 일괄 승인
  const bulkApprove = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      showToast("선택된 기사가 없습니다");
      return;
    }

    const now = new Date().toISOString();
    const supabase = getSupabase();
    const { error } = await supabase
      .from("articles")
      .update({ status: "approved", reviewed_at: now })
      .in("id", ids);

    if (error) {
      showToast("일괄 승인 실패");
    } else {
      setArticles((prev) =>
        prev.map((a) =>
          ids.includes(a.id)
            ? { ...a, status: "approved" as ArticleStatus, reviewed_at: now }
            : a
        )
      );
      setSelectedIds(new Set());
      showToast(`${ids.length}건 승인 완료`);
    }
  };

  // 일괄 제외
  const bulkReject = async (reason: RejectReason) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    const now = new Date().toISOString();
    const supabase = getSupabase();
    const { error } = await supabase
      .from("articles")
      .update({ status: "rejected", reject_reason: reason, reviewed_at: now })
      .in("id", ids);

    if (error) {
      showToast("일괄 제외 실패");
    } else {
      setArticles((prev) =>
        prev.map((a) =>
          ids.includes(a.id)
            ? {
                ...a,
                status: "rejected" as ArticleStatus,
                reject_reason: reason,
                reviewed_at: now,
              }
            : a
        )
      );
      setSelectedIds(new Set());
      showToast(`${ids.length}건 제외 완료`);
    }
  };

  // 중복 의심만 제외하고 나머지 전체 승인
  const approveNonDuplicates = async () => {
    const pendingArticles = articles.filter((a) => a.status === "pending");
    const nonDupIds = pendingArticles
      .filter((a) => a.is_duplicate_primary)
      .map((a) => a.id);

    if (nonDupIds.length === 0) {
      showToast("승인할 기사가 없습니다");
      return;
    }

    const now = new Date().toISOString();
    const supabase = getSupabase();
    const { error } = await supabase
      .from("articles")
      .update({ status: "approved", reviewed_at: now })
      .in("id", nonDupIds);

    if (error) {
      showToast("승인 실패");
    } else {
      fetchArticles();
      showToast(`대표 기사 ${nonDupIds.length}건 승인, 중복 의심 기사는 리뷰 필요`);
    }
  };

  // Slack 발송
  const sendToSlack = async () => {
    const approvedArticles = articles.filter((a) => a.status === "approved");
    if (approvedArticles.length === 0) {
      showToast("승인된 기사가 없습니다");
      return;
    }

    setSending(true);
    try {
      const resp = await fetch("/api/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleIds: approvedArticles.map((a) => a.id),
          channel: "brand",
        }),
      });
      const data = await resp.json();
      if (data.success) {
        showToast(`${data.sent}건 Slack 발송 완료!`);
        fetchArticles();
      } else {
        showToast(`발송 실패: ${data.error}`);
      }
    } catch (err) {
      showToast("발송 중 오류 발생");
    }
    setSending(false);
  };

  // 전체 선택 / 해제
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredArticles.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredArticles.map((a) => a.id)));
    }
  };

  // 중복 그룹별 기사 모으기
  const duplicateGroups = articles.reduce(
    (acc, article) => {
      if (!article.duplicate_group_id) return acc;
      if (!acc[article.duplicate_group_id]) {
        acc[article.duplicate_group_id] = [];
      }
      acc[article.duplicate_group_id].push(article);
      return acc;
    },
    {} as Record<string, Article[]>
  );

  const multiDupGroups = Object.entries(duplicateGroups).filter(
    ([, group]) => group.length > 1
  );

  // 키워드 필터
  const uniqueKeywords = [...new Set(articles.map((a) => a.keyword))].sort();
  const filteredArticles =
    selectedKeywords.size === 0
      ? articles
      : articles.filter((a) => selectedKeywords.has(a.keyword));

  const toggleKeyword = (kw: string) => {
    setSelectedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  };

  // 통계
  const stats = {
    total: filteredArticles.length,
    pending: filteredArticles.filter((a) => a.status === "pending").length,
    approved: filteredArticles.filter((a) => a.status === "approved").length,
    rejected: filteredArticles.filter((a) => a.status === "rejected").length,
    sent: filteredArticles.filter((a) => a.status === "sent").length,
    duplicateGroups: multiDupGroups.length,
  };

  return (
    <div className="min-h-screen">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              뉴스봇 대시보드
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              브랜드 모니터링 리뷰
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchArticles}
              className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition"
            >
              새로고침
            </button>
            <button
              onClick={sendToSlack}
              disabled={sending || stats.approved === 0}
              className="px-4 py-1.5 text-sm bg-emerald-600 text-white hover:bg-emerald-700 rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? "발송 중..." : `Slack 발송 (${stats.approved}건)`}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* 통계 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {[
            { label: "전체", value: stats.total, color: "bg-gray-100" },
            { label: "대기", value: stats.pending, color: "bg-yellow-50 text-yellow-800" },
            { label: "승인", value: stats.approved, color: "bg-green-50 text-green-800" },
            { label: "제외", value: stats.rejected, color: "bg-red-50 text-red-800" },
            { label: "중복 의심 그룹", value: stats.duplicateGroups, color: "bg-orange-50 text-orange-800" },
          ].map((s) => (
            <div key={s.label} className={`rounded-lg p-3 ${s.color}`}>
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* 필터 영역 */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <div className="flex flex-wrap gap-4 items-center">
            {/* 상태 탭 */}
            <div className="flex gap-1">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={`px-3 py-1 text-sm rounded-md transition ${
                    activeTab === tab.value
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="h-6 w-px bg-gray-200" />

            {/* 소스 필터 */}
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-md px-2 py-1"
            >
              <option value="all">모든 소스</option>
              {Object.entries(SOURCE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>

            {/* 키워드 타입 필터 */}
            <select
              value={keywordTypeFilter}
              onChange={(e) => setKeywordTypeFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-md px-2 py-1"
            >
              <option value="all">모든 키워드</option>
              {Object.entries(KEYWORD_TYPE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>

            <div className="h-6 w-px bg-gray-200" />

            {/* 중복 보기 토글 */}
            <button
              onClick={() => setShowDuplicates(!showDuplicates)}
              className={`px-3 py-1 text-sm rounded-md transition ${
                showDuplicates
                  ? "bg-orange-100 text-orange-800"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              중복 의심 보기 ({stats.duplicateGroups})
            </button>
          </div>

          {/* 키워드 칩 필터 */}
          {uniqueKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3 pt-3 border-t border-gray-100">
              <button
                onClick={() => setSelectedKeywords(new Set())}
                className={`px-2.5 py-1 text-xs rounded-full transition ${
                  selectedKeywords.size === 0
                    ? "bg-emerald-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                전체
              </button>
              {uniqueKeywords.map((kw) => (
                <button
                  key={kw}
                  onClick={() => toggleKeyword(kw)}
                  className={`px-2.5 py-1 text-xs rounded-full transition ${
                    selectedKeywords.has(kw)
                      ? "bg-emerald-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {kw}
                </button>
              ))}
            </div>
          )}

          {/* 일괄 액션 */}
          {selectedIds.size > 0 && (
            <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
              <span className="text-sm text-gray-500 mr-2">
                {selectedIds.size}건 선택
              </span>
              <button
                onClick={bulkApprove}
                className="px-3 py-1 text-xs bg-green-100 text-green-800 hover:bg-green-200 rounded-md"
              >
                일괄 승인
              </button>
              {REJECT_REASONS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => bulkReject(r.value)}
                  className="px-3 py-1 text-xs bg-red-50 text-red-700 hover:bg-red-100 rounded-md"
                >
                  제외: {r.label}
                </button>
              ))}
            </div>
          )}

          {/* 빠른 액션 */}
          {activeTab === "pending" && stats.pending > 0 && (
            <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
              <button
                onClick={approveNonDuplicates}
                className="px-3 py-1 text-xs bg-blue-50 text-blue-800 hover:bg-blue-100 rounded-md"
              >
                대표 기사만 전체 승인 (중복 의심 제외)
              </button>
              <button
                onClick={toggleSelectAll}
                className="px-3 py-1 text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-md"
              >
                {selectedIds.size === filteredArticles.length
                  ? "전체 해제"
                  : "전체 선택"}
              </button>
            </div>
          )}
        </div>

        {/* 중복 의심 그룹 뷰 */}
        {showDuplicates && multiDupGroups.length > 0 && (
          <div className="mb-6 space-y-4">
            <h2 className="text-sm font-semibold text-orange-800">
              중복 의심 그룹 ({multiDupGroups.length}개)
            </h2>
            {multiDupGroups.map(([groupId, group]) => (
              <div
                key={groupId}
                className="bg-orange-50 border border-orange-200 rounded-lg p-4"
              >
                <div className="text-xs text-orange-600 mb-2">
                  {group.length}건 유사 기사
                </div>
                {group.map((article) => (
                  <div
                    key={article.id}
                    className={`flex items-start gap-3 py-2 ${
                      !article.is_duplicate_primary ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {article.is_duplicate_primary && (
                          <span className="text-[10px] bg-orange-200 text-orange-800 px-1.5 py-0.5 rounded">
                            대표
                          </span>
                        )}
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-gray-900 hover:text-blue-600 truncate"
                        >
                          {article.title}
                        </a>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {SOURCE_LABELS[article.source_type]} |{" "}
                        {article.publisher || "-"}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => updateStatus(article.id, "approved")}
                        className="px-2 py-1 text-[10px] bg-green-100 text-green-700 hover:bg-green-200 rounded"
                      >
                        승인
                      </button>
                      <button
                        onClick={() =>
                          updateStatus(article.id, "rejected", "duplicate")
                        }
                        className="px-2 py-1 text-[10px] bg-red-50 text-red-700 hover:bg-red-100 rounded"
                      >
                        중복제외
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* 기사 목록 */}
        {loading ? (
          <div className="text-center py-20 text-gray-400">로딩 중...</div>
        ) : filteredArticles.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            기사가 없습니다
          </div>
        ) : (
          <div className="space-y-2">
            {filteredArticles.map((article) => (
              <ArticleRow
                key={article.id}
                article={article}
                selected={selectedIds.has(article.id)}
                onSelect={() => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(article.id)) {
                      next.delete(article.id);
                    } else {
                      next.add(article.id);
                    }
                    return next;
                  });
                }}
                onUpdateStatus={updateStatus}
              />
            ))}
          </div>
        )}
      </main>

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50 animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

// ============================================
// 기사 행 컴포넌트
// ============================================

function ArticleRow({
  article,
  selected,
  onSelect,
  onUpdateStatus,
}: {
  article: Article;
  selected: boolean;
  onSelect: () => void;
  onUpdateStatus: (
    id: string,
    status: ArticleStatus,
    reason?: RejectReason
  ) => void;
}) {
  const [showRejectMenu, setShowRejectMenu] = useState(false);

  return (
    <div
      className={`bg-white border rounded-lg p-4 transition ${
        selected ? "border-blue-400 bg-blue-50/30" : "border-gray-200"
      } ${!article.is_duplicate_primary ? "border-l-4 border-l-orange-300" : ""}`}
    >
      <div className="flex items-start gap-3">
        {/* 체크박스 */}
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          className="mt-1 rounded border-gray-300"
        />

        {/* 썸네일 (YouTube) */}
        {article.thumbnail_url && (
          <img
            src={article.thumbnail_url}
            alt=""
            className="w-20 h-14 object-cover rounded flex-shrink-0"
          />
        )}

        {/* 콘텐츠 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] bg-emerald-100 text-emerald-800 font-medium px-1.5 py-0.5 rounded">
              {KEYWORD_TYPE_LABELS[article.keyword_type]}: {article.keyword}
            </span>
            <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
              {SOURCE_LABELS[article.source_type]}
            </span>
            {article.publisher && (
              <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                {article.publisher}
              </span>
            )}
            {!article.is_duplicate_primary && (
              <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">
                중복 의심
              </span>
            )}
          </div>

          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-gray-900 hover:text-blue-600 line-clamp-1"
          >
            {article.title}
          </a>

          {article.description && (
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">
              {article.description}
            </p>
          )}

          <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
            {article.published_at && (
              <span>
                {new Date(article.published_at).toLocaleDateString("ko-KR")}
              </span>
            )}
          </div>
        </div>

        {/* 액션 버튼 */}
        {article.status === "pending" && (
          <div className="flex gap-1 flex-shrink-0">
            <button
              onClick={() => onUpdateStatus(article.id, "approved")}
              className="px-3 py-1.5 text-xs bg-green-100 text-green-700 hover:bg-green-200 rounded-md transition"
            >
              승인
            </button>
            <div className="relative">
              <button
                onClick={() => setShowRejectMenu(!showRejectMenu)}
                className="px-3 py-1.5 text-xs bg-red-50 text-red-700 hover:bg-red-100 rounded-md transition"
              >
                제외
              </button>
              {showRejectMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1 min-w-[100px]">
                  {REJECT_REASONS.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => {
                        onUpdateStatus(article.id, "rejected", r.value);
                        setShowRejectMenu(false);
                      }}
                      className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 text-gray-700"
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 승인된 기사 되돌리기 */}
        {article.status === "approved" && (
          <button
            onClick={() => onUpdateStatus(article.id, "pending")}
            className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 rounded-md transition flex-shrink-0"
          >
            되돌리기
          </button>
        )}

        {/* 제외된 기사 복원 */}
        {article.status === "rejected" && (
          <button
            onClick={() => onUpdateStatus(article.id, "pending")}
            className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 rounded-md transition flex-shrink-0"
          >
            복원
          </button>
        )}
      </div>
    </div>
  );
}
