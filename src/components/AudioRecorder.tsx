import React, { useState, useRef } from 'react';

export const AudioRecorder = () => {
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
            // @ts-ignore
            const result = await window.electronAPI.transcribeAndAnalyze(arrayBuffer);
            
            if (result.success) {
                console.log("Транскрипция:", result.transcription);
                console.log("Заметки:", result.notes);
                alert("Успешно! Заметки сгенерированы (см. консоль для деталей).");
            } else {
                alert("Ошибка обработки: " + result.error);
            }
        } catch (e) {
            console.error(e);
            alert("Ошибка отправки данных в Electron.");
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

  // Стили
  const baseBtnStyle = "px-3 py-2 rounded text-xs transition-all shadow-md font-medium text-white flex items-center gap-2";
  const startBtnStyle = "bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400";
  const stopBtnStyle = "bg-red-500 hover:bg-red-600 animate-pulse";
  const processingStyle = "bg-yellow-500 cursor-wait";

  return (
    <div className="flex items-center gap-2">
      {!isRecording ? (
        <button 
            onClick={startRecording} 
            disabled={isProcessing}
            className={`${baseBtnStyle} ${isProcessing ? processingStyle : startBtnStyle}`}
        >
            {isProcessing ? "⏳ Обработка..." : "🎙️ Запись (Audio)"}
        </button>
      ) : (
        <button 
            onClick={stopRecording} 
            className={`${baseBtnStyle} ${stopBtnStyle}`}
        >
            ⏹️ Стоп
        </button>
      )}
    </div>
  );
};