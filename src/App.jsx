import React, { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import './App.css'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const RANGES = ['100k-300k', '300k-500k', '500k-1MM', '1MM-5MM', '5MM+']

function parsePatrimonioRange(text) {
  if (!text) return null
  const nums = []
  const matches = text.match(/[\d.]+/g)
  if (matches) {
    matches.forEach(m => {
      const n = parseFloat(m.replace(/\./g, ''))
      if (!isNaN(n)) nums.push(n)
    })
  }
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

function buildHierarchy(leads) {
  const buMap = {}
  for (const lead of leads) {
    const bu = (lead.bu || 'Sem BU').replace(/\+/g, ' ')
    const dt = (lead.dt || 'Sem Canal').replace(/\+/g, ' ')
    const pmp = (lead.pmp || 'Sem PMP').replace(/\+/g, ' ')
    const isReentrada = lead.sf_exists === true
    const range = parsePatrimonioRange(lead.patrimonio)

    if (!buMap[bu]) buMap[bu] = { totais: 0, reentrada: 0, ranges: {}, dts: {} }
    if (!buMap[bu].dts[dt]) buMap[bu].dts[dt] = { totais: 0, reentrada: 0, ranges: {}, pmps: {} }
    if (!buMap[bu].dts[dt].pmps[pmp]) buMap[bu].dts[dt].pmps[pmp] = { totais: 0, reentrada: 0, ranges: {} }

    buMap[bu].totais++
    buMap[bu].dts[dt].totais++
    buMap[bu].dts[dt].pmps[pmp].totais++

    if (isReentrada) {
      buMap[bu].reentrada++
      buMap[bu].dts[dt].reentrada++
      buMap[bu].dts[dt].pmps[pmp].reentrada++
    }
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
    } else {
      prevRef.current = value
    }
  }, [value])

  return <span className={`animated-cell ${flashClass}`}>{value ?? 0}</span>
}

export default function App() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedBUs, setExpandedBUs] = useState({})
  const [expandedDTs, setExpandedDTs] = useState({})

  useEffect(() => {
    supabase
      .from('leads_t1_raw')
      .select('bu, dt, pmp, patrimonio, sf_exists, payload, created_at')
      .then(({ data, error }) => {
        if (error) console.error(error)
        else setLeads(data || [])
        setLoading(false)
      })

    const channel = supabase
      .channel('leads_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads_t1_raw' }, ({ new: row }) => {
        setLeads(prev => [...prev, row])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads_t1_raw' }, ({ new: row }) => {
        setLeads(prev => prev.map(l => l.id === row.id ? { ...l, ...row } : l))
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  const hierarchy = buildHierarchy(leads)
  const toggleBU = bu => setExpandedBUs(p => ({ ...p, [bu]: !p[bu] }))
  const toggleDT = key => setExpandedDTs(p => ({ ...p, [key]: !p[key] }))

  const whaleLeads = leads
    .filter(l => { const r = parsePatrimonioRange(l.patrimonio); return r === '1MM-5MM' || r === '5MM+' })
    .slice(-10)

  const colSpan = 4 + RANGES.length

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-title-row">
          <h1>Dashboard Leads T1</h1>
          <span className="live-indicator"><span className="pulse"></span> AO VIVO</span>
        </div>
        <p>Visão em tempo real — BU → Canal → PMP</p>
      </header>

      <main className="dashboard-content">
        {loading ? <p>Carregando dados...</p> : (
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
                      <td className="text-right reentrada"><AnimatedCell value={-buData.reentrada} /></td>
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
                            <td className="text-right reentrada"><AnimatedCell value={-dtData.reentrada} /></td>
                            <td className="text-right"><AnimatedCell value={dtData.totais - dtData.reentrada} /></td>
                            {RANGES.map(r => <td key={r} className="text-right"><AnimatedCell value={dtData.ranges[r] ?? 0} /></td>)}
                          </tr>

                          {expandedDTs[dtKey] && Object.entries(dtData.pmps).map(([pmp, pmpData]) => (
                            <tr key={`${dtKey}|${pmp}`} className="row-pmp">
                              <td className="indent-2">{pmp}</td>
                              <td className="text-right"><AnimatedCell value={pmpData.totais} /></td>
                              <td className="text-right reentrada"><AnimatedCell value={-pmpData.reentrada} /></td>
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
        )}
      </main>

      {whaleLeads.length > 0 && (
        <div className="news-ticker-wrapper">
          <div className="news-ticker-label">BREAKING NEWS</div>
          <div className="news-ticker-content">
            {[...whaleLeads, ...whaleLeads].map((lead, idx) => (
              <span key={idx} className="ticker-item">
                🚨 Lead <strong>{lead.payload?.nome}</strong> com patrimônio <span>{lead.patrimonio}</span> via {lead.bu} / {lead.dt}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
