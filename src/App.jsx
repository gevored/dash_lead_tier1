import React, { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import './App.css'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const RANGES = ['100k-300k', '300k-500k', '500k-1MM', '1MM-5MM', '5MM+']
const COLORS = ['#3ecf8e','#f24822','#f5a623','#7c5cfc','#17c3b2','#e94f37','#52b788','#4895ef']

const BU_NORMALIZE = {
  'Perini': 'Bruno Perini',
}

function normalizeBU(bu) {
  const clean = (bu || 'Sem BU').replace(/\+/g, ' ').trim()
  return BU_NORMALIZE[clean] || clean
}

function parsePatrimonioRange(text) {
  if (!text) return null
  const nums = []
  const matches = text.match(/[\d.]+/g)
  if (matches) matches.forEach(m => { const n = parseFloat(m.replace(/\./g, '')); if (!isNaN(n)) nums.push(n) })
  const isAcima = text.toLowerCase().includes('acima')
  const ref = isAcima ? nums[0] : (nums.length > 0 ? Math.min(...nums) : null)
  if (ref === null) return null
  if (ref >= 5000000) return '5MM+'
  if (ref >= 1000000) return '1MM-5MM'
  if (ref >= 500000) return '500k-1MM'
  if (ref >= 300000) return '300k-500k'
  if (ref >= 100000) return '100k-300k'
  return null
}

function getLast14Days() {
  const days = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

function buildChartData(leads, groupBy, selectedBU) {
  const days = getLast14Days()
  const cutoff = new Date(days[0])
  const filtered = leads.filter(l => new Date(l.created_at) >= cutoff)

  const groupSet = new Set()
  filtered.forEach(l => {
    if (groupBy === 'dt') {
      if (selectedBU && normalizeBU(l.bu) !== selectedBU) return
      groupSet.add((l.dt || 'Sem Canal').replace(/\+/g, ' '))
    } else {
      groupSet.add(normalizeBU(l.bu))
    }
  })
  const groups = [...groupSet]

  const dataByDay = {}
  days.forEach(day => { dataByDay[day] = {} })
  filtered.forEach(l => {
    const day = l.created_at.slice(0, 10)
    if (!dataByDay[day]) return
    if (groupBy === 'dt' && selectedBU && normalizeBU(l.bu) !== selectedBU) return
    const group = groupBy === 'dt'
      ? (l.dt || 'Sem Canal').replace(/\+/g, ' ')
      : normalizeBU(l.bu)
    dataByDay[day][group] = (dataByDay[day][group] || 0) + 1
  })

  return { days, groups, dataByDay }
}

function build14DaySummary(leads) {
  const days = getLast14Days()
  const cutoff = new Date(days[0])
  const filtered = leads.filter(l => new Date(l.created_at) >= cutoff)
  const buMap = {}
  filtered.forEach(l => {
    const bu = normalizeBU(l.bu)
    if (!buMap[bu]) buMap[bu] = { totais: 0, reentrada: 0, ranges: {} }
    buMap[bu].totais++
    if (l.sf_exists === true) buMap[bu].reentrada++
    const range = parsePatrimonioRange(l.patrimonio)
    if (range) buMap[bu].ranges[range] = (buMap[bu].ranges[range] || 0) + 1
  })
  return buMap
}

function buildHierarchy(leads) {
  const buMap = {}
  for (const lead of leads) {
    const bu = normalizeBU(lead.bu)
    const dt = (lead.dt || 'Sem Canal').replace(/\+/g, ' ')
    const pmp = (lead.pmp || 'Sem PMP').replace(/\+/g, ' ')
    const isReentrada = lead.sf_exists === true
    const range = parsePatrimonioRange(lead.patrimonio)

    if (!buMap[bu]) buMap[bu] = { totais: 0, reentrada: 0, ranges: {}, dts: {} }
    if (!buMap[bu].dts[dt]) buMap[bu].dts[dt] = { totais: 0, reentrada: 0, ranges: {}, pmps: {} }
    if (!buMap[bu].dts[dt].pmps[pmp]) buMap[bu].dts[dt].pmps[pmp] = { totais: 0, reentrada: 0, ranges: {} }

    buMap[bu].totais++; buMap[bu].dts[dt].totais++; buMap[bu].dts[dt].pmps[pmp].totais++
    if (isReentrada) { buMap[bu].reentrada++; buMap[bu].dts[dt].reentrada++; buMap[bu].dts[dt].pmps[pmp].reentrada++ }
    if (range) {
      buMap[bu].ranges[range] = (buMap[bu].ranges[range] || 0) + 1
      buMap[bu].dts[dt].ranges[range] = (buMap[bu].dts[dt].ranges[range] || 0) + 1
      buMap[bu].dts[dt].pmps[pmp].ranges[range] = (buMap[bu].dts[dt].pmps[pmp].ranges[range] || 0) + 1
    }
  }
  return buMap
}

const AnimatedCell = ({ value }) => {
  const prevRef = useRef(value)
  const [flashClass, setFlashClass] = useState('')
  useEffect(() => {
    if (value !== prevRef.current && prevRef.current !== undefined) {
      setFlashClass(value > prevRef.current ? 'flash-green' : 'flash-red')
      const t = setTimeout(() => setFlashClass(''), 1200)
      prevRef.current = value
      return () => clearTimeout(t)
    } else { prevRef.current = value }
  }, [value])
  return <span className={`animated-cell ${flashClass}`}>{value ?? 0}</span>
}

function LineChart({ leads, groupBy, selectedBU }) {
  const { days, groups, dataByDay } = buildChartData(leads, groupBy, selectedBU)
  const W = 900, H = 220
  const padL = 36, padR = 16, padT = 16, padB = 36
  const chartW = W - padL - padR
  const chartH = H - padT - padB

  let maxVal = 1
  days.forEach(day => groups.forEach(g => { const v = dataByDay[day][g] || 0; if (v > maxVal) maxVal = v }))

  const xScale = i => padL + (days.length > 1 ? (i / (days.length - 1)) * chartW : chartW / 2)
  const yScale = v => padT + chartH - (v / maxVal) * chartH

  const yTicks = [0, 1, 2, 3, 4].map(i => {
    const v = Math.round((maxVal / 4) * i)
    return { v, y: yScale(v) }
  })

  if (groups.length === 0) {
    return (
      <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.875rem' }}>
        Nenhum dado nos últimos 14 dias
      </div>
    )
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={padL - 6} y={t.y} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="rgba(255,255,255,0.35)">{t.v}</text>
          </g>
        ))}
        {days.map((day, i) => {
          if (i % 2 !== 0 && i !== days.length - 1) return null
          return <text key={day} x={xScale(i)} y={H - padB + 16} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.35)">{day.slice(5)}</text>
        })}
        <line x1={padL} y1={padT + chartH} x2={W - padR} y2={padT + chartH} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        {groups.map((group, gi) => {
          const color = COLORS[gi % COLORS.length]
          const pts = days.map((day, i) => `${xScale(i)},${yScale(dataByDay[day][group] || 0)}`).join(' ')
          return (
            <g key={group}>
              <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
              {days.map((day, i) => {
                const v = dataByDay[day][group] || 0
                return v > 0 ? <circle key={day} cx={xScale(i)} cy={yScale(v)} r="3" fill={color} /> : null
              })}
            </g>
          )
        })}
      </svg>
      <div className="chart-legend">
        {groups.map((g, i) => (
          <span key={g} className="chart-legend-item">
            <span className="chart-legend-dot" style={{ background: COLORS[i % COLORS.length] }} />
            {g}
          </span>
        ))}
      </div>
    </div>
  )
}

function SummaryCards({ leads, selectedBU, onSelectBU }) {
  const summary = build14DaySummary(leads)
  return (
    <div className="summary-cards">
      {Object.entries(summary).map(([bu, data], i) => {
        const isSelected = selectedBU === bu
        const maxRange = Math.max(...RANGES.map(r => data.ranges[r] || 0), 1)
        return (
          <div key={bu} className={`summary-card ${isSelected ? 'selected' : ''}`} onClick={() => onSelectBU(isSelected ? null : bu)}>
            <div className="summary-card-header">
              <span className="summary-card-bu" style={{ color: COLORS[i % COLORS.length] }}>{bu}</span>
              <span className="summary-card-total">{data.totais}</span>
            </div>
            <div className="summary-card-meta">
              <span className="summary-card-reentrada">Reentrada: {data.reentrada}</span>
              <span className="summary-card-elegivel">Elegível: {data.totais - data.reentrada}</span>
            </div>
            <div className="summary-card-ranges">
              {RANGES.map(r => (
                <div key={r} className="range-bar-row">
                  <span className="range-bar-label">{r}</span>
                  <div className="range-bar-track">
                    <div className="range-bar-fill" style={{ width: `${((data.ranges[r] || 0) / maxRange) * 100}%`, background: COLORS[i % COLORS.length] }} />
                  </div>
                  <span className="range-bar-value">{data.ranges[r] || 0}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PieChartSVG({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const cx = 110, cy = 110, r = 90

  if (data.length === 1) {
    return (
      <svg width="220" height="220" viewBox="0 0 220 220">
        <circle cx={cx} cy={cy} r={r} fill={COLORS[0]} />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="14" fill="#fff" fontWeight="600">100%</text>
      </svg>
    )
  }

  let angle = -Math.PI / 2
  const slices = data.map((d, i) => {
    const sweep = (d.value / total) * 2 * Math.PI
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle)
    angle += sweep
    const x2 = cx + r * Math.cos(angle), y2 = cy + r * Math.sin(angle)
    const large = sweep > Math.PI ? 1 : 0
    const midAngle = angle - sweep / 2
    const lx = cx + (r * 0.65) * Math.cos(midAngle), ly = cy + (r * 0.65) * Math.sin(midAngle)
    const pct = Math.round((d.value / total) * 100)
    return { ...d, x1, y1, x2, y2, large, lx, ly, pct, color: COLORS[i % COLORS.length] }
  })
  return (
    <svg width="220" height="220" viewBox="0 0 220 220">
      {slices.map((s, i) => (
        <g key={i}>
          <path d={`M${cx},${cy} L${s.x1},${s.y1} A${r},${r} 0 ${s.large},1 ${s.x2},${s.y2} Z`} fill={s.color} stroke="var(--bg-card)" strokeWidth="2" />
          {s.pct >= 5 && <text x={s.lx} y={s.ly} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#fff" fontWeight="600">{s.pct}%</text>}
        </g>
      ))}
    </svg>
  )
}

function StatusModal({ title, leads, onClose }) {
  const statusMap = {}
  for (const lead of leads) {
    const s = lead.sf_status || 'Sem status'
    statusMap[s] = (statusMap[s] || 0) + 1
  }
  const data = Object.entries(statusMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Reentrada — {title}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="pie-wrapper"><PieChartSVG data={data} /></div>
          <table className="modal-table">
            <thead><tr><th>Status</th><th className="text-right">Qtd</th></tr></thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i}>
                  <td><span className="status-dot" style={{ background: COLORS[i % COLORS.length] }} />{row.name}</td>
                  <td className="text-right">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ExportButton() {
  const [open, setOpen] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(false)

  const handleExport = async () => {
    if (!dateFrom || !dateTo) return
    setLoading(true)
    const { data, error } = await supabase
      .from('leads_t1_raw')
      .select('*')
      .gte('created_at', `${dateFrom}T00:00:00`)
      .lte('created_at', `${dateTo}T23:59:59`)
      .order('created_at', { ascending: false })

    if (error || !data?.length) { setLoading(false); alert(error ? 'Erro ao buscar dados.' : 'Nenhum lead encontrado.'); return }

    const cols = ['id','created_at','bu','dt','pmp','email','telefone','renda','patrimonio','sf_exists','sf_lead_id','sf_status','sf_owner_name','n8n_execution_id']
    const rows = data.map(r => cols.map(c => {
      const v = r[c] ?? ''
      return typeof v === 'string' && v.includes(',') ? `"${v}"` : v
    }).join(','))
    const csv = [cols.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads_t1_${dateFrom}_${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setLoading(false)
    setOpen(false)
  }

  return (
    <div className="export-wrapper">
      <button className="export-btn" onClick={() => setOpen(o => !o)}>↓ Exportar</button>
      {open && (
        <div className="export-popover">
          <div className="export-row">
            <label>De</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div className="export-row">
            <label>Até</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <button className="export-download-btn" onClick={handleExport} disabled={loading || !dateFrom || !dateTo}>
            {loading ? 'Baixando...' : 'Baixar CSV'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedBUs, setExpandedBUs] = useState({})
  const [expandedDTs, setExpandedDTs] = useState({})
  const [modal, setModal] = useState(null)
  const [chartGroupBy, setChartGroupBy] = useState('bu')
  const [selectedBU, setSelectedBU] = useState(null)
  const [showTicker, setShowTicker] = useState(true)
  const [, setTick] = useState(0)
  const tickerTimerRef = useRef(null)

  const resetTickerTimer = () => {
    setShowTicker(true)
    if (tickerTimerRef.current) clearTimeout(tickerTimerRef.current)
    tickerTimerRef.current = setTimeout(() => setShowTicker(false), 60 * 1000)
  }

  useEffect(() => {
    supabase.from('leads_t1_raw')
      .select('bu, dt, pmp, patrimonio, sf_exists, sf_status, payload, created_at')
      .then(({ data, error }) => {
        if (error) console.error(error)
        else {
          setLeads(data || [])
          const hasWhale = (data || []).some(l => { const r = parsePatrimonioRange(l.patrimonio); return r === '1MM-5MM' || r === '5MM+' })
          if (hasWhale) resetTickerTimer()
        }
        setLoading(false)
      })
    const channel = supabase.channel('leads_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads_t1_raw' }, ({ new: row }) => {
        setLeads(prev => [...prev, row])
        const range = parsePatrimonioRange(row.patrimonio)
        if (range === '1MM-5MM' || range === '5MM+') resetTickerTimer()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads_t1_raw' }, ({ new: row }) => setLeads(prev => prev.map(l => l.id === row.id ? { ...l, ...row } : l)))
      .subscribe()
    const clockInterval = setInterval(() => setTick(t => t + 1), 60000)
    return () => { supabase.removeChannel(channel); if (tickerTimerRef.current) clearTimeout(tickerTimerRef.current); clearInterval(clockInterval) }
  }, [])

  const hierarchy = buildHierarchy(leads)
  const toggleBU = bu => setExpandedBUs(p => ({ ...p, [bu]: !p[bu] }))
  const toggleDT = key => setExpandedDTs(p => ({ ...p, [key]: !p[key] }))

  const openModal = (e, title, filterFn) => {
    e.stopPropagation()
    const reentradas = leads.filter(l => l.sf_exists === true && filterFn(l))
    if (reentradas.length === 0) return
    setModal({ title, leads: reentradas })
  }

  const whaleLeads = leads.filter(l => { const r = parsePatrimonioRange(l.patrimonio); return r === '1MM-5MM' || r === '5MM+' }).slice(-10)

  const colSpan = 4 + RANGES.length

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-title-row">
          <h1>Dashboard Leads T1</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <ExportButton />
            <span className="live-indicator"><span className="pulse"></span> AO VIVO</span>
          </div>
        </div>
        <p>Visão em tempo real — BU → Canal → PMP</p>
      </header>

      <main>
        {loading ? <p style={{ padding: '2rem' }}>Carregando dados...</p> : (
          <>
            {/* Gráfico 14 dias */}
            <div className="chart-section">
              <div className="chart-toolbar">
                <span className="chart-title">Leads nos últimos 14 dias</span>
                <div className="chart-toggle">
                  <button className={chartGroupBy === 'bu' ? 'active' : ''} onClick={() => { setChartGroupBy('bu'); setSelectedBU(null) }}>Por BU</button>
                  <button className={chartGroupBy === 'dt' ? 'active' : ''} onClick={() => setChartGroupBy('dt')}>Por Canal</button>
                </div>
              </div>
              <LineChart leads={leads} groupBy={chartGroupBy} selectedBU={selectedBU} />
            </div>

            {/* Cards de resumo */}
            <SummaryCards leads={leads} selectedBU={selectedBU} onSelectBU={bu => { setSelectedBU(bu); setChartGroupBy(bu ? 'dt' : 'bu') }} />

            {/* Tabela hierárquica */}
            <div className="bu-blocks">
              {Object.keys(hierarchy).length === 0 && <p>Nenhum dado encontrado.</p>}
              {Object.entries(hierarchy).map(([bu, buData]) => (
                <div key={bu} className="bu-block">
                  <table className="summary-table">
                    <thead>
                      <tr>
                        <th colSpan={colSpan} className="bu-header" onClick={() => toggleBU(bu)}>
                          {expandedBUs[bu] ? '▾' : '▸'} {bu}
                          <span className="bu-total">{buData.totais} leads</span>
                        </th>
                      </tr>
                      <tr>
                        <th>Canal / PMP</th>
                        <th className="text-right">Totais</th>
                        <th className="text-right">Reentrada</th>
                        <th className="text-right">Elegível</th>
                        {RANGES.map(r => <th key={r} className="text-right">{r}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="row-bu-summary">
                        <td><em>Total</em></td>
                        <td className="text-right"><AnimatedCell value={buData.totais} /></td>
                        <td className="text-right reentrada clickable" onClick={e => openModal(e, bu, l => normalizeBU(l.bu) === bu)}>
                          <AnimatedCell value={-buData.reentrada} />
                        </td>
                        <td className="text-right"><AnimatedCell value={buData.totais - buData.reentrada} /></td>
                        {RANGES.map(r => <td key={r} className="text-right"><AnimatedCell value={buData.ranges[r] ?? 0} /></td>)}
                      </tr>
                      {expandedBUs[bu] && Object.entries(buData.dts).map(([dt, dtData]) => {
                        const dtKey = `${bu}|${dt}`
                        return (
                          <React.Fragment key={dtKey}>
                            <tr className="row-dt" onClick={() => toggleDT(dtKey)}>
                              <td className="indent-1">{expandedDTs[dtKey] ? '▾' : '▸'} {dt}</td>
                              <td className="text-right"><AnimatedCell value={dtData.totais} /></td>
                              <td className="text-right reentrada clickable" onClick={e => openModal(e, `${bu} / ${dt}`, l => normalizeBU(l.bu) === bu && (l.dt || '').replace(/\+/g, ' ') === dt)}>
                                <AnimatedCell value={-dtData.reentrada} />
                              </td>
                              <td className="text-right"><AnimatedCell value={dtData.totais - dtData.reentrada} /></td>
                              {RANGES.map(r => <td key={r} className="text-right"><AnimatedCell value={dtData.ranges[r] ?? 0} /></td>)}
                            </tr>
                            {expandedDTs[dtKey] && Object.entries(dtData.pmps).map(([pmp, pmpData]) => (
                              <tr key={`${dtKey}|${pmp}`} className="row-pmp">
                                <td className="indent-2">{pmp}</td>
                                <td className="text-right"><AnimatedCell value={pmpData.totais} /></td>
                                <td className="text-right reentrada clickable" onClick={e => openModal(e, `${bu} / ${dt} / ${pmp}`, l => normalizeBU(l.bu) === bu && (l.dt || '').replace(/\+/g, ' ') === dt && (l.pmp || '').replace(/\+/g, ' ') === pmp)}>
                                  <AnimatedCell value={-pmpData.reentrada} />
                                </td>
                                <td className="text-right"><AnimatedCell value={pmpData.totais - pmpData.reentrada} /></td>
                                {RANGES.map(r => <td key={r} className="text-right"><AnimatedCell value={pmpData.ranges[r] ?? 0} /></td>)}
                              </tr>
                            ))}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {modal && <StatusModal title={modal.title} leads={modal.leads} onClose={() => setModal(null)} />}

      {showTicker && whaleLeads.length > 0 && (
        <div className="news-ticker-wrapper">
          <div className="news-ticker-label">BREAKING NEWS</div>
          <div className="news-ticker-content">
            {[...whaleLeads, ...whaleLeads].map((lead, idx) => {
              const diff = Math.floor((Date.now() - new Date(lead.created_at)) / 60000)
              const tempo = diff < 1 ? 'agora mesmo' : diff < 60 ? `${diff} min atrás` : `${Math.floor(diff / 60)}h atrás`
              return (
                <span key={idx} className="ticker-item">
                  🚨 Lead <strong>{lead.payload?.nome}</strong> com patrimônio <span>{lead.patrimonio}</span> via {normalizeBU(lead.bu)} / {(lead.dt||'').replace(/\+/g,' ')} — <em>{tempo}</em>
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
