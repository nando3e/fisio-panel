'use client'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Bot, Calendar, CalendarDays, CalendarRange, Loader2, User2, Clock } from 'lucide-react'
import { toast } from '@/components/ui/use-toast'

interface DashboardData {
  citasHoy: number
  citasSemana: number
  citasMes: number
  porProfesional: { name: string; count: string }[]
  botActivo: boolean
  proximas: { start_time: string; end_time: string; professional_name: string; service_name: string }[]
}

function formatHour(iso: string) {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [botLoading, setBotLoading] = useState(false)

  async function load() {
    const res = await fetch('/api/dashboard')
    setData(await res.json())
  }

  useEffect(() => { load() }, [])

  async function toggleBot() {
    if (!data) return
    setBotLoading(true)
    try {
      const res = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: !data.botActivo }),
      })
      const r = await res.json()
      setData(prev => prev ? { ...prev, botActivo: r.activo } : prev)
      toast({ title: r.activo ? '✅ Bot activado' : '⏸ Bot pausado', description: r.activo ? 'El bot volverá a responder mensajes.' : 'El bot no responderá hasta que se reactive.' })
    } finally {
      setBotLoading(false)
    }
  }

  if (!data) return (
    <div className="flex items-center justify-center h-full min-h-[60vh]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Resumen general de la clínica</p>
        </div>

        {/* Bot toggle */}
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${data.botActivo ? 'border-green-500/30 bg-green-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
          <div className={`h-2.5 w-2.5 rounded-full ${data.botActivo ? 'bg-green-500 animate-pulse' : 'bg-destructive'}`} />
          <div>
            <p className="text-sm font-medium">Bot WhatsApp</p>
            <p className="text-xs text-muted-foreground">{data.botActivo ? 'Activo y respondiendo' : 'Pausado'}</p>
          </div>
          <Button
            variant={data.botActivo ? 'destructive' : 'default'}
            size="sm"
            onClick={toggleBot}
            disabled={botLoading}
            className="ml-2"
          >
            {botLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
            {data.botActivo ? 'Desactivar' : 'Activar'}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Citas hoy</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data.citasHoy}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Esta semana</CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data.citasSemana}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Este mes</CardTitle>
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{data.citasMes}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Por profesional */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Citas esta semana por profesional</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.porProfesional.map(p => (
              <div key={p.name} className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User2 className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-medium">{p.name}</span>
                    <Badge variant="secondary">{p.count}</Badge>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.min(100, (parseInt(p.count) / Math.max(...data.porProfesional.map(x => parseInt(x.count)), 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Próximas citas */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Próximas citas</CardTitle>
            <CardDescription>Las siguientes citas agendadas</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.proximas.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No hay citas próximas</p>
            )}
            {data.proximas.map((c, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="text-center min-w-[50px]">
                  <p className="text-xs text-muted-foreground">{formatDate(c.start_time)}</p>
                  <p className="text-sm font-semibold">{formatHour(c.start_time)}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.service_name}</p>
                  <p className="text-xs text-muted-foreground">{c.professional_name}</p>
                </div>
                <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
