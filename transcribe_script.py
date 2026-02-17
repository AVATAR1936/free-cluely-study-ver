import sys
import os
import site
import glob

# --- ФИКС ПУТЕЙ NVIDIA ---
def setup_nvidia_paths():
    """
    Находит установленные через pip библиотеки nvidia и добавляет их 
    в PATH и DLL search path.
    """
    if os.name != 'nt':
        return

    # Собираем все возможные места site-packages
    paths_to_check = site.getsitepackages()
    if hasattr(site, 'getusersitepackages'):
        paths_to_check.append(site.getusersitepackages())

    nvidia_dll_paths = []

    for sp in paths_to_check:
        nvidia_base = os.path.join(sp, 'nvidia')
        if not os.path.exists(nvidia_base):
            continue
            
        # Ищем внутри nvidia/cublas/bin, nvidia/cudnn/bin и т.д.
        # Иногда они лежат в lib, иногда в bin
        found_dirs = glob.glob(os.path.join(nvidia_base, '*', '*')) 
        for d in found_dirs:
            # Нам нужны папки bin или lib, где лежат .dll
            if os.path.isdir(d) and (d.endswith('bin') or d.endswith('lib')):
                nvidia_dll_paths.append(d)

    # Применяем найденные пути
    for p in nvidia_dll_paths:
        # 1. Для Python (чтобы он видел DLL)
        try:
            os.add_dll_directory(p)
        except:
            pass
        # 2. Для C++ движка (CTranslate2 часто ищет в PATH)
        if p not in os.environ['PATH']:
            os.environ['PATH'] = p + os.pathsep + os.environ['PATH']

setup_nvidia_paths()
# --- КОНЕЦ ФИКСА ---

# Настройка кодировки
sys.stdout.reconfigure(encoding='utf-8')

try:
    from faster_whisper import WhisperModel
except ImportError:
    sys.stderr.write("Error: faster-whisper not installed.\n")
    sys.exit(1)

if len(sys.argv) < 2:
    print("Error: No audio file provided")
    sys.exit(1)

audio_path = sys.argv[1]

try:
    # Попытка запустить на GPU
    # compute_type="float16" - стандарт для GPU
    model = WhisperModel("large-v3", device="cuda", compute_type="float16")
    
    segments, info = model.transcribe(audio_path, language="uk", beam_size=5)

    full_text = "".join([segment.text for segment in segments])
    print(full_text.strip())

except Exception as e:
    # Если GPU всё равно не завелась, выводим подробную ошибку
    error_msg = str(e)
    sys.stderr.write(f"CUDA Error: {error_msg}\n")
    
    # Можно раскомментировать строки ниже, чтобы АВТОМАТИЧЕСКИ падать на CPU при ошибке
    # sys.stderr.write("Falling back to CPU...\n")
    # model = WhisperModel("small", device="cpu", compute_type="int8")
    # segments, info = model.transcribe(audio_path, language="uk", beam_size=5)
    # print("".join([segment.text for segment in segments]).strip())
    
    sys.exit(1)