import React, { useEffect, useMemo, useState } from "react"

type MarkedModule = {
  parse: (markdown: string) => string
}

type KatexAutoRender = (root: HTMLElement, options?: Record<string, unknown>) => void

declare global {
  interface Window {
    marked?: MarkedModule
    renderMathInElement?: KatexAutoRender
  }
}

interface MarkdownLatexRendererProps {
  content: string
  className?: string
}

const loadScript = (src: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve()
        return
      }

      existing.addEventListener("load", () => resolve(), { once: true })
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true })
      return
    }

    const script = document.createElement("script")
    script.src = src
    script.async = true
    script.onload = () => {
      script.dataset.loaded = "true"
      resolve()
    }
    script.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(script)
  })
}

const loadStylesheet = (href: string): void => {
  const existing = document.querySelector(`link[href="${href}"]`)
  if (existing) {
    return
  }

  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = href
  document.head.appendChild(link)
}

const MarkdownLatexRenderer: React.FC<MarkdownLatexRendererProps> = ({ content, className = "" }) => {
  const [isRendererReady, setIsRendererReady] = useState(false)
  const [renderError, setRenderError] = useState<string>("")

  useEffect(() => {
    let isMounted = true

    const bootstrapRenderers = async () => {
      try {
        loadStylesheet("https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css")

        await loadScript("https://cdn.jsdelivr.net/npm/marked/marked.min.js")
        await loadScript("https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js")
        await loadScript("https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js")

        if (isMounted) {
          setIsRendererReady(true)
        }
      } catch {
        if (isMounted) {
          setRenderError("Markdown/LaTeX renderer failed to load.")
        }
      }
    }

    bootstrapRenderers()

    return () => {
      isMounted = false
    }
  }, [])

  const html = useMemo(() => {
    if (!isRendererReady || !window.marked) {
      return ""
    }

    return window.marked.parse(content)
  }, [content, isRendererReady])

  useEffect(() => {
    if (!isRendererReady || !window.renderMathInElement) {
      return
    }

    const root = document.getElementById("markdown-latex-render-root")
    if (!root) {
      return
    }

    window.renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
        { left: "\\[", right: "\\]", display: true },
      ],
      throwOnError: false,
    })
  }, [html, isRendererReady])

  if (renderError) {
    return <pre className={className}>{content}</pre>
  }

  if (!isRendererReady) {
    return <pre className={className}>{content}</pre>
  }

  return (
    <div
      id="markdown-latex-render-root"
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export default MarkdownLatexRenderer
