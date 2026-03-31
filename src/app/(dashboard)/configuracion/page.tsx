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
import { Loader2, Plus, Trash2, Save, Check, X } from 'lucide-react'
import { DAYS } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────
interface BusinessHour {
  day_of_week: number; is_open: boolean
  start_time: string; end_time: string
  lunch_start: string; lunch_end: string
}
interface Service { id: number; name: string; code: string; slots_required: number; active: boolean }
interface Professional { id: number; name: string; calendar_id: string; active: boolean; is_blocker: boolean }
interface General { slot_minutes: string; day_start_time: string; day_end_time: string; timezone: string; telefono: string }

// ─── Section Header ────────────────────────────────────────────────────────────
function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}

export default function ConfiguracionPage() {
  const [hours, setHours] = useState<BusinessHour[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [cruces, setCruces] = useState<{ service_id: number; professional_id: number }[]>([])
  const [general, setGeneral] = useState<General | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  // New item forms
  const [newService, setNewService] = useState({ name: '', code: '', slots_required: 1 })
  const [newPro, setNewPro] = useState({ name: '', calendar_id: '', is_blocker: false })

  async function loadAll() {
    const [h, s, p, c, g] = await Promise.all([
      fetch('/api/config/horarios').then(r => r.json()),
      fetch('/api/config/servicios').then(r => r.json()),
      fetch('/api/config/profesionales').then(r => r.json()),
      fetch('/api/config/cruces').then(r => r.json()),
      fetch('/api/config/general').then(r => r.json()),
    ])
    setHours(h.map((x: BusinessHour) => ({ ...x, lunch_start: x.lunch_start || '', lunch_end: x.lunch_end || '' })))
    setServices(s)
    setProfessionals(p)
    setCruces(c)
    setGeneral(g)
  }

  useEffect(() => { loadAll() }, [])

  async function save(section: string, fn: () => Promise<Response>) {
    setSaving(section)
    try {
      const res = await fn()
      if (res.ok) toast({ title: 'Guardado', description: 'Cambios guardados correctamente.' })
      else toast({ title: 'Error', variant: 'destructive', description: 'No se pudo guardar.' })
    } finally {
      setSaving(null)
      loadAll()
    }
  }

  // ─── Hours helpers ─────────────────────────────────────────────────────────
  function updateHour(day: number, field: keyof BusinessHour, value: unknown) {
    setHours(prev => prev.map(h => h.day_of_week === day ? { ...h, [field]: value } : h))
  }

  // ─── Cruces helpers ────────────────────────────────────────────────────────
  function hasCruce(sid: number, pid: number) {
    return cruces.some(c => c.service_id === sid && c.professional_id === pid)
  }
  async function toggleCruce(sid: number, pid: number) {
    const has = hasCruce(sid, pid)
    await fetch('/api/config/cruces', {
      method: has ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: sid, professional_id: pid }),
    })
    loadAll()
  }

  const realPros = professionals.filter(p => !p.is_blocker)
  const slotOptions = ['00,15', '00,30', '00,45', '00', '30']

  if (!general) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Configuración</h1>
        <p className="text-muted-foreground text-sm">Gestiona los ajustes de la clínica</p>
      </div>

      {/* ─── General ─────────────────────────────────────────────────── */}
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
            <div className="space-y-2">
              <Label>Slots del día (minutos de inicio)</Label>
              <div className="flex gap-2 flex-wrap">
                {slotOptions.map(opt => (
                  <button key={opt} onClick={() => setGeneral(p => p ? { ...p, slot_minutes: opt } : p)}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${general.slot_minutes === opt ? 'bg-primary text-primary-foreground border-primary' : 'border-input hover:bg-accent'}`}>
                    :{opt === '00' ? '00' : opt === '30' ? '30' : opt.replace(',', ' y :')}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Los slots se ofrecen en las horas indicadas. "00,30" = cada media hora.</p>
            </div>
          </div>
          <Button onClick={() => save('general', () => fetch('/api/config/general', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(general) }))} disabled={saving === 'general'} size="sm">
            {saving === 'general' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Guardar ajustes
          </Button>
        </CardContent>
      </Card>

      {/* ─── Horarios ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Horario por días</CardTitle>
          <CardDescription>Define cuándo está abierta la clínica cada día de la semana</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {DAYS.map(day => {
            const h = hours.find(x => x.day_of_week === day.value)
            if (!h) return null
            return (
              <div key={day.value} className={`rounded-lg border p-3 transition-colors ${h.is_open ? 'border-border' : 'border-border/50 opacity-60'}`}>
                <div className="flex items-center gap-3 flex-wrap">
                  <Switch checked={h.is_open} onCheckedChange={v => updateHour(day.value, 'is_open', v)} />
                  <span className="font-medium text-sm w-24">{day.label}</span>
                  {h.is_open && (
                    <>
                      <div className="flex items-center gap-2">
                        <Input type="time" value={h.start_time || ''} onChange={e => updateHour(day.value, 'start_time', e.target.value)} className="w-32 h-8 text-sm" />
                        <span className="text-muted-foreground text-xs">–</span>
                        <Input type="time" value={h.end_time || ''} onChange={e => updateHour(day.value, 'end_time', e.target.value)} className="w-32 h-8 text-sm" />
                      </div>
                      <Separator orientation="vertical" className="h-6 hidden sm:block" />
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Mediodía:</span>
                        <Input type="time" value={h.lunch_start || ''} onChange={e => updateHour(day.value, 'lunch_start', e.target.value)} className="w-32 h-8 text-sm" placeholder="--:--" />
                        <span className="text-muted-foreground text-xs">–</span>
                        <Input type="time" value={h.lunch_end || ''} onChange={e => updateHour(day.value, 'lunch_end', e.target.value)} className="w-32 h-8 text-sm" placeholder="--:--" />
                      </div>
                    </>
                  )}
                  {!h.is_open && <span className="text-xs text-muted-foreground">Cerrado</span>}
                </div>
              </div>
            )
          })}
          <Button onClick={() => save('horarios', () => fetch('/api/config/horarios', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(hours) }))} disabled={saving === 'horarios'} size="sm" className="mt-2">
            {saving === 'horarios' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Guardar horarios
          </Button>
        </CardContent>
      </Card>

      {/* ─── Servicios ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Servicios</CardTitle>
          <CardDescription>Los tipos de tratamiento que ofrece la clínica</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {services.filter(s => s.code !== 'DEFAULT').map(s => (
              <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg border">
                <Switch checked={s.active} onCheckedChange={async v => {
                  await fetch('/api/config/servicios', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...s, active: v }) })
                  loadAll()
                }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{s.name}</span>
                    <Badge variant="outline" className="text-xs">{s.code}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{s.slots_required} slot{s.slots_required > 1 ? 's' : ''} = {s.slots_required * 30} min</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={async () => {
                  await fetch('/api/config/servicios', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id }) })
                  loadAll()
                }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <Separator />
          <div className="space-y-2">
            <p className="text-sm font-medium">Añadir servicio</p>
            <div className="flex gap-2 flex-wrap">
              <Input placeholder="Nombre" value={newService.name} onChange={e => setNewService(p => ({ ...p, name: e.target.value }))} className="flex-1 min-w-[140px]" />
              <Input placeholder="Código (ej: FISIO)" value={newService.code} onChange={e => setNewService(p => ({ ...p, code: e.target.value }))} className="w-28" />
              <div className="flex items-center gap-2">
                <Input type="number" min={1} max={12} value={newService.slots_required} onChange={e => setNewService(p => ({ ...p, slots_required: parseInt(e.target.value) || 1 }))} className="w-20" />
                <span className="text-xs text-muted-foreground whitespace-nowrap">slots (×30 min)</span>
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

      {/* ─── Profesionales ─────────────────────────────────────────────── */}
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
                <span className="text-sm">Es bloqueador</span>
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

      {/* ─── Cruces ─────────────────────────────────────────────────────── */}
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
