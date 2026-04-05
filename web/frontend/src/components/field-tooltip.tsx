"use client";

import { useState, useRef, useEffect } from "react";

interface FieldTooltipProps {
  content: string;
}

export function FieldTooltip({ content }: FieldTooltipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <span className="position-relative d-inline-block ms-1" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="btn btn-link p-0 text-body-secondary"
        aria-label="Help"
      >
        <i className="bi bi-question-circle small" />
      </button>
      {open && (
        <div className="position-absolute bottom-100 start-50 translate-middle-x mb-2 bg-body border rounded shadow p-2 small" style={{ width: 250, zIndex: 1060, whiteSpace: "pre-line" }}>
          {content}
        </div>
      )}
    </span>
  );
}
