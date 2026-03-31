'use client'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/use-toast'
import { Loader2, Plus, Trash2, Save, Check, X, Clock, Pencil } from 'lucide-react'
import { DAYS } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────
interface HourRule {
  id?: number; start_time: string; end_time: string
  lunch_start: string; lunch_end: string; days: string
}
interface Service { id: number; name: string; code: string; slots_required: number; active: boolean }
interface Professional { id: number; name: string; calendar_id: string; active: boolean; is_blocker: boolean }
interface General { slot_minutes: string; day_start_time: string; day_end_time: string; timezone: string; telefono: string }

const SLOT_PRESETS = [
  { label: 'Cada 10 min', value: '00,10,20,30,40,50' },
  { label: 'Cada 15 min', value: '00,15,30,45' },
  { label: 'Cada 30 min', value: '00,30' },
]

function fmtTime(t: string | null) {
  return t?.slice(0, 5) ?? ''
}

function parseDays(days: string): number[] {
  return days.split(',').filter(Boolean).map(Number)
}

export default function ConfiguracionPage() {
  const [rules, setRules] = useState<HourRule[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [cruces, setCruces] = useState<{ service_id: number; professional_id: number }[]>([])
  const [general, setGeneral] = useState<General | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const [newService, setNewService] = useState({ name: '', code: '', slots_required: 1 })
  const [newPro, setNewPro] = useState({ name: '', calendar_id: '', is_blocker: false })
  const [editingService, setEditingService] = useState<Service | null>(null)
  const [editingRule, setEditingRule] = useState<HourRule | null>(null)
  const [showNewRule, setShowNewRule] = useState(false)
  const [newRule, setNewRule] = useState<HourRule>({ start_time: '09:00', end_time: '20:00', lunch_start: '', lunch_end: '', days: '1,2,3,4,5' })

  async function loadAll() {
    const [h, s, p, c, g] = await Promise.all([
      fetch('/api/config/horarios').then(r => r.json()),
      fetch('/api/config/servicios').then(r => r.json()),
      fetch('/api/config/profesionales').then(r => r.json()),
      fetch('/api/config/cruces').then(r => r.json()),
      fetch('/api/config/general').then(r => r.json()),
    ])
    setRules(h.map((x: HourRule) => ({ ...x, start_time: fmtTime(x.start_time), end_time: fmtTime(x.end_time), lunch_start: fmtTime(x.lunch_start), lunch_end: fmtTime(x.lunch_end) })))
    setServices(s)
    setProfessionals(p)
    setCruces(c)
    setGeneral(g)
  }

  useEffect(() => { loadAll() }, [])

  async function saveGeneral() {
    setSaving('general')
    try {
      const res = await fetch('/api/config/general', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(general) })
      if (res.ok) toast({ title: 'Guardado' })
      else toast({ title: 'Error', variant: 'destructive' })
    } finally { setSaving(null) }
  }

  async function saveRule(rule: HourRule) {
    const method = rule.id ? 'PUT' : 'POST'
    await fetch('/api/config/horarios', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rule) })
    toast({ title: rule.id ? 'Regla actualizada' : 'Regla creada' })
    setEditingRule(null)
    setShowNewRule(false)
    setNewRule({ start_time: '09:00', end_time: '20:00', lunch_start: '', lunch_end: '', days: '1,2,3,4,5' })
    loadAll()
  }

  async function deleteRule(id: number) {
    await fetch('/api/config/horarios', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    toast({ title: 'Regla eliminada' })
    loadAll()
  }

  // Cruces
  function hasCruce(sid: number, pid: number) {
    return cruces.some(c => c.service_id === sid && c.professional_id === pid)
  }
  async function toggleCruce(sid: number, pid: number) {
    const has = hasCruce(sid, pid)
    await fetch('/api/config/cruces', { method: has ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_id: sid, professional_id: pid }) })
    loadAll()
  }

  const realPros = professionals.filter(p => !p.is_blocker)

  if (!general) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )

  // ─── Rule editor component ─────────────────────────────────────────────────
  function RuleEditor({ rule, onSave, onCancel }: { rule: HourRule; onSave: (r: HourRule) => void; onCancel: () => void }) {
    const [r, setR] = useState(rule)
    const selectedDays = parseDays(r.days)

    function toggleDay(day: number) {
      const has = selectedDays.includes(day)
      const next = has ? selectedDays.filter(d => d !== day) : [...selectedDays, day]
      setR(prev => ({ ...prev, days: next.join(',') }))
    }

    return (
      <div className="rounded-xl border bg-muted/20 p-4 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Apertura</Label>
            <Input type="time" value={r.start_time} onChange={e => setR(p => ({ ...p, start_time: e.target.value }))} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Cierre</Label>
            <Input type="time" value={r.end_time} onChange={e => setR(p => ({ ...p, end_time: e.target.value }))} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Cierre mediodía</Label>
            <Input type="time" value={r.lunch_start} onChange={e => setR(p => ({ ...p, lunch_start: e.target.value }))} className="h-9" placeholder="--:--" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Reapertura</Label>
            <Input type="time" value={r.lunch_end} onChange={e => setR(p => ({ ...p, lunch_end: e.target.value }))} className="h-9" placeholder="--:--" />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Aplica a</Label>
          <div className="flex gap-1.5">
            {DAYS.map(day => {
              const active = selectedDays.includes(day.value)
              return (
                <button key={day.value} onClick={() => toggleDay(day.value)}
                  className={`h-9 w-9 rounded-full text-xs font-semibold transition-all ${
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'border border-input text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {day.short}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={() => onSave(r)} disabled={!r.days || !r.start_time || !r.end_time}>
            <Check className="h-3.5 w-3.5" /> Guardar
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <X className="h-3.5 w-3.5" /> Cancelar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Configuración</h1>
        <p className="text-muted-foreground text-sm">Gestiona los ajustes de la clínica</p>
      </div>

      {/* ─── General ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Ajustes generales</CardTitle>
          <CardDescription>Configuración base del sistema de citas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Teléfono clínica</Label>
              <Input value={general.telefono || ''} onChange={e => setGeneral(p => p ? { ...p, telefono: e.target.value } : p)} placeholder="+34 600 000 000" />
            </div>
            <div className="space-y-2">
              <Label>Zona horaria</Label>
              <Input value={general.timezone || ''} onChange={e => setGeneral(p => p ? { ...p, timezone: e.target.value } : p)} placeholder="Europe/Madrid" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Duración de los slots</Label>
            <div className="flex gap-2">
              {SLOT_PRESETS.map(opt => (
                <button key={opt.value} onClick={() => setGeneral(p => p ? { ...p, slot_minutes: opt.value } : p)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                    general.slot_minutes === opt.value
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'border-input hover:bg-accent'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Los servicios duran múltiplos de este slot.</p>
          </div>

          <Button onClick={saveGeneral} disabled={saving === 'general'} size="sm">
            {saving === 'general' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Guardar ajustes
          </Button>
        </CardContent>
      </Card>

      {/* ─── Horarios (reglas) ────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Horario de la clínica</CardTitle>
              <CardDescription>Define reglas de horario y asígnalas a los días que correspondan</CardDescription>
            </div>
            {!showNewRule && (
              <Button size="sm" variant="outline" onClick={() => setShowNewRule(true)}>
                <Plus className="h-3.5 w-3.5" /> Nueva regla
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {showNewRule && (
            <RuleEditor rule={newRule} onSave={r => saveRule(r)} onCancel={() => setShowNewRule(false)} />
          )}

          {rules.length === 0 && !showNewRule && (
            <p className="text-sm text-muted-foreground text-center py-6">No hay reglas de horario. Crea una para empezar.</p>
          )}

          {rules.map(rule => (
            <div key={rule.id}>
              {editingRule?.id === rule.id ? (
                <RuleEditor rule={editingRule!} onSave={r => saveRule(r)} onCancel={() => setEditingRule(null)} />
              ) : (
                <div className="rounded-xl border p-4 flex items-center gap-4 group hover:bg-muted/30 transition-colors">
                  <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                    <Clock className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold">{fmtTime(rule.start_time)} – {fmtTime(rule.end_time)}</span>
                      {rule.lunch_start && rule.lunch_end && (
                        <span className="text-muted-foreground text-xs">
                          (cierre mediodía {fmtTime(rule.lunch_start)} – {fmtTime(rule.lunch_end)})
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {DAYS.map(day => {
                        const active = parseDays(rule.days).includes(day.value)
                        return (
                          <span key={day.value}
                            className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-semibold ${
                              active ? 'bg-primary/15 text-primary' : 'text-muted-foreground/30'
                            }`}
                          >
                            {day.short}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingRule(rule)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => deleteRule(rule.id!)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ─── Servicios ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Servicios</CardTitle>
          <CardDescription>Los tipos de tratamiento que ofrece la clínica</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {services.filter(s => s.code !== 'DEFAULT').map(s => (
              <div key={s.id}>
                {editingService?.id === s.id ? (
                  <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
                    <div className="flex gap-2 flex-wrap">
                      <Input value={editingService.name} onChange={e => setEditingService(p => p ? { ...p, name: e.target.value } : p)} className="flex-1 min-w-[140px]" />
                      <Input value={editingService.code} onChange={e => setEditingService(p => p ? { ...p, code: e.target.value } : p)} className="w-28" />
                      <div className="flex items-center gap-2">
                        <Input type="number" min={1} max={12} value={editingService.slots_required} onChange={e => setEditingService(p => p ? { ...p, slots_required: parseInt(e.target.value) || 1 } : p)} className="w-20" />
                        <span className="text-xs text-muted-foreground">slots</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={async () => {
                        await fetch('/api/config/servicios', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editingService) })
                        setEditingService(null); loadAll()
                        toast({ title: 'Servicio actualizado' })
                      }}><Check className="h-3.5 w-3.5" /> Guardar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingService(null)}><X className="h-3.5 w-3.5" /> Cancelar</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 rounded-lg border group">
                    <Switch checked={s.active} onCheckedChange={async v => {
                      await fetch('/api/config/servicios', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...s, active: v }) })
                      loadAll()
                    }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{s.name}</span>
                        <Badge variant="outline" className="text-xs">{s.code}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{s.slots_required} slot{s.slots_required > 1 ? 's' : ''}</p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingService({ ...s })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={async () => {
                        await fetch('/api/config/servicios', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id }) })
                        loadAll()
                      }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <Separator />
          <div className="space-y-2">
            <p className="text-sm font-medium">Añadir servicio</p>
            <div className="flex gap-2 flex-wrap">
              <Input placeholder="Nombre" value={newService.name} onChange={e => setNewService(p => ({ ...p, name: e.target.value }))} className="flex-1 min-w-[140px]" />
              <Input placeholder="Código" value={newService.code} onChange={e => setNewService(p => ({ ...p, code: e.target.value }))} className="w-28" />
              <div className="flex items-center gap-2">
                <Input type="number" min={1} max={12} value={newService.slots_required} onChange={e => setNewService(p => ({ ...p, slots_required: parseInt(e.target.value) || 1 }))} className="w-20" />
                <span className="text-xs text-muted-foreground whitespace-nowrap">slots</span>
              </div>
              <Button size="sm" onClick={async () => {
                if (!newService.name || !newService.code) return
                await fetch('/api/config/servicios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newService) })
                setNewService({ name: '', code: '', slots_required: 1 })
                loadAll()
              }}>
                <Plus className="h-3.5 w-3.5" /> Añadir
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Profesionales ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Profesionales</CardTitle>
          <CardDescription>Fisioterapeutas y calendarios de bloqueo</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {professionals.map(p => (
              <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border">
                <Switch checked={p.active} onCheckedChange={async v => {
                  await fetch('/api/config/profesionales', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, active: v }) })
                  loadAll()
                }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{p.name}</span>
                    {p.is_blocker && <Badge variant="warning">Bloqueador</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{p.calendar_id}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={async () => {
                  await fetch('/api/config/profesionales', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) })
                  loadAll()
                }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <Separator />
          <div className="space-y-2">
            <p className="text-sm font-medium">Añadir profesional / calendario</p>
            <div className="flex gap-2 flex-wrap">
              <Input placeholder="Nombre" value={newPro.name} onChange={e => setNewPro(p => ({ ...p, name: e.target.value }))} className="flex-1 min-w-[140px]" />
              <Input placeholder="ID de Google Calendar" value={newPro.calendar_id} onChange={e => setNewPro(p => ({ ...p, calendar_id: e.target.value }))} className="flex-1 min-w-[200px]" />
              <div className="flex items-center gap-2">
                <Switch checked={newPro.is_blocker} onCheckedChange={v => setNewPro(p => ({ ...p, is_blocker: v }))} />
                <span className="text-sm">Bloqueador</span>
              </div>
              <Button size="sm" onClick={async () => {
                if (!newPro.name || !newPro.calendar_id) return
                await fetch('/api/config/profesionales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newPro) })
                setNewPro({ name: '', calendar_id: '', is_blocker: false })
                loadAll()
              }}>
                <Plus className="h-3.5 w-3.5" /> Añadir
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Cruces ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Servicios por profesional</CardTitle>
          <CardDescription>Indica qué servicios puede realizar cada profesional</CardDescription>
        </CardHeader>
        <CardContent>
          {realPros.length === 0 || services.filter(s => s.code !== 'DEFAULT').length === 0 ? (
            <p className="text-sm text-muted-foreground">Añade profesionales y servicios primero.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left font-medium text-muted-foreground pb-3 pr-4">Servicio</th>
                    {realPros.map(p => (
                      <th key={p.id} className="text-center font-medium text-muted-foreground pb-3 px-3 min-w-[100px]">{p.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {services.filter(s => s.code !== 'DEFAULT').map(s => (
                    <tr key={s.id}>
                      <td className="py-2.5 pr-4">
                        <span className="font-medium">{s.name}</span>
                      </td>
                      {realPros.map(p => {
                        const has = hasCruce(s.id, p.id)
                        return (
                          <td key={p.id} className="py-2.5 px-3 text-center">
                            <button onClick={() => toggleCruce(s.id, p.id)}
                              className={`h-8 w-8 rounded-full flex items-center justify-center mx-auto transition-colors ${has ? 'bg-primary text-primary-foreground hover:bg-primary/80' : 'border-2 border-dashed border-muted-foreground/30 hover:border-primary/50'}`}>
                              {has ? <Check className="h-4 w-4" /> : <X className="h-3.5 w-3.5 text-muted-foreground/40" />}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
