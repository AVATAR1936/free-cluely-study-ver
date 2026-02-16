import React, { useState, useEffect, useRef } from "react"
import { IoLogOutOutline } from "react-icons/io5"
import { AudioRecorder } from "../AudioRecorder"

interface QueueCommandsProps {
  onTooltipVisibilityChange: (visible: boolean, height: number) => void
  screenshots: Array<{ path: string; preview: string }>
  onChatToggle: () => void
  onSettingsToggle: () => void
}

interface RecorderResultState {
  open: boolean
  title: string
  summary: string
  summaryToCopy: string
  transcriptionToCopy: string
}

const QueueCommands: React.FC<QueueCommandsProps> = ({
  onTooltipVisibilityChange,
  screenshots,
  onChatToggle,
  onSettingsToggle
}) => {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])

  const [recorderResult, setRecorderResult] = useState<RecorderResultState>({
    open: false,
    title: "",
    summary: "",
    summaryToCopy: "",
    transcriptionToCopy: "",
  })
  const [copyStatus, setCopyStatus] = useState("")

  useEffect(() => {
    let tooltipHeight = 0
    if (tooltipRef.current && isTooltipVisible) {
      tooltipHeight = tooltipRef.current.offsetHeight + 10
    }
    onTooltipVisibilityChange(isTooltipVisible, tooltipHeight)
  }, [isTooltipVisible])

  const showRecorderResult = (payload: Omit<RecorderResultState, "open">) => {
    setRecorderResult({ ...payload, open: true })
    setCopyStatus("")
  }

  const hideRecorderResult = () => {
    setRecorderResult((prev) => ({ ...prev, open: false }))
  }

  const handleMouseEnter = () => setIsTooltipVisible(true)
  const handleMouseLeave = () => setIsTooltipVisible(false)

  const handleCopy = async (value: string, successText: string) => {
    if (!value) {
      setCopyStatus("Nothing to copy")
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      setCopyStatus(successText)
    } catch {
      setCopyStatus("Copy failed")
    }
  }

  const handleRecordClick = async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const recorder = new MediaRecorder(stream)
        recorder.ondataavailable = (e) => chunks.current.push(e.data)
        recorder.onstop = async () => {
          const blob = new Blob(chunks.current, { type: chunks.current[0]?.type || "audio/webm" })
          chunks.current = []
          const reader = new FileReader()

          reader.onloadend = async () => {
            const base64Data = (reader.result as string).split(",")[1]
            try {
              const result = await window.electronAPI.analyzeAudioFromBase64(base64Data, blob.type)
              showRecorderResult({
                title: "Record Voice Result",
                summary: result.text,
                summaryToCopy: result.text,
                transcriptionToCopy: "",
              })
            } catch {
              showRecorderResult({
                title: "Record Voice Result",
                summary: "Audio analysis failed.",
                summaryToCopy: "",
                transcriptionToCopy: "",
              })
            }
          }

          reader.readAsDataURL(blob)
        }

        setMediaRecorder(recorder)
        recorder.start()
        setIsRecording(true)
      } catch {
        showRecorderResult({
          title: "Record Voice Result",
          summary: "Could not start recording.",
          summaryToCopy: "",
          transcriptionToCopy: "",
        })
      }
    } else {
      mediaRecorder?.stop()
      setIsRecording(false)
      setMediaRecorder(null)
    }
  }

  return (
    <div className="w-fit">
      <div className="text-xs text-white/90 liquid-glass-bar py-1 px-4 flex items-center justify-center gap-4 draggable-area">
        <div className="flex items-center gap-2">
          <span className="text-[11px] leading-none">Show/Hide</span>
          <div className="flex gap-1">
            <button className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">⌘</button>
            <button className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">B</button>
          </div>
        </div>

        {screenshots.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] leading-none">Solve</span>
            <div className="flex gap-1">
              <button className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">⌘</button>
              <button className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">↵</button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            className={`bg-white/10 hover:bg-white/20 transition-colors rounded-md px-2 py-1 text-[11px] leading-none text-white/70 flex items-center gap-1 ${isRecording ? "bg-red-500/70 hover:bg-red-500/90" : ""}`}
            onClick={handleRecordClick}
            type="button"
          >
            {isRecording ? <span className="animate-pulse">● Stop Recording</span> : <span>🎤 Record Voice</span>}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <AudioRecorder
            onResult={(result) => {
              if (result.error) {
                showRecorderResult({
                  title: "Record Audio (Ollama) Result",
                  summary: result.error,
                  summaryToCopy: "",
                  transcriptionToCopy: "",
                })
                return
              }

              const notes = result.notes?.trim() || "(no notes)"
              const transcription = result.transcription?.trim() || ""

              showRecorderResult({
                title: "Record Audio (Ollama) Result",
                summary: notes,
                summaryToCopy: notes,
                transcriptionToCopy: transcription,
              })
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-2 py-1 text-[11px] leading-none text-white/70 flex items-center gap-1"
            onClick={onChatToggle}
            type="button"
          >
            💬 Chat
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-2 py-1 text-[11px] leading-none text-white/70 flex items-center gap-1"
            onClick={onSettingsToggle}
            type="button"
          >
            ⚙️ Models
          </button>
        </div>

        <div className="relative inline-block" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
          <div className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-sm transition-colors flex items-center justify-center cursor-help z-10">
            <span className="text-xs text-white/70">?</span>
          </div>

          {isTooltipVisible && (
            <div ref={tooltipRef} className="absolute top-full right-0 mt-2 w-80">
              <div className="p-3 text-xs bg-black/80 backdrop-blur-md rounded-lg border border-white/10 text-white/90 shadow-lg">
                <div className="space-y-4">
                  <h3 className="font-medium truncate">Keyboard Shortcuts</h3>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="truncate">Toggle Window</span>
                        <div className="flex gap-1 flex-shrink-0">
                          <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] leading-none">⌘</span>
                          <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] leading-none">B</span>
                        </div>
                      </div>
                      <p className="text-[10px] leading-relaxed text-white/70 truncate">Show or hide this window.</p>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="truncate">Take Screenshot</span>
                        <div className="flex gap-1 flex-shrink-0">
                          <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] leading-none">⌘</span>
                          <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] leading-none">H</span>
                        </div>
                      </div>
                      <p className="text-[10px] leading-relaxed text-white/70 truncate">Take a screenshot of the problem description. The tool will extract and analyze the problem. The 5 latest screenshots are saved.</p>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="truncate">Solve Problem</span>
                        <div className="flex gap-1 flex-shrink-0">
                          <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] leading-none">⌘</span>
                          <span className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] leading-none">↵</span>
                        </div>
                      </div>
                      <p className="text-[10px] leading-relaxed text-white/70 truncate">Generate a solution based on the current problem.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mx-2 h-4 w-px bg-white/20" />

        <button
          className="text-red-500/70 hover:text-red-500/90 transition-colors hover:cursor-pointer"
          title="Sign Out"
          onClick={() => window.electronAPI.quitApp()}
        >
          <IoLogOutOutline className="w-4 h-4" />
        </button>
      </div>

      {recorderResult.open && (
        <div className="mt-2 max-w-[520px] rounded-xl border border-white/15 bg-black/40 p-3 text-white shadow-lg backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-white/90">{recorderResult.title}</h3>
            <button
              className="rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/20"
              onClick={hideRecorderResult}
              type="button"
            >
              Close
            </button>
          </div>

          <div className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded-md bg-white/5 p-2 text-[11px] leading-relaxed text-white/85">
            {recorderResult.summary}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              className="rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/80 transition-colors hover:bg-white/20"
              onClick={() => handleCopy(recorderResult.summaryToCopy, "Notes copied")}
              type="button"
            >
              📋 Copy Ollama Notes
            </button>
            <button
              className="rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/80 transition-colors hover:bg-white/20"
              onClick={() => handleCopy(recorderResult.transcriptionToCopy, "Transcription copied")}
              type="button"
            >
              📝 Copy transcription
            </button>
            <span className="text-[11px] text-white/60">{copyStatus}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default QueueCommands
