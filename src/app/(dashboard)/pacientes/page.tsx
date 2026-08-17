'use client'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/use-toast'
import { Loader2, Search, Save, Users, Phone } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface PacienteRow {
  id: number
  nombre: string
  apellido: string | null
  telefono: string
  titular: boolean
  idioma_preferido: string
  total_citas: number
  ultima_visita: string | null
  proxima_cita: string | null
}
interface Cita {
  id: number
  start_time: string
  end_time: string
  estado: string
  motivo: string | null
  profesional: string | null
  servicio: string | null
}
interface Companero { id: number; nombre: string; apellido: string | null; titular: boolean }
interface Detalle { paciente: PacienteRow; historial: Cita[]; mismo_telefono: Companero[] }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtFecha(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtHora(iso: string) {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}
function nombreCompleto(p: { nombre: string; apellido: string | null }) {
  return [p.nombre, p.apellido].filter(Boolean).join(' ')
}
function estadoVariant(estado: string): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (estado === 'confirmada') return 'success'
  if (estado === 'cancelada' || estado === 'anulada') return 'destructive'
  if (estado === 'pendiente') return 'warning'
  return 'secondary'
}

export default function PacientesPage() {
  const [q, setQ] = useState('')
  const [pacientes, setPacientes] = useState<PacienteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [loadingDetalle, setLoadingDetalle] = useState(false)
  const [form, setForm] = useState({ nombre: '', apellido: '', idioma_preferido: 'es' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/pacientes?q=${encodeURIComponent(q)}`)
        if (res.ok) setPacientes(await res.json())
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  async function abrirDetalle(id: number) {
    setLoadingDetalle(true)
    try {
      const res = await fetch(`/api/pacientes/${id}`)
      if (!res.ok) {
        toast({ title: 'No se pudo cargar el paciente', variant: 'destructive' })
        return
      }
      const data: Detalle = await res.json()
      setDetalle(data)
      setForm({
        nombre: data.paciente.nombre ?? '',
        apellido: data.paciente.apellido ?? '',
        idioma_preferido: data.paciente.idioma_preferido || 'es',
      })
    } finally {
      setLoadingDetalle(false)
    }
  }

  async function guardar() {
    if (!detalle) return
    setSaving(true)
    try {
      const res = await fetch(`/api/pacientes/${detalle.paciente.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        toast({ title: 'Paciente actualizado' })
        abrirDetalle(detalle.paciente.id)
        const r = await fetch(`/api/pacientes?q=${encodeURIComponent(q)}`)
        if (r.ok) setPacientes(await r.json())
      } else {
        const err = await res.json().catch(() => null)
        toast({ title: err?.error || 'Error al guardar', variant: 'destructive' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Pacientes</h1>
        <p className="text-muted-foreground text-sm">Busca pacientes y consulta su historial de citas</p>
      </div>

      {/* ─── Buscador + lista ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Buscar por nombre, apellido o teléfono..."
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : pacientes.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No se han encontrado pacientes</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="font-medium pb-3 pr-4">Nombre</th>
                    <th className="font-medium pb-3 pr-4">Teléfono</th>
                    <th className="font-medium pb-3 pr-4">Tipo</th>
                    <th className="font-medium pb-3 pr-4">Idioma</th>
                    <th className="font-medium pb-3 pr-4 text-center">Citas</th>
                    <th className="font-medium pb-3 pr-4">Última visita</th>
                    <th className="font-medium pb-3">Próxima cita</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pacientes.map(p => (
                    <tr
                      key={p.id}
                      onClick={() => abrirDetalle(p.id)}
                      className={`cursor-pointer transition-colors hover:bg-muted/40 ${detalle?.paciente.id === p.id ? 'bg-primary/5' : ''}`}
                    >
                      <td className="py-2.5 pr-4 font-medium whitespace-nowrap">{nombreCompleto(p)}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{p.telefono}</td>
                      <td className="py-2.5 pr-4">
                        <Badge variant={p.titular ? 'default' : 'secondary'}>{p.titular ? 'Titular' : 'Tercero'}</Badge>
                      </td>
                      <td className="py-2.5 pr-4 uppercase text-muted-foreground">{p.idioma_preferido || '—'}</td>
                      <td className="py-2.5 pr-4 text-center">{p.total_citas}</td>
                      <td className="py-2.5 pr-4 whitespace-nowrap text-muted-foreground">{fmtFecha(p.ultima_visita)}</td>
                      <td className="py-2.5 whitespace-nowrap text-muted-foreground">{fmtFecha(p.proxima_cita)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Detalle ──────────────────────────────────────────────── */}
      {loadingDetalle && !detalle && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {detalle && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <CardTitle>{nombreCompleto(detalle.paciente)}</CardTitle>
                <CardDescription className="flex items-center gap-1.5 mt-1">
                  <Phone className="h-3.5 w-3.5" /> {detalle.paciente.telefono}
                </CardDescription>
              </div>
              <Badge variant={detalle.paciente.titular ? 'default' : 'secondary'}>
                {detalle.paciente.titular ? 'Titular' : 'Tercero'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Datos editables */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Apellido</Label>
                <Input value={form.apellido} onChange={e => setForm(f => ({ ...f, apellido: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Idioma preferido</Label>
                <select
                  value={form.idioma_preferido}
                  onChange={e => setForm(f => ({ ...f, idioma_preferido: e.target.value }))}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="es">Castellano</option>
                  <option value="ca">Catalán</option>
                </select>
              </div>
            </div>
            <Button size="sm" onClick={guardar} disabled={saving || !form.nombre.trim()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Guardar
            </Button>

            {/* Comparten teléfono */}
            {detalle.mismo_telefono.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Comparten este número:</p>
                <div className="flex flex-wrap gap-2">
                  {detalle.mismo_telefono.map(c => (
                    <button
                      key={c.id}
                      onClick={() => abrirDetalle(c.id)}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent transition-colors"
                    >
                      {nombreCompleto(c)}
                      <Badge variant={c.titular ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
                        {c.titular ? 'Titular' : 'Tercero'}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* Historial */}
            <div className="space-y-3">
              <p className="text-sm font-medium">Historial de citas</p>
              {detalle.historial.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin citas registradas.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="font-medium pb-2 pr-4">Fecha</th>
                        <th className="font-medium pb-2 pr-4">Hora</th>
                        <th className="font-medium pb-2 pr-4">Servicio</th>
                        <th className="font-medium pb-2 pr-4">Profesional</th>
                        <th className="font-medium pb-2 pr-4">Estado</th>
                        <th className="font-medium pb-2">Motivo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {detalle.historial.map(c => (
                        <tr key={c.id}>
                          <td className="py-2 pr-4 whitespace-nowrap">{fmtFecha(c.start_time)}</td>
                          <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                            {fmtHora(c.start_time)} – {fmtHora(c.end_time)}
                          </td>
                          <td className="py-2 pr-4">{c.servicio || '—'}</td>
                          <td className="py-2 pr-4">{c.profesional || '—'}</td>
                          <td className="py-2 pr-4">
                            <Badge variant={estadoVariant(c.estado)}>{c.estado}</Badge>
                          </td>
                          <td className="py-2 text-muted-foreground max-w-[220px] truncate" title={c.motivo || ''}>
                            {c.motivo || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
