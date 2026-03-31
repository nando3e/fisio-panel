'use client'
import { useCallback, useEffect, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/use-toast'
import { Upload, FileText, Trash2, Loader2, File } from 'lucide-react'

interface Doc { id: number; original_name: string; size: number; mimetype: string; uploaded_by: string; created_at: string }

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fileIcon(mime: string) {
  if (mime?.includes('pdf')) return '📄'
  if (mime?.includes('word') || mime?.includes('document')) return '📝'
  if (mime?.includes('text')) return '📃'
  return '📎'
}

export default function DocumentosPage() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)

  async function load() {
    const res = await fetch('/api/documents')
    setDocs(await res.json())
  }

  useEffect(() => { load() }, [])

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return
    setUploading(true)
    try {
      const formData = new FormData()
      acceptedFiles.forEach(f => formData.append('files', f))
      const res = await fetch('/api/documents', { method: 'POST', body: formData })
      if (res.ok) {
        toast({ title: `${acceptedFiles.length} archivo${acceptedFiles.length > 1 ? 's' : ''} subido${acceptedFiles.length > 1 ? 's' : ''}` })
        load()
      } else {
        toast({ title: 'Error al subir', variant: 'destructive' })
      }
    } finally {
      setUploading(false)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'text/plain': ['.txt'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/markdown': ['.md'],
    },
    maxSize: 10 * 1024 * 1024,
  })

  async function deleteDoc(id: number) {
    setDeleting(id)
    try {
      await fetch('/api/documents', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      toast({ title: 'Documento eliminado' })
      load()
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Documentos RAG</h1>
        <p className="text-muted-foreground text-sm">Sube documentos para dar contexto al asistente de IA</p>
      </div>

      {/* Dropzone */}
      <Card>
        <CardContent className="pt-6">
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
              isDragActive
                ? 'border-primary bg-primary/5 scale-[1.01]'
                : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30'
            }`}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center gap-3">
              {uploading ? (
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              ) : (
                <div className={`rounded-full p-3 transition-colors ${isDragActive ? 'bg-primary/10' : 'bg-muted'}`}>
                  <Upload className={`h-6 w-6 ${isDragActive ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
              )}
              <div>
                <p className="font-medium">
                  {uploading ? 'Subiendo...' : isDragActive ? 'Suelta los archivos aquí' : 'Arrastra archivos aquí'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  o <span className="text-primary underline cursor-pointer">selecciona desde tu equipo</span>
                </p>
                <p className="text-xs text-muted-foreground mt-2">PDF, TXT, DOC, DOCX, MD · máx. 10 MB por archivo</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Document list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documentos subidos</CardTitle>
          <CardDescription>{docs.length} documento{docs.length !== 1 ? 's' : ''} en total</CardDescription>
        </CardHeader>
        <CardContent>
          {docs.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No hay documentos todavía</p>
            </div>
          ) : (
            <div className="space-y-2">
              {docs.map(doc => (
                <div key={doc.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors group">
                  <div className="text-2xl shrink-0">{fileIcon(doc.mimetype)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{doc.original_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">{formatSize(doc.size)}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">{formatDate(doc.created_at)}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">{doc.uploaded_by}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost" size="icon"
                    className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
                    onClick={() => deleteDoc(doc.id)}
                    disabled={deleting === doc.id}
                  >
                    {deleting === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
