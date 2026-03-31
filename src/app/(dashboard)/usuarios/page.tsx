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
import { Plus, Trash2, Pencil, X, Check, Loader2, ShieldCheck, User } from 'lucide-react'

interface AppUser {
  id: number; name: string; email: string
  is_superadmin: boolean; active: boolean; created_at: string
}

const emptyForm = { name: '', email: '', password: '', is_superadmin: false, active: true }

export default function UsuariosPage() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<AppUser | null>(null)
  const [editForm, setEditForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  async function load() {
    const res = await fetch('/api/users')
    if (res.ok) setUsers(await res.json())
    else setUsers([])
  }
  useEffect(() => { load() }, [])

  async function create() {
    if (!form.name || !form.email || !form.password) return
    setSaving(true)
    try {
      const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (res.ok) { toast({ title: 'Usuario creado' }); setForm(emptyForm); load() }
      else { const d = await res.json(); toast({ title: d.error || 'Error', variant: 'destructive' }) }
    } finally { setSaving(false) }
  }

  async function update() {
    if (!editing) return
    setSaving(true)
    try {
      const payload = { ...editForm, id: editing.id }
      const res = await fetch('/api/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (res.ok) { toast({ title: 'Usuario actualizado' }); setEditing(null); load() }
      else toast({ title: 'Error', variant: 'destructive' })
    } finally { setSaving(false) }
  }

  async function deleteUser(id: number) {
    if (!confirm('¿Eliminar este usuario?')) return
    await fetch('/api/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    toast({ title: 'Usuario eliminado' })
    load()
  }

  function startEdit(u: AppUser) {
    setEditing(u)
    setEditForm({ name: u.name, email: u.email, password: '', is_superadmin: u.is_superadmin, active: u.active })
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Usuarios de la app</h1>
        <p className="text-muted-foreground text-sm">Solo visible para superadmin</p>
      </div>

      {/* Create form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nuevo usuario</CardTitle>
          <CardDescription>Crea usuarios con acceso al panel</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nombre</Label>
              <Input placeholder="María García" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" placeholder="maria@clinica.com" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Contraseña</Label>
              <Input type="password" placeholder="Mínimo 8 caracteres" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch checked={form.is_superadmin} onCheckedChange={v => setForm(p => ({ ...p, is_superadmin: v }))} />
              <div>
                <p className="text-sm font-medium">Superadmin</p>
                <p className="text-xs text-muted-foreground">Acceso completo incluido usuarios</p>
              </div>
            </div>
          </div>
          <Button onClick={create} disabled={saving} size="sm">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Crear usuario
          </Button>
        </CardContent>
      </Card>

      {/* User list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usuarios existentes</CardTitle>
          <CardDescription>{users.length} usuario{users.length !== 1 ? 's' : ''}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {users.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No hay usuarios creados todavía</p>
          )}
          {users.map(u => (
            <div key={u.id}>
              {editing?.id === u.id ? (
                <div className="rounded-lg border p-3 space-y-3 bg-muted/30">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} placeholder="Nombre" />
                    <Input type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} placeholder="Email" />
                    <Input type="password" value={editForm.password} onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))} placeholder="Nueva contraseña (dejar vacío para no cambiar)" />
                    <div className="flex items-center gap-3">
                      <Switch checked={editForm.is_superadmin} onCheckedChange={v => setEditForm(p => ({ ...p, is_superadmin: v }))} />
                      <span className="text-sm">Superadmin</span>
                      <Switch checked={editForm.active} onCheckedChange={v => setEditForm(p => ({ ...p, active: v }))} />
                      <span className="text-sm">Activo</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={update} disabled={saving}>
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Guardar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      <X className="h-3.5 w-3.5" /> Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors group">
                  <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${u.is_superadmin ? 'bg-primary/10' : 'bg-muted'}`}>
                    {u.is_superadmin ? <ShieldCheck className="h-4 w-4 text-primary" /> : <User className="h-4 w-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{u.name}</span>
                      {u.is_superadmin && <Badge variant="default" className="text-xs">Superadmin</Badge>}
                      {!u.active && <Badge variant="secondary" className="text-xs">Inactivo</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(u)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => deleteUser(u.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
