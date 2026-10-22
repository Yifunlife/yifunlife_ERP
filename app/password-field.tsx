"use client";
import { useState } from "react";

export default function PasswordField({ id, label, value, onChange, autoComplete, required = false, minLength }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  required?: boolean;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="passwordField">
    <label htmlFor={id}>{label}</label>
    <div className="passwordInputRow">
      <input id={id} type={visible ? "text" : "password"} value={value} onChange={event => onChange(event.target.value)} autoComplete={autoComplete} required={required} minLength={minLength} />
      <button type="button" className="passwordVisibility" aria-controls={id} aria-label={`${visible ? "隐藏" : "显示"}${label}`} aria-pressed={visible} onClick={() => setVisible(!visible)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {visible ? <><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c5 0 9 7 9 7a19 19 0 0 1-3.1 3.8M6.2 6.2A21 21 0 0 0 3 12s4 7 9 7a10 10 0 0 0 5.8-2.2" /></> : <><path d="M3 12s4-7 9-7 9 7 9 7-4 7-9 7-9-7-9-7Z" /><circle cx="12" cy="12" r="3" /></>}
        </svg>
      </button>
    </div>
  </div>;
}

