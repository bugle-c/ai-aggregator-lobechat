'use client';

import { type FC, useRef, useState } from 'react';

interface UploadFormProps {
  topicId: string;
}

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; progress: number }
  | { kind: 'success'; fileName: string }
  | { kind: 'error'; message: string };

const UploadForm: FC<UploadFormProps> = ({ topicId }) => {
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setState({ kind: 'uploading', progress: 0 });

    const fd = new FormData();
    fd.append('topicId', topicId);
    fd.append('file', file);

    try {
      const res = await fetch('/api/files/attach-to-topic', {
        method: 'POST',
        body: fd,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setState({ kind: 'error', message: body.error ?? `HTTP ${res.status}` });
        return;
      }

      const body = await res.json();
      setState({ kind: 'success', fileName: body.fileName ?? file.name });
    } catch (err: any) {
      setState({ kind: 'error', message: err.message ?? 'Network error' });
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  // --- Success screen ---
  if (state.kind === 'success') {
    return (
      <div style={styles.card}>
        <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 16 }}>✅</div>
        <h2 style={styles.heading}>Файл прикреплён!</h2>
        <p style={styles.body}>
          Файл «<strong>{state.fileName}</strong>» добавлен к диалогу. Вернитесь в Telegram-бот и
          задайте вопрос по нему.
        </p>
        <a href="https://t.me/gptwebrubot" style={styles.button}>
          Открыть бот
        </a>
      </div>
    );
  }

  const isUploading = state.kind === 'uploading';

  return (
    <div style={styles.card}>
      <h2 style={styles.heading}>Загрузить файл</h2>
      <p style={styles.body}>
        Выберите файл для прикрепления к диалогу. После загрузки бот пришлёт вам уведомление.
      </p>

      {state.kind === 'error' && (
        <div style={styles.errorBox}>
          Ошибка: {state.message}. Попробуйте ещё раз.
        </div>
      )}

      {/* Drag-and-drop zone */}
      <div
        style={{
          ...styles.dropZone,
          ...(dragging ? styles.dropZoneActive : {}),
          ...(isUploading ? styles.dropZoneDisabled : {}),
        }}
        onClick={() => !isUploading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!isUploading) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={isUploading ? undefined : handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleChange}
          disabled={isUploading}
        />
        {isUploading ? (
          <span>Загружается...</span>
        ) : (
          <span>Перетащите файл сюда или <u>нажмите для выбора</u></span>
        )}
      </div>
    </div>
  );
};

const styles = {
  card: {
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 480,
    margin: '80px auto',
    padding: '32px 24px',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    background: '#fff',
  } as React.CSSProperties,
  heading: {
    margin: '0 0 12px',
    fontSize: 22,
    fontWeight: 700,
    color: '#1a202c',
  } as React.CSSProperties,
  body: {
    margin: '0 0 20px',
    color: '#4a5568',
    lineHeight: 1.6,
  } as React.CSSProperties,
  dropZone: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 120,
    border: '2px dashed #cbd5e0',
    borderRadius: 8,
    cursor: 'pointer',
    color: '#718096',
    fontSize: 15,
    transition: 'border-color 0.2s, background 0.2s',
    userSelect: 'none',
  } as React.CSSProperties,
  dropZoneActive: {
    borderColor: '#4299e1',
    background: '#ebf8ff',
    color: '#2b6cb0',
  } as React.CSSProperties,
  dropZoneDisabled: {
    cursor: 'wait',
    opacity: 0.6,
  } as React.CSSProperties,
  errorBox: {
    background: '#fff5f5',
    border: '1px solid #fc8181',
    borderRadius: 6,
    padding: '10px 14px',
    color: '#c53030',
    marginBottom: 16,
    fontSize: 14,
  } as React.CSSProperties,
  button: {
    display: 'inline-block',
    marginTop: 16,
    padding: '10px 20px',
    background: '#3182ce',
    color: '#fff',
    borderRadius: 8,
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: 15,
  } as React.CSSProperties,
};

export default UploadForm;
