/** Animated conical flask – bubbles rise and the liquid sways. Used while saving and loading. */
export function LabSpinner({ size = 56, label }: { size?: number; label?: string }) {
  return (
    <div className="lab-spin" role="status" aria-live="polite">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <defs>
          <clipPath id="flask-in"><path d="M26 10h12v14l13 24a5 5 0 0 1-4.4 7.4H17.4A5 5 0 0 1 13 48l13-24Z" /></clipPath>
          <linearGradient id="liq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4f9cf0" /><stop offset="1" stopColor="#1f63c9" /></linearGradient>
        </defs>
        <g clipPath="url(#flask-in)">
          <path className="lab-wave" d="M0 40 Q 8 36 16 40 T 32 40 T 48 40 T 64 40 T 80 40 V64 H0 Z" fill="url(#liq)" />
          <circle className="lab-b b1" cx="28" cy="54" r="2.2" fill="#d6e8ff" />
          <circle className="lab-b b2" cx="35" cy="56" r="1.6" fill="#d6e8ff" />
          <circle className="lab-b b3" cx="31" cy="55" r="2.8" fill="#eaf3ff" />
        </g>
        <path d="M26 10h12v14l13 24a5 5 0 0 1-4.4 7.4H17.4A5 5 0 0 1 13 48l13-24Z" fill="none" stroke="#344054" strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M23 10h18" stroke="#344054" strokeWidth="2.6" strokeLinecap="round" />
        <circle className="lab-b b4" cx="32" cy="6" r="1.6" fill="#93c0f5" />
      </svg>
      {label && <span className="lab-spin-label">{label}</span>}
    </div>
  );
}
