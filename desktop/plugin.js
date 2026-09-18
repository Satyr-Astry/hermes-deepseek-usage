/**
 * DeepSeek 用量与余额 · 桌面插件
 * ================================
 * 状态栏芯片（余额 + 峰谷时段）+ 右侧面板（余额/峰谷/价格表/消耗趋势）。
 * 数据源：插件后端 /api/plugins/deepseek-usage/{balance,pricing}
 *
 * 严格遵循 desktop-plugin SDK：
 *   - 只用 jsx() 调用（文件不编译，无 JSX 语法）
 *   - 只 import @hermes/plugin-sdk / react / react/jsx-runtime
 *   - 用主题变量，不硬编码颜色
 */
import { atom, haptic, host, Tip, useValue } from '@hermes/plugin-sdk';
import { jsx } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';

const ID = 'deepseek-usage';
const POLL_MS = 60_000;

// 共享状态（chip 与 pane 共用）
const $bal = atom(null);   // { ok, balance, currency, granted, topped_up, spent_today, spent_week, checked_at }
const $prc = atom(null);   // { ok, state: {period, remaining_min, switch_at, now_bj}, table }

async function fetchAll(ctx) {
  try {
    const b = await ctx.rest('/balance', { timeoutMs: 20_000 })
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
    $bal.set(b);
  } catch (e) { $bal.set({ ok: false, error: String(e) }); }
  try {
    const p = await ctx.rest('/pricing', { timeoutMs: 10_000 })
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
    $prc.set(p);
  } catch (e) { $prc.set({ ok: false, error: String(e) }); }
}

const cur = (b) => (b && b.currency) || 'CNY';
const sym = (c) => (c === 'CNY' ? '¥' : c === 'USD' ? '$' : c + ' ');
const fmtMoney = (b) => {
  if (!b || b.ok === false || b.balance == null) return '—';
  return sym(b.currency) + Number(b.balance).toFixed(2);
};
const periodEmoji = (p) => (!p || !p.ok ? '' : p.state.period === 'peak' ? '🔥' : '❄️');

function fmtRemaining(min) {
  if (min == null) return '—';
  if (min >= 60) {
    const h = Math.floor(min / 60), m = min % 60;
    return `${h} 小时 ${m} 分`;
  }
  return `${min} 分钟`;
}

function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleTimeString();
}

// ---------------- 状态栏芯片 ----------------
function Chip() {
  const b = useValue($bal);
  const p = useValue($prc);
  const err = b && b.ok === false;
  const tone = err ? 'text-(--ui-text-quaternary)' :
    (b && b.ok && b.balance < 5) ? 'text-(--ui-warning)' : 'text-(--ui-text-tertiary)';
  let tip = 'DeepSeek 用量 — 加载中…';
  if (b) {
    tip = err
      ? `DeepSeek — 余额不可用: ${b.error || '错误'}`
      : `DeepSeek 余额 ${fmtMoney(b)} · ${(p && p.ok ? p.state.period_label : '?')}时段` +
        (p && p.ok && p.state.remaining_min != null ? `（${fmtRemaining(p.state.remaining_min)}后切换）` : '') +
        ` · 更新于 ${fmtTime(b.checked_at)}`;
  }
  return jsx(Tip, {
    label: tip,
    children: jsx('button', {
      className: `inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] transition-colors ${tone} hover:text-foreground`,
      type: 'button',
      onClick: () => {
        haptic('tap');
        host.notify({ kind: err ? 'error' : 'info', message: tip });
      },
      children: jsx('span', {
        className: 'inline-flex items-center gap-1',
        children: [
          jsx('span', { className: 'opacity-70', children: 'DS ·' }),
          jsx('span', { children: fmtMoney(b) }),
          jsx('span', { children: periodEmoji(p) }),
        ],
      }),
    }),
  });
}

// ---------------- 面板小组件 ----------------
function Row({ label, value, accent }) {
  return jsx('div', {
    style: { display: 'flex', justifyContent: 'space-between', gap: '8px',
             padding: '3px 0', fontSize: '12px',
             borderBottom: '1px solid var(--ui-stroke-secondary)' },
    children: [
      jsx('span', { style: { color: 'var(--ui-text-quaternary)' }, children: label }),
      jsx('span', { style: { color: accent || 'var(--ui-text-secondary)', fontWeight: 500,
                             textAlign: 'right', wordBreak: 'break-all' },
                    children: String(value) }),
    ],
  });
}

function Section({ title, children }) {
  return jsx('div', {
    style: { marginBottom: '14px' },
    children: [
      jsx('div', { style: { color: 'var(--ui-accent)', fontSize: '11px',
                            textTransform: 'uppercase', letterSpacing: '0.06em',
                            marginBottom: '6px', fontWeight: 600 }, children: title }),
      children,
    ],
  });
}

// ---------------- 面板 ----------------
function Pane({ ctx }) {
  const b = useValue($bal);
  const p = useValue($prc);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchAll(ctx); }, []);

  const refresh = async () => {
    setBusy(true);
    await fetchAll(ctx);
    setBusy(false);
  };

  const btn = (label, fn, disabled) => jsx('button', {
    onClick: fn, disabled: disabled || busy,
    style: { padding: '5px 12px', borderRadius: '6px', cursor: 'pointer',
             fontSize: '12px', border: '1px solid var(--ui-stroke-secondary)',
             background: 'transparent', color: 'var(--ui-text-secondary)' },
    children: label,
  });

  if (!b && !p) {
    return jsx('div', { style: { padding: '12px', fontSize: '12px',
      color: 'var(--ui-text-quaternary)' }, children: '加载中…' });
  }

  const st = p && p.ok ? p.state : null;
  const peak = st && st.period === 'peak';
  const balErr = b && b.ok === false;

  const sections = [];

  // 余额
  sections.push(jsx(Section, { key: 'bal', title: '余额', children: jsx('div', {
    children: [
      jsx('div', { style: { fontSize: '26px', fontWeight: 700, color: 'var(--ui-accent)',
        marginBottom: '4px' }, children: fmtMoney(b) }),
      balErr ? jsx(Row, { label: '错误', value: b.error || '未知' }) : null,
      b && b.ok ? jsx(Row, { label: '充值余额', value: sym(b.currency) + Number(b.topped_up || 0).toFixed(2) }) : null,
      b && b.ok ? jsx(Row, { label: '赠送余额', value: sym(b.currency) + Number(b.granted || 0).toFixed(2) }) : null,
      b ? jsx(Row, { label: '更新时间', value: fmtTime(b.checked_at) }) : null,
    ].filter(Boolean),
  }) }));

  // 峰谷
  sections.push(jsx(Section, { key: 'price', title: '峰谷计价', children: jsx('div', {
    children: [
      jsx('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '4px',
        color: peak ? 'var(--ui-warning)' : 'var(--ui-text-secondary)' },
        children: `${periodEmoji(p)} ${st ? st.period_label + '时段' : '—'}${st ? (peak ? '（标准价）' : '（5 折）') : ''}` }),
      st ? jsx(Row, { label: '北京时间', value: st.now_bj }) : null,
      st ? jsx(Row, { label: '距切换', value: fmtRemaining(st.remaining_min) + '（→ ' + (st.switch_at || '?') + '）' }) : null,
      jsx('div', { style: { marginTop: '8px', fontSize: '11px',
        color: 'var(--ui-text-quaternary)', marginBottom: '4px' },
        children: '当前单价（USD / 百万 tokens · 输入 / 输出）' }),
      p && p.ok ? Object.entries(p.table).map(([mid, t]) =>
        jsx(Row, { key: mid, label: t.label, value: `$${t.in} / $${t.out}` })
      ) : null,
      p && p.ok ? jsx('div', { style: { marginTop: '6px', fontSize: '11px',
        color: 'var(--ui-text-quaternary)' },
        children: `高峰 ${p.table['deepseek-flash'] ? '$' + p.table['deepseek-flash'].in_peak + '/' + '$' + p.table['deepseek-flash'].out_peak : '?'} · ` +
                  `空闲 ${p.table['deepseek-flash'] ? '$' + p.table['deepseek-flash'].in_idle + '/' + '$' + p.table['deepseek-flash'].out_idle : '?'}（Flash）` }) : null,
    ].filter(Boolean),
  }) }));

  // 消耗
  sections.push(jsx(Section, { key: 'spend', title: '消耗趋势', children: jsx('div', {
    children: [
      b && b.ok ? jsx(Row, { label: '今日消耗', value: b.spent_today != null ? (sym(b.currency) + Number(b.spent_today).toFixed(2)) : '积累中…' }) : null,
      b && b.ok ? jsx(Row, { label: '近 7 日', value: b.spent_week != null ? (sym(b.currency) + Number(b.spent_week).toFixed(2)) : '积累中…' }) : null,
      b && b.ok ? jsx(Row, { label: '快照数', value: b.snapshots || 0 }) : null,
    ].filter(Boolean),
  }) }));

  // 操作
  sections.push(jsx('div', { key: 'ops', style: { display: 'flex', gap: '6px' },
    children: [ btn('刷新', refresh) ] }));

  return jsx('div', { style: { padding: '12px', fontSize: '12px', overflowY: 'auto', height: '100%' },
    children: sections });
}

export default {
  id: ID,
  name: 'DeepSeek 用量',
  register(ctx) {
    fetchAll(ctx);
    const t = setInterval(() => fetchAll(ctx), POLL_MS);
    ctx.onDispose(() => clearInterval(t));

    // 状态栏芯片
    ctx.register({
      id: ID + '-chip',
      area: 'statusBar.right',
      order: 118,
      render: () => jsx(Chip, {}),
    });

    // 右侧面板
    ctx.register({
      id: ID + '-pane',
      area: 'panes',
      title: 'DeepSeek 用量',
      data: { placement: 'right' },
      render: () => jsx(Pane, { ctx }),
    });
    return () => {};
  },
};
