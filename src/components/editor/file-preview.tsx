import { convertFileSrc } from "@tauri-apps/api/core"
import { convertLatexToUnicode } from "@/lib/latex-to-unicode"
import {
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  FileSpreadsheet,
  FileQuestion,
} from "lucide-react"
import { getFileCategory, getCodeLanguage } from "@/lib/file-types"
import type { FileCategory } from "@/lib/file-types"
import { getFileName } from "@/lib/path-utils"

interface FilePreviewProps {
  filePath: string
  textContent: string
}

export function FilePreview({ filePath, textContent }: FilePreviewProps) {
  const category = getFileCategory(filePath)
  const fileName = getFileName(filePath)

  switch (category) {
    case "image":
      return <ImagePreview filePath={filePath} fileName={fileName} />
    case "video":
      return <VideoPreview filePath={filePath} fileName={fileName} />
    case "audio":
      return <AudioPreview filePath={filePath} fileName={fileName} />
    case "pdf":
      return <TextPreview filePath={filePath} content={textContent} label="PDF (extracted text)" />
    case "code":
      return <CodePreview filePath={filePath} content={textContent} />
    case "data":
      return <CodePreview filePath={filePath} content={textContent} />
    case "text":
      return <TextPreview filePath={filePath} content={textContent} label="Text" />
    case "document":
      return <BinaryPlaceholder filePath={filePath} fileName={fileName} category={category} />
    default:
      return <BinaryPlaceholder filePath={filePath} fileName={fileName} category={category} />
  }
}

function ImagePreview({ filePath, fileName }: { filePath: string; fileName: string }) {
  const src = convertFileSrc(filePath)
  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 text-xs text-muted-foreground">{filePath}</div>
      <div className="flex flex-1 items-center justify-center overflow-auto rounded-lg bg-muted/30">
        <img
          src={src}
          alt={fileName}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    </div>
  )
}

function VideoPreview({ filePath, fileName }: { filePath: string; fileName: string }) {
  const src = convertFileSrc(filePath)
  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 text-xs text-muted-foreground">{filePath}</div>
      <div className="flex flex-1 items-center justify-center overflow-auto rounded-lg bg-black">
        <video
          src={src}
          controls
          className="max-h-full max-w-full"
        >
          <track kind="captions" label={fileName} />
        </video>
      </div>
    </div>
  )
}

function AudioPreview({ filePath, fileName }: { filePath: string; fileName: string }) {
  const src = convertFileSrc(filePath)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="text-xs text-muted-foreground">{filePath}</div>
      <Music className="h-16 w-16 text-muted-foreground/50" />
      <p className="text-sm font-medium">{fileName}</p>
      <audio src={src} controls className="w-full max-w-md">
        <track kind="captions" label={fileName} />
      </audio>
    </div>
  )
}

function CodePreview({ filePath, content }: { filePath: string; content: string }) {
  const lang = getCodeLanguage(filePath)
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{filePath}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{lang}</span>
      </div>
      <pre className="whitespace-pre-wrap rounded-lg bg-muted/30 p-4 font-mono text-sm">
        {content}
      </pre>
    </div>
  )
}

function TextPreview({ filePath, content, label }: { filePath: string; content: string; label: string }) {
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{filePath}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{label}</span>
      </div>
      <pre className="whitespace-pre-wrap font-mono text-sm">{convertLatexToUnicode(content)}</pre>
    </div>
  )
}

function BinaryPlaceholder({
  filePath,
  fileName,
  category,
}: {
  filePath: string
  fileName: string
  category: FileCategory
}) {
  const iconMap: Record<string, typeof FileText> = {
    document: FileSpreadsheet,
    unknown: FileQuestion,
    image: ImageIcon,
    video: Film,
  }
  const Icon = iconMap[category] ?? FileQuestion

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <Icon className="h-16 w-16 text-muted-foreground/30" />
      <div>
        <p className="text-sm font-medium">{fileName}</p>
        <p className="mt-1 text-xs text-muted-foreground">{filePath}</p>
      </div>
      <p className="text-sm text-muted-foreground">
        Preview not available for this file type
      </p>
    </div>
  )
}
