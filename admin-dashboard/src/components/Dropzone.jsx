import React, { useRef, useState } from 'react';
import { classNames } from '../utils/format.js';

export function Dropzone({ accept, label, hint, file, onChange }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const onPick = () => inputRef.current?.click();

  const setFile = (f) => {
    if (!f) return onChange(null);
    onChange(f);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0] || null;
    if (f) setFile(f);
  };

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-300">{label}</div>
      <div
        className={classNames(
          'flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm transition',
          dragOver ? 'border-sky-500 bg-sky-500/10' : 'border-slate-800 bg-slate-950 hover:bg-slate-900/60'
        )}
        onClick={onPick}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="min-w-0">
          <div className="truncate text-slate-200">{file ? file.name : 'Arrastra y suelta o haz click'}</div>
          <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
        </div>
        {file ? (
          <button
            type="button"
            className="shrink-0 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 hover:bg-slate-900"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
          >
            Quitar
          </button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />
    </div>
  );
}

