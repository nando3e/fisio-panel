'use client'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/use-toast'
import { Loader2, Search, Save, Users, Phone, Plus, Pencil, Trash2, X } from 'lucide-react'

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
  const [form, setForm] = useState({ nombre: '', apellido: '', telefono: '', titular: true, idioma_preferido: 'es' })
  const [saving, setSaving] = useState(false)

  // Alta y borrado
  const [showNuevo, setShowNuevo] = useState(false)
  const [nuevo, setNuevo] = useState({ nombre: '', apellido: '', telefono: '', titular: true, idioma_preferido: 'es' })
  const [creando, setCreando] = useState(false)
  const [confirmarBorrar, setConfirmarBorrar] = useState<{ id: number; nombre: string } | null>(null)
  const [borrando, setBorrando] = useState(false)

  async function recargarLista() {
    const res = await fetch(`/api/pacientes?q=${encodeURIComponent(q)}`)
    if (res.ok) setPacientes(await res.json())
  }

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        await recargarLista()
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  async function crearPaciente() {
    setCreando(true)
    try {
      const res = await fetch('/api/pacientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...nuevo, apellido: nuevo.apellido || null }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok) {
        toast({ title: 'Paciente creado' })
        setShowNuevo(false)
        setNuevo({ nombre: '', apellido: '', telefono: '', titular: true, idioma_preferido: 'es' })
        await recargarLista()
        if (data?.id) abrirDetalle(data.id)
      } else {
        toast({ title: data?.error || 'Error al crear', variant: 'destructive' })
      }
    } finally {
      setCreando(false)
    }
  }

  async function eliminarPaciente(id: number) {
    setBorrando(true)
    try {
      const res = await fetch(`/api/pacientes/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => null)
      if (res.ok) {
        toast({ title: 'Paciente eliminado' })
        if (detalle?.paciente.id === id) setDetalle(null)
        await recargarLista()
      } else {
        toast({ title: data?.error || 'No se pudo eliminar', variant: 'destructive' })
      }
    } finally {
      setBorrando(false)
      setConfirmarBorrar(null)
    }
  }

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
        telefono: data.paciente.telefono ?? '',
        titular: data.paciente.titular,
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
        await recargarLista()
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
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Pacientes</h1>
          <p className="text-muted-foreground text-sm">Busca, crea y edita pacientes; consulta su historial de citas</p>
        </div>
        {!showNuevo && (
          <Button size="sm" onClick={() => setShowNuevo(true)}>
            <Plus className="h-3.5 w-3.5" /> Nuevo paciente
          </Button>
        )}
      </div>

      {/* ─── Alta ─────────────────────────────────────────────────── */}
      {showNuevo && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Nuevo paciente</p>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowNuevo(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Nombre</Label>
                <Input value={nuevo.nombre} onChange={e => setNuevo(p => ({ ...p, nombre: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Apellido</Label>
                <Input value={nuevo.apellido} onChange={e => setNuevo(p => ({ ...p, apellido: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Teléfono</Label>
                <Input value={nuevo.telefono} onChange={e => setNuevo(p => ({ ...p, telefono: e.target.value }))} className="h-9" placeholder="612345678" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Tipo</Label>
                <select
                  value={nuevo.titular ? 'titular' : 'tercero'}
                  onChange={e => setNuevo(p => ({ ...p, titular: e.target.value === 'titular' }))}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="titular">Titular del número</option>
                  <option value="tercero">Tercero (comparte número)</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Idioma</Label>
                <select
                  value={nuevo.idioma_preferido}
                  onChange={e => setNuevo(p => ({ ...p, idioma_preferido: e.target.value }))}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="es">Castellano</option>
                  <option value="ca">Catalán</option>
                </select>
              </div>
            </div>
            <Button size="sm" onClick={crearPaciente} disabled={creando || !nuevo.nombre.trim() || !nuevo.telefono.trim()}>
              {creando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Crear paciente
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── Confirmación de borrado ──────────────────────────────── */}
      {confirmarBorrar && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm">
            ¿Eliminar la ficha de <span className="font-semibold">{confirmarBorrar.nombre}</span>? Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-2 shrink-0">
            <Button variant="destructive" size="sm" onClick={() => eliminarPaciente(confirmarBorrar.id)} disabled={borrando}>
              {borrando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Eliminar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmarBorrar(null)}>Cancelar</Button>
          </div>
        </div>
      )}

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
                    <th className="font-medium pb-3 pr-4">Próxima cita</th>
                    <th className="pb-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pacientes.map(p => (
                    <tr
                      key={p.id}
                      onClick={() => abrirDetalle(p.id)}
                      className={`group cursor-pointer transition-colors hover:bg-muted/40 ${detalle?.paciente.id === p.id ? 'bg-primary/5' : ''}`}
                    >
                      <td className="py-2.5 pr-4 font-medium whitespace-nowrap">{nombreCompleto(p)}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{p.telefono}</td>
                      <td className="py-2.5 pr-4">
                        <Badge variant={p.titular ? 'default' : 'secondary'}>{p.titular ? 'Titular' : 'Tercero'}</Badge>
                      </td>
                      <td className="py-2.5 pr-4 uppercase text-muted-foreground">{p.idioma_preferido || '—'}</td>
                      <td className="py-2.5 pr-4 text-center">{p.total_citas}</td>
                      <td className="py-2.5 pr-4 whitespace-nowrap text-muted-foreground">{fmtFecha(p.ultima_visita)}</td>
                      <td className="py-2.5 pr-4 whitespace-nowrap text-muted-foreground">{fmtFecha(p.proxima_cita)}</td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-7 w-7"
                            onClick={e => { e.stopPropagation(); abrirDetalle(p.id) }} title="Editar">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={e => { e.stopPropagation(); setConfirmarBorrar({ id: p.id, nombre: nombreCompleto(p) }) }} title="Eliminar">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
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
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Apellido</Label>
                <Input value={form.apellido} onChange={e => setForm(f => ({ ...f, apellido: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Teléfono</Label>
                <Input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <select
                  value={form.titular ? 'titular' : 'tercero'}
                  onChange={e => setForm(f => ({ ...f, titular: e.target.value === 'titular' }))}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="titular">Titular</option>
                  <option value="tercero">Tercero</option>
                </select>
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
            <div className="flex items-center justify-between gap-3">
              <Button size="sm" onClick={guardar} disabled={saving || !form.nombre.trim() || !form.telefono.trim()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Guardar
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                onClick={() => setConfirmarBorrar({ id: detalle.paciente.id, nombre: nombreCompleto(detalle.paciente) })}>
                <Trash2 className="h-3.5 w-3.5" /> Eliminar paciente
              </Button>
            </div>

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
