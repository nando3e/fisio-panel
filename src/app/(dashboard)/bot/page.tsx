'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/use-toast'
import { Loader2, Save, Send, UploadCloud, RotateCcw, Info, Bot as BotIcon, User } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface ClaveBot {
  clave: string
  etiqueta: string
  tipo: 'select' | 'bool' | 'hora' | 'texto' | 'entero'
  opciones?: string[]
  valor: string
  ayuda: string
}
interface PromptVersion {
  id: number
  rol: string
  version: number
  contenido: string
  activo: boolean
  nota?: string | null
  created_at?: string
}
interface PromptsResponse { roles: string[]; activos: PromptVersion[] }
interface Texto { clave: string; idioma: string; contenido: string }
interface ToolDetalle { nombre?: string; name?: string; tool?: string; args?: unknown; resultado?: unknown; result?: unknown }
interface Traza {
  id: number
  telefono: string
  mensaje: string
  respuesta: string | null
  tools: string[] | null
  tools_detalle: ToolDetalle[] | null
  modelo: string | null
  tokens_in: number | null
  tokens_out: number | null
  duracion_ms: number | null
  error: string | null
  created_at: string
}
interface MensajeChat { de: 'usuario' | 'bot' | 'error'; texto: string }

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

const CLAVES_DESTACADAS = ['continuidad_modo', 'recordatorios_activos']

function fmtFechaHora(iso: string) {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

// ─── Pestaña Ajustes ──────────────────────────────────────────────────────────
function AjustesTab() {
  const [claves, setClaves] = useState<ClaveBot[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/bot-config')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setClaves(data) })
      .finally(() => setLoading(false))
  }, [])

  function setValor(clave: string, valor: string) {
    setClaves(prev => prev.map(c => (c.clave === clave ? { ...c, valor } : c)))
  }

  async function guardar() {
    setSaving(true)
    try {
      const body: Record<string, string> = {}
      claves.forEach(c => { body[c.clave] = c.valor })
      const res = await fetch('/api/bot-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) toast({ title: 'Ajustes guardados' })
      else {
        const err = await res.json().catch(() => null)
        toast({ title: err?.error || 'Error al guardar', variant: 'destructive' })
      }
    } finally {
      setSaving(false)
    }
  }

  function campo(c: ClaveBot) {
    if (c.tipo === 'bool') {
      return (
        <Switch checked={c.valor === 'true'} onCheckedChange={v => setValor(c.clave, v ? 'true' : 'false')} />
      )
    }
    if (c.tipo === 'select') {
      return (
        <select value={c.valor} onChange={e => setValor(c.clave, e.target.value)} className={`${SELECT_CLASS} max-w-[220px]`}>
          {(c.opciones ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    if (c.tipo === 'hora') {
      return <Input type="time" value={c.valor} onChange={e => setValor(c.clave, e.target.value)} className="max-w-[140px]" />
    }
    if (c.tipo === 'entero') {
      return <Input type="number" min={0} value={c.valor} onChange={e => setValor(c.clave, e.target.value)} className="max-w-[140px]" />
    }
    return <Input value={c.valor} onChange={e => setValor(c.clave, e.target.value)} className="max-w-md" />
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>

  const destacadas = claves.filter(c => CLAVES_DESTACADAS.includes(c.clave))
  const resto = claves.filter(c => !CLAVES_DESTACADAS.includes(c.clave))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ajustes del bot</CardTitle>
        <CardDescription>Configuración de comportamiento del asistente de WhatsApp</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {destacadas.length > 0 && (
          <div className="space-y-3">
            {destacadas.map(c => (
              <div key={c.clave} className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1 flex-1 min-w-[220px]">
                  <p className="text-sm font-semibold">{c.etiqueta}</p>
                  {c.ayuda && <p className="text-xs text-muted-foreground">{c.ayuda}</p>}
                </div>
                <div className="pt-0.5">{campo(c)}</div>
              </div>
            ))}
          </div>
        )}

        <Separator />

        <div className="space-y-5">
          {resto.map(c => (
            <div key={c.clave} className="space-y-1.5">
              <Label>{c.etiqueta}</Label>
              {campo(c)}
              {c.ayuda && <p className="text-xs text-muted-foreground">{c.ayuda}</p>}
            </div>
          ))}
        </div>

        <Button onClick={guardar} disabled={saving} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Guardar
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── Pestaña Prompts ──────────────────────────────────────────────────────────
function PromptsTab() {
  const [roles, setRoles] = useState<string[]>([])
  const [activos, setActivos] = useState<PromptVersion[]>([])
  const [rol, setRol] = useState<string | null>(null)
  const [contenido, setContenido] = useState('')
  const [historial, setHistorial] = useState<PromptVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)

  const cargarActivos = useCallback(async () => {
    const res = await fetch('/api/prompts')
    if (!res.ok) return
    const data: PromptsResponse = await res.json()
    setRoles(data.roles)
    setActivos(data.activos)
    return data
  }, [])

  useEffect(() => {
    cargarActivos().finally(() => setLoading(false))
  }, [cargarActivos])

  const cargarHistorial = useCallback(async (r: string) => {
    const res = await fetch(`/api/prompts?rol=${encodeURIComponent(r)}`)
    if (res.ok) setHistorial(await res.json())
  }, [])

  function seleccionarRol(r: string, listaActivos: PromptVersion[] = activos) {
    setRol(r)
    setContenido(listaActivos.find(a => a.rol === r)?.contenido ?? '')
    cargarHistorial(r)
  }

  async function publicar() {
    if (!rol) return
    if (!window.confirm(`Se publicará una versión NUEVA del prompt "${rol}" y pasará a estar activa inmediatamente. ¿Continuar?`)) return
    setWorking(true)
    try {
      const res = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rol, contenido }),
      })
      if (res.ok) {
        toast({ title: 'Nueva versión publicada' })
        const data = await cargarActivos()
        if (data) cargarHistorial(rol)
      } else {
        const err = await res.json().catch(() => null)
        toast({ title: err?.error || 'Error al publicar', variant: 'destructive' })
      }
    } finally {
      setWorking(false)
    }
  }

  async function reactivar(v: PromptVersion) {
    if (!window.confirm(`Se reactivará la versión ${v.version} del prompt "${v.rol}" y sustituirá a la versión activa. ¿Continuar?`)) return
    setWorking(true)
    try {
      const res = await fetch('/api/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id }),
      })
      if (res.ok) {
        toast({ title: `Versión ${v.version} reactivada` })
        const data = await cargarActivos()
        if (rol) {
          cargarHistorial(rol)
          if (data) setContenido(data.activos.find(a => a.rol === rol)?.contenido ?? v.contenido)
        }
      } else {
        toast({ title: 'Error al reactivar', variant: 'destructive' })
      }
    } finally {
      setWorking(false)
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompts del agente</CardTitle>
        <CardDescription>Cada publicación crea una versión nueva; el histórico nunca se pierde</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          {roles.map(r => (
            <button
              key={r}
              onClick={() => seleccionarRol(r)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all capitalize ${
                rol === r
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'border-input hover:bg-accent'
              }`}
            >
              {r}
              {activos.find(a => a.rol === r) && (
                <span className={`ml-1.5 text-xs ${rol === r ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                  v{activos.find(a => a.rol === r)!.version}
                </span>
              )}
            </button>
          ))}
        </div>

        {!rol ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Selecciona un rol para ver y editar su prompt.</p>
        ) : (
          <>
            <textarea
              value={contenido}
              onChange={e => setContenido(e.target.value)}
              rows={16}
              spellCheck={false}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
              placeholder="Contenido del prompt..."
            />
            <Button size="sm" onClick={publicar} disabled={working || !contenido.trim()}>
              {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
              Publicar nueva versión
            </Button>

            <Separator />

            <div className="space-y-2">
              <p className="text-sm font-medium">Historial de versiones</p>
              {historial.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin versiones para este rol todavía.</p>
              ) : (
                historial.map(v => (
                  <div key={v.id} className="rounded-lg border p-3 flex items-center gap-3">
                    <Badge variant={v.activo ? 'success' : 'outline'}>v{v.version}</Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground truncate">
                        {v.created_at ? fmtFechaHora(v.created_at) : ''}{v.nota ? ` · ${v.nota}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground/70 truncate">{v.contenido.slice(0, 120)}</p>
                    </div>
                    {v.activo ? (
                      <span className="text-xs text-muted-foreground shrink-0">Activa</span>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => reactivar(v)} disabled={working}>
                        <RotateCcw className="h-3.5 w-3.5" /> Reactivar
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Pestaña Textos ───────────────────────────────────────────────────────────
function TextosTab() {
  const [textos, setTextos] = useState<Texto[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/textos')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setTextos(data) })
      .finally(() => setLoading(false))
  }, [])

  const claves = Array.from(new Set(textos.map(t => t.clave))).sort()

  function contenidoDe(clave: string, idioma: string) {
    return textos.find(t => t.clave === clave && t.idioma === idioma)?.contenido ?? ''
  }

  function setContenido(clave: string, idioma: string, contenido: string) {
    setTextos(prev => {
      const existe = prev.some(t => t.clave === clave && t.idioma === idioma)
      if (existe) return prev.map(t => (t.clave === clave && t.idioma === idioma ? { ...t, contenido } : t))
      return [...prev, { clave, idioma, contenido }]
    })
  }

  async function guardar(clave: string, idioma: string) {
    const key = `${clave}:${idioma}`
    setSaving(key)
    try {
      const res = await fetch('/api/textos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clave, idioma, contenido: contenidoDe(clave, idioma) }),
      })
      if (res.ok) toast({ title: 'Texto guardado' })
      else toast({ title: 'Error al guardar', variant: 'destructive' })
    } finally {
      setSaving(null)
    }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>

  return (
    <Card>
      <CardHeader>
        <CardTitle>Textos fijos</CardTitle>
        <CardDescription>Mensajes literales que envía el bot, por idioma</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {claves.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No hay textos configurados.</p>}
        {claves.map(clave => (
          <div key={clave} className="rounded-xl border p-4 space-y-4">
            <p className="text-sm font-semibold font-mono">{clave}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(['es', 'ca'] as const).map(idioma => (
                <div key={idioma} className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase">{idioma === 'es' ? 'Castellano' : 'Catalán'}</Label>
                  <textarea
                    value={contenidoDe(clave, idioma)}
                    onChange={e => setContenido(clave, idioma, e.target.value)}
                    rows={4}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                  />
                  <Button size="sm" variant="outline" onClick={() => guardar(clave, idioma)} disabled={saving === `${clave}:${idioma}`}>
                    {saving === `${clave}:${idioma}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Guardar
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ─── Pestaña Trazas ───────────────────────────────────────────────────────────
function TrazasTab() {
  const [telefono, setTelefono] = useState('')
  const [soloErrores, setSoloErrores] = useState(false)
  const [trazas, setTrazas] = useState<Traza[]>([])
  const [loading, setLoading] = useState(true)
  const [abierta, setAbierta] = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ telefono, errores: String(soloErrores), limit: '50' })
        const res = await fetch(`/api/trazas?${params}`)
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data)) setTrazas(data)
        }
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [telefono, soloErrores])

  function nombreTool(d: ToolDetalle) {
    return d.nombre ?? d.name ?? d.tool ?? 'tool'
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trazas del agente</CardTitle>
        <CardDescription>Últimas conversaciones procesadas por el bot</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3 items-center flex-wrap">
          <Input
            value={telefono}
            onChange={e => setTelefono(e.target.value)}
            placeholder="Filtrar por teléfono..."
            className="max-w-xs"
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Switch checked={soloErrores} onCheckedChange={setSoloErrores} />
            Solo errores
          </label>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : trazas.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No hay trazas que mostrar.</p>
        ) : (
          <div className="space-y-2">
            {trazas.map(t => {
              const expandida = abierta === t.id
              const tools = Array.isArray(t.tools) ? t.tools : []
              return (
                <div
                  key={t.id}
                  className={`rounded-lg border transition-colors ${t.error ? 'border-destructive/50' : ''} ${expandida ? 'bg-muted/20' : 'hover:bg-muted/30'}`}
                >
                  <button className="w-full text-left p-3 space-y-1.5" onClick={() => setAbierta(expandida ? null : t.id)}>
                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                      <span>{fmtFechaHora(t.created_at)}</span>
                      <span className="font-medium text-foreground">{t.telefono}</span>
                      {t.duracion_ms != null && <span>{(t.duracion_ms / 1000).toFixed(1)} s</span>}
                      {t.modelo && <span>{t.modelo}</span>}
                      {(t.tokens_in != null || t.tokens_out != null) && (
                        <span>{t.tokens_in ?? 0} → {t.tokens_out ?? 0} tokens</span>
                      )}
                      {tools.map((tool, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">{tool}</Badge>
                      ))}
                      {t.error && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Error</Badge>}
                    </div>
                    {!expandida && (
                      <>
                        <p className="text-sm truncate"><span className="text-muted-foreground">Mensaje:</span> {t.mensaje}</p>
                        <p className="text-sm truncate"><span className="text-muted-foreground">Respuesta:</span> {t.respuesta ?? '—'}</p>
                        {t.error && <p className="text-sm text-destructive truncate">{t.error}</p>}
                      </>
                    )}
                  </button>

                  {expandida && (
                    <div className="px-3 pb-3 space-y-3">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Mensaje</p>
                        <p className="text-sm whitespace-pre-wrap">{t.mensaje}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Respuesta</p>
                        <p className="text-sm whitespace-pre-wrap">{t.respuesta ?? '—'}</p>
                      </div>
                      {t.error && (
                        <div>
                          <p className="text-xs font-medium text-destructive mb-1">Error</p>
                          <p className="text-sm text-destructive whitespace-pre-wrap">{t.error}</p>
                        </div>
                      )}
                      {Array.isArray(t.tools_detalle) && t.tools_detalle.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">Detalle de tools</p>
                          {t.tools_detalle.map((d, i) => (
                            <div key={i} className="rounded-md border bg-muted/30 p-2 space-y-1.5">
                              <Badge variant="outline" className="text-[10px]">{nombreTool(d)}</Badge>
                              {d.args !== undefined && (
                                <pre className="text-xs overflow-x-auto rounded bg-background/60 p-2">
                                  {JSON.stringify(d.args, null, 2)}
                                </pre>
                              )}
                              {(d.resultado ?? d.result) !== undefined && (
                                <pre className="text-xs overflow-x-auto rounded bg-background/60 p-2">
                                  {JSON.stringify(d.resultado ?? d.result, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Pestaña Simulador ────────────────────────────────────────────────────────
function SimuladorTab() {
  const [telefono, setTelefono] = useState('+34600000000')
  const [mensaje, setMensaje] = useState('')
  const [chat, setChat] = useState<MensajeChat[]>([])
  const [enviando, setEnviando] = useState(false)
  const finRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat, enviando])

  async function enviar() {
    const texto = mensaje.trim()
    if (!texto || enviando) return
    setChat(prev => [...prev, { de: 'usuario', texto }])
    setMensaje('')
    setEnviando(true)
    try {
      const res = await fetch('/api/simulador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefono, mensaje: texto }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.respuesta) {
        setChat(prev => [...prev, { de: 'bot', texto: data.respuesta }])
      } else if (res.status === 503) {
        setChat(prev => [...prev, { de: 'error', texto: data?.error || 'Simulador no configurado (BOT_URL / BOT_ADMIN_TOKEN)' }])
      } else {
        setChat(prev => [...prev, { de: 'error', texto: data?.error || `Error del simulador (HTTP ${res.status})` }])
      }
    } catch {
      setChat(prev => [...prev, { de: 'error', texto: 'No se pudo contactar con el simulador' }])
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Simulador de conversación</CardTitle>
        <CardDescription>Prueba el bot como si fueras un paciente</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p>Las escrituras se simulan: no se crean citas reales ni se envía nada.</p>
        </div>

        <div className="space-y-2 max-w-xs">
          <Label>Teléfono simulado</Label>
          <Input value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="+34600000000" />
        </div>

        <div className="rounded-xl border bg-muted/20 p-4 h-[380px] overflow-y-auto space-y-3">
          {chat.length === 0 && (
            <p className="text-sm text-muted-foreground text-center pt-16">Escribe un mensaje para empezar la conversación.</p>
          )}
          {chat.map((m, i) => (
            <div key={i} className={`flex ${m.de === 'usuario' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${
                m.de === 'usuario'
                  ? 'bg-primary text-primary-foreground rounded-br-sm'
                  : m.de === 'error'
                    ? 'bg-destructive/10 text-destructive border border-destructive/30 rounded-bl-sm'
                    : 'bg-card border rounded-bl-sm'
              }`}>
                <div className="flex items-center gap-1.5 mb-0.5 text-[10px] opacity-70">
                  {m.de === 'usuario' ? <User className="h-3 w-3" /> : <BotIcon className="h-3 w-3" />}
                  {m.de === 'usuario' ? 'Tú' : m.de === 'error' ? 'Error' : 'Bot'}
                </div>
                {m.texto}
              </div>
            </div>
          ))}
          {enviando && (
            <div className="flex justify-start">
              <div className="bg-card border rounded-2xl rounded-bl-sm px-4 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div ref={finRef} />
        </div>

        <div className="flex gap-2">
          <Input
            value={mensaje}
            onChange={e => setMensaje(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
            placeholder="Escribe un mensaje..."
            disabled={enviando}
          />
          <Button onClick={enviar} disabled={enviando || !mensaje.trim()}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Página ───────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'ajustes', label: 'Ajustes' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'textos', label: 'Textos' },
  { id: 'trazas', label: 'Trazas' },
  { id: 'simulador', label: 'Simulador' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function BotPage() {
  const [tab, setTab] = useState<TabId>('ajustes')

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Bot de WhatsApp</h1>
        <p className="text-muted-foreground text-sm">Configuración, prompts, textos, trazas y simulador del asistente</p>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ajustes' && <AjustesTab />}
      {tab === 'prompts' && <PromptsTab />}
      {tab === 'textos' && <TextosTab />}
      {tab === 'trazas' && <TrazasTab />}
      {tab === 'simulador' && <SimuladorTab />}
    </div>
  )
}
