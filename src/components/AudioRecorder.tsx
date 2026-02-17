import React, { useState, useRef } from 'react';

interface AudioRecorderProps {
  onResult?: (result: { transcription?: string; notes?: string; error?: string }) => void;
}

export const AudioRecorder: React.FC<AudioRecorderProps> = ({ onResult }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null); // Храним ссылку на исходный поток

  const startRecording = async () => {
    try {
      // 1. Получаем поток экрана + системного звука
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
            width: 1, height: 1 // Видео нам не нужно, но оно обязательно для getDisplayMedia
        },
        audio: true 
      });

      // 2. Проверяем, есть ли аудиодорожка
      if (displayStream.getAudioTracks().length === 0) {
          alert("Аудио не выбрано. Убедитесь, что поставили галочку 'Share audio' (Поделиться аудио) в системном окне.");
          // Останавливаем пустой поток
          displayStream.getTracks().forEach(track => track.stop());
          return;
      }

      // Сохраняем поток, чтобы потом остановить его (потушить "красную точку" записи)
      streamRef.current = displayStream;

      // 3. ВАЖНОЕ ИСПРАВЛЕНИЕ:
      // Создаем новый чистый поток ТОЛЬКО с аудиодорожкой.
      // Иначе MediaRecorder с mimeType 'audio/webm' упадет из-за наличия видео.
      const audioStream = new MediaStream(displayStream.getAudioTracks());

      // 4. Инициализируем рекордер с чистым аудио-потоком
      const mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsProcessing(true);
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();

        try {
            const initialResult = await window.electronAPI.transcribeAndAnalyze(arrayBuffer, { mode: 'auto' });

            if (initialResult.success) {
              console.log("Транскрипция:", initialResult.transcription);
              console.log("Заметки:", initialResult.notes);
              onResult?.({
                transcription: initialResult.transcription,
                notes: initialResult.notes,
              });
              return;
            }

            if (initialResult.requiresAction === 'confirm-long-transcription') {
              const tokenCount = initialResult.tokenCount ?? 0;
              const shouldUseGemini = window.confirm(
                `Транскрипция содержит примерно ${tokenCount} токенов (больше 10 000).\n\nНажмите "ОК" для обработки через Gemini API.\nНажмите "Отмена" для локальной обработки через Ollama.`
              );

              if (shouldUseGemini) {
                const apiKey = window.prompt('Введите Gemini API Key (если ключ уже настроен, оставьте поле пустым):', '') || undefined;
                const geminiResult = await window.electronAPI.transcribeAndAnalyze(arrayBuffer, {
                  mode: 'gemini',
                  allowLongTranscription: true,
                  geminiApiKey: apiKey,
                  transcriptionOverride: initialResult.transcription,
                });

                if (!geminiResult.success) {
                  onResult?.({ error: geminiResult.error || 'Ошибка обработки через Gemini.' });
                  return;
                }

                onResult?.({
                  transcription: geminiResult.transcription,
                  notes: geminiResult.notes,
                });
                return;
              }

              const localResult = await window.electronAPI.transcribeAndAnalyze(arrayBuffer, {
                mode: 'local',
                allowLongTranscription: true,
                transcriptionOverride: initialResult.transcription,
              });

              if (!localResult.success) {
                onResult?.({ error: localResult.error || 'Ошибка локальной обработки.' });
                return;
              }

              onResult?.({
                transcription: localResult.transcription,
                notes: localResult.notes,
              });
              return;
            }

            if (initialResult.requiresAction === 'provide-gemini-api-key') {
              const apiKey = window.prompt('Для Gemini нужен API ключ. Введите Gemini API Key:', '') || undefined;
              if (!apiKey) {
                onResult?.({ error: 'Gemini API key не указан.' });
                return;
              }

              const retryResult = await window.electronAPI.transcribeAndAnalyze(arrayBuffer, {
                mode: 'gemini',
                allowLongTranscription: true,
                geminiApiKey: apiKey,
                transcriptionOverride: initialResult.transcription,
              });

              if (!retryResult.success) {
                onResult?.({ error: retryResult.error || 'Ошибка обработки через Gemini.' });
                return;
              }

              onResult?.({
                transcription: retryResult.transcription,
                notes: retryResult.notes,
              });
              return;
            }

            onResult?.({ error: initialResult.error || "Ошибка обработки аудио." });
        } catch (e) {
            console.error(e);
            onResult?.({ error: "Ошибка отправки данных в Electron." });
        } finally {
            setIsProcessing(false);
            
            // 5. Обязательно останавливаем исходный поток (экран), чтобы прекратить захват
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
        }
      };

      mediaRecorder.start();
      setIsRecording(true);

      // Если пользователь нажмет "Прекратить доступ" в системной плашке браузера
      displayStream.getVideoTracks()[0].onended = () => {
          stopRecording();
      };

    } catch (err) {
      console.error("Error starting recording:", err);
      alert("Не удалось начать запись. Проверьте консоль.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const baseBtnStyle = "bg-white/10 hover:bg-white/20 transition-colors rounded-md px-2 py-1 text-[11px] leading-none text-white/70 flex items-center gap-1";
  const recordingBtnStyle = "bg-red-500/70 hover:bg-red-500/90";
  const processingStyle = "bg-yellow-500/70 hover:bg-yellow-500/70 cursor-wait";

  return (
    <div className="flex items-center gap-2">
      {!isRecording ? (
        <button 
            onClick={startRecording} 
            disabled={isProcessing}
            className={`${baseBtnStyle} ${isProcessing ? processingStyle : ''}`}
            type="button"
        >
            {isProcessing ? "⏳ Processing..." : "🎙️ Record Audio"}
        </button>
      ) : (
        <button 
            onClick={stopRecording} 
            className={`${baseBtnStyle} ${recordingBtnStyle}`}
            type="button"
        >
            <span className="animate-pulse">● Stop Audio</span>
        </button>
      )}
    </div>
  );
};
