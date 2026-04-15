/**
 * AI Text Enhancement Animation — 参考组件
 * ==========================================
 * 用途：把凌乱的原始文字转换为结构化文字，配合彩色光波揭开动画。
 *
 * 使用方法：
 *   把你的原始行塞进 rawLines，把结构化内容塞进 sections，
 *   然后在页面里渲染 <AIEnhanceCard />，触发 onEnhance 即可。
 *
 * 依赖：
 *   - framer-motion（可选，仅用于 AnimatePresence，去掉也能跑）
 *   - Tailwind CSS
 *
 * 全局 CSS（在项目的全局 CSS 文件里加一次即可，例如 globals.css）：
 *
 *   @keyframes swipe-up {
 *     0%   { opacity: 1; transform: translateY(0);    filter: blur(0px); }
 *     100% { opacity: 0; transform: translateY(-18px); filter: blur(3px); }
 *   }
 *   @keyframes color-flow {
 *     0%   { background-position: 0% 0%; }
 *     100% { background-position: 100% 100%; }
 *   }
 *   .shimmer-text {
 *     background-image: linear-gradient(
 *       135deg,
 *       #f472b6 0%, #fb923c 20%, #facc15 40%,
 *       #86efac 60%, #67e8f9 80%, #c084fc 100%
 *     );
 *     background-size: 300% 300%;
 *     -webkit-background-clip: text;
 *     background-clip: text;
 *     -webkit-text-fill-color: transparent;
 *     animation: color-flow 0.6s ease-out forwards;
 *   }
 *   .color-settle {
 *     transition: color 0.4s ease-out;
 *     -webkit-text-fill-color: unset;
 *   }
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AnimatePresence } from "framer-motion";

// ─── 类型 ────────────────────────────────────────────────

interface TextPart {
  t: string;
  highlight: boolean;
}

interface SectionItem {
  text?: string;
  parts?: TextPart[];   // 有 parts 时忽略 text
  muted: boolean;
  reveal: number;       // 揭开顺序索引（0-based），控制光波先后
}

interface Section {
  id: string;
  header: string;
  headerReveal: number;
  items: SectionItem[];
}

// ─── 动画常量（按需调整） ─────────────────────────────────

const ROW_EXIT_INTERVAL = 50;    // ms：原始每行向上消失的错开间隔
const ROW_EXIT_DURATION = 320;   // ms：单行消失动画时长
const REVEAL_INTERVAL   = 90;    // ms：光波揭开每个节点的间隔
const SHIMMER_DURATION  = 500;   // ms：彩色流光持续时间，之后固化

// ─── RevealText：彩色出现 → 固化 ────────────────────────
// 核心动画单元。
// revealed=false 时文字透明（占位）。
// revealed=true  时：
//   1. 立刻加 .shimmer-text（CSS 彩色渐变 background-clip:text）
//   2. SHIMMER_DURATION ms 后移除 .shimmer-text，加 .color-settle，
//      设置 style.color 到目标颜色，CSS transition 平滑固化。

function RevealText({
  children,
  revealed,
  muted,
  highlight,
}: {
  children: React.ReactNode;
  revealed: boolean;
  muted: boolean;
  highlight: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    if (!revealed || settledRef.current) return;
    const el = ref.current;
    if (!el) return;

    el.classList.add("shimmer-text");

    const t = setTimeout(() => {
      el.classList.remove("shimmer-text");
      el.classList.add("color-settle");
      el.style.color = highlight ? "#92400e" : muted ? "#9ca3af" : "#111827";
      // 清除 background-clip，否则渐变色会遮住 color
      el.style.backgroundImage = "";
      el.style.webkitTextFillColor = "";
      settledRef.current = true;
    }, SHIMMER_DURATION);

    return () => clearTimeout(t);
  }, [revealed]);

  return (
    <span ref={ref} style={{ color: "transparent", display: "inline" }}>
      {children}
    </span>
  );
}

// ─── StructuredLine：单条结构化文字 ─────────────────────

function StructuredLine({
  item,
  revealedSet,
}: {
  item: SectionItem;
  revealedSet: Set<number>;
}) {
  const revealed = revealedSet.has(item.reveal);

  if (item.parts) {
    return (
      <p className="text-sm leading-relaxed" style={{ minHeight: "1.4em" }}>
        {item.parts.map((p, k) => (
          <RevealText key={k} revealed={revealed} muted={false} highlight={p.highlight}>
            {p.t}
          </RevealText>
        ))}
      </p>
    );
  }

  return (
    <p className="text-sm leading-relaxed" style={{ minHeight: "1.4em" }}>
      <RevealText revealed={revealed} muted={item.muted} highlight={false}>
        {item.text}
      </RevealText>
    </p>
  );
}

// ─── 主组件 ──────────────────────────────────────────────
// Props 说明：
//   title       — 固定标题，不参与动画
//   rawLines    — 原始凌乱文字数组
//   sections    — 结构化内容（含 headerReveal 和 items[].reveal 索引）
//   totalReveals — revealIndex 总数，必须 = 所有 headerReveal + items[].reveal 的数量

export function AIEnhanceCard({
  title,
  rawLines,
  sections,
  totalReveals,
}: {
  title: string;
  rawLines: string[];
  sections: Section[];
  totalReveals: number;
}) {
  const [status, setStatus] = useState<"raw" | "animating" | "enhanced">("raw");
  const [rawExiting, setRawExiting] = useState(false);
  const [revealedSet, setRevealedSet] = useState<Set<number>>(new Set());

  // 原始行全部消失所需时间 = 最后一行的 delay + 单行时长
  const rawExitTotalMs = ROW_EXIT_DURATION + (rawLines.length - 1) * ROW_EXIT_INTERVAL;

  const handleEnhance = useCallback(() => {
    if (status !== "raw") return;

    // Phase 1：逐行向上抹除
    setRawExiting(true);

    setTimeout(() => {
      // Phase 2：光波从左上到右下逐节点揭开
      setStatus("animating");
      setRevealedSet(new Set());

      for (let i = 0; i < totalReveals; i++) {
        setTimeout(() => {
          setRevealedSet((prev) => {
            const next = new Set(prev);
            next.add(i);
            return next;
          });
          if (i === totalReveals - 1) {
            // 最后节点固化后标记完成
            setTimeout(() => setStatus("enhanced"), SHIMMER_DURATION + 100);
          }
        }, i * REVEAL_INTERVAL);
      }
    }, rawExitTotalMs);
  }, [status, totalReveals, rawExitTotalMs]);

  const handleReset = () => {
    setStatus("raw");
    setRawExiting(false);
    setRevealedSet(new Set());
  };

  return (
    <div className="w-full max-w-md bg-white">

      {/* 顶栏 */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <span className="text-base select-none">✨</span>
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-all duration-300 ${
              status === "enhanced"
                ? "bg-violet-50 border-violet-200 text-violet-600"
                : status === "animating"
                ? "bg-orange-50 border-orange-200 text-orange-500"
                : "bg-gray-50 border-gray-200 text-gray-400"
            }`}
          >
            AI enhanced
          </span>
        </div>

        {status === "raw" && (
          <button
            onClick={handleEnhance}
            className="text-xs font-semibold px-3.5 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition-colors"
          >
            Enhance ✦
          </button>
        )}
        {status === "enhanced" && (
          <button
            onClick={handleReset}
            className="text-xs px-3.5 py-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 transition-colors"
          >
            Reset
          </button>
        )}
        {status === "animating" && (
          <span className="text-xs text-gray-300">processing…</span>
        )}
      </div>

      {/* 固定标题，不参与动画 */}
      <h2
        className="text-2xl font-semibold text-gray-900 tracking-tight mb-4"
        style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
      >
        {title}
      </h2>

      {/* 内容区 */}
      <div className="relative min-h-[180px]">

        {/* 原始文字：逐行向上消失，每行错开 ROW_EXIT_INTERVAL ms */}
        {(status === "raw" || rawExiting) && (
          <div>
            {rawLines.map((line, i) => (
              <p
                key={i}
                className="text-sm text-gray-400 font-mono leading-relaxed mb-1.5"
                style={
                  rawExiting
                    ? {
                        animation: `swipe-up ${ROW_EXIT_DURATION}ms ease-in forwards`,
                        animationDelay: `${i * ROW_EXIT_INTERVAL}ms`,
                      }
                    : {}
                }
              >
                {line}
              </p>
            ))}
          </div>
        )}

        {/* 结构化内容：光波揭开 */}
        {(status === "animating" || status === "enhanced") && (
          <div className="space-y-4">
            {sections.map((section) => (
              <div key={section.id}>
                <p className="text-sm font-semibold mb-1.5" style={{ minHeight: "1.4em" }}>
                  <RevealText
                    revealed={revealedSet.has(section.headerReveal)}
                    muted={false}
                    highlight={false}
                  >
                    {section.header}
                  </RevealText>
                </p>
                <div className="pl-4 border-l-2 border-gray-100 space-y-0.5">
                  {section.items.map((item, ii) => (
                    <StructuredLine key={ii} item={item} revealedSet={revealedSet} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Demo 用法（直接删掉这段，换成你自己的数据）─────────

const DEMO_RAW_LINES = [
  "100, growing",
  "use tuesday.ai, v manual",
  "180",
  '"a priority for q2"',
];

const DEMO_SECTIONS: Section[] = [
  {
    id: "overview",
    header: "AllFound Overview",
    headerReveal: 0,
    items: [
      { text: "100 employees, adding 20 more next quarter.", muted: false, reveal: 1 },
      { text: "Office in San Francisco and Austin.",         muted: true,  reveal: 2 },
    ],
  },
  {
    id: "provider",
    header: "Current Provider (Tuesday.ai)",
    headerReveal: 3,
    items: [
      { text: "Data input is too manual.",                           muted: false, reveal: 4 },
      { text: "Too complex for non-technical team members.",         muted: true,  reveal: 5 },
      { text: '$180 per employee per year ("too expensive").',       muted: false, reveal: 6 },
    ],
  },
  {
    id: "requirements",
    header: "Their Requirements",
    headerReveal: 7,
    items: [
      {
        muted: false,
        reveal: 8,
        parts: [
          { t: "Finding a better tool is ",  highlight: false },
          { t: '"a priority for Q2"',        highlight: true  },
          { t: ".",                           highlight: false },
        ],
      },
      { text: "Need secure information sharing.", muted: true, reveal: 9 },
    ],
  },
];

export default function Demo() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-12">
      <AIEnhanceCard
        title="Intro call: AllFound"
        rawLines={DEMO_RAW_LINES}
        sections={DEMO_SECTIONS}
        totalReveals={10}
      />
    </div>
  );
}
